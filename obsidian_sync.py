import os
import sys
import json
import re
import argparse
from datetime import datetime

# Windows 콘솔 한글/이모지 출력 인코딩 설정
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# 로컬 'supabase' 폴더와 가상환경 패키지 충돌 방지
current_dir = os.path.abspath(os.path.dirname(__file__))
original_sys_path = sys.path.copy()
if current_dir in sys.path:
    sys.path.remove(current_dir)
if '' in sys.path:
    sys.path.remove('')

from supabase import create_client, Client
from dotenv import load_dotenv

# sys.path 복구
sys.path = original_sys_path

# 환경변수 로딩
load_dotenv()
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("VITE_SUPABASE_ANON_KEY")

def get_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError(".env 파일에서 VITE_SUPABASE_URL 및 VITE_SUPABASE_ANON_KEY 환경변수를 확인하세요.")
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def sanitize_filename(filename: str) -> str:
    """파일명으로 사용할 수 없는 특수문자 제거"""
    return re.sub(r'[\\/*?:"<>|]', '_', str(filename or "")).strip()

def format_date_str(val) -> str:
    """날짜 문자열/타임스탬프 안전 변환"""
    if isinstance(val, (int, float)):
        try:
            return datetime.fromtimestamp(val).strftime("%Y-%m-%d")
        except Exception:
            return datetime.now().strftime("%Y-%m-%d")
    if isinstance(val, str) and val:
        return val[:10]
    return datetime.now().strftime("%Y-%m-%d")

class ObsidianSync:
    def __init__(self, vault_path: str = None):
        if not vault_path:
            vault_path = os.environ.get("OBSIDIAN_VAULT_PATH", os.path.join(current_dir, "obsidian_vault"))
        
        self.vault_path = os.path.abspath(vault_path)
        self.cleanbro_dir = os.path.join(self.vault_path, "CleanBro")
        self.bookings_dir = os.path.join(self.cleanbro_dir, "작업일지")
        self.blog_dir = os.path.join(self.cleanbro_dir, "블로그")
        self.blog_draft_dir = os.path.join(self.cleanbro_dir, "블로그_작성")
        self.financial_dir = os.path.join(self.cleanbro_dir, "장부")

        self.ensure_directories()

    def ensure_directories(self):
        """필요한 옵시디언 볼트 폴더 생성"""
        for d in [self.vault_path, self.cleanbro_dir, self.bookings_dir, self.blog_dir, self.blog_draft_dir, self.financial_dir]:
            os.makedirs(d, exist_ok=True)

    def sync_bookings(self, supabase: Client):
        """Supabase bookings 테이블 데이터를 옵시디언 마크다운 작업일지로 동기화"""
        print("\n[1/4] Supabase 예약/작업 일지 데이터를 동기화 중입니다...")
        try:
            res = supabase.table("bookings").select("*").order("book_date", desc=True).execute()
            bookings = res.data or []
            print(f" -> 총 {len(bookings)}건의 예약 데이터를 수집했습니다.")

            synced_count = 0
            for b in bookings:
                b_id = b.get("id", "")
                b_date = format_date_str(b.get("book_date") or b.get("created_at"))
                customer = sanitize_filename(b.get("customer_name") or "미상고객")
                category = b.get("category") or "가전청소"
                product = b.get("product") or ""
                final_price = b.get("final_price") or b.get("base_price") or 0
                is_completed = b.get("is_completed", False)
                status_str = "완료" if is_completed else (b.get("status") or "진행중")
                phone = b.get("phone") or ""
                address = f"{b.get('address') or ''} {b.get('address_detail') or ''}".strip()
                memo = b.get("memo") or ""

                ym_folder = os.path.join(self.bookings_dir, b_date[:7] if len(b_date) >= 7 else "기타")
                os.makedirs(ym_folder, exist_ok=True)

                filename = f"[{b_date}]_{customer}_{sanitize_filename(category)}.md"
                filepath = os.path.join(ym_folder, filename)

                content = f"""---
type: booking
id: "{b_id}"
date: {b_date}
time: "{b.get('book_time_type') or ''}"
customer_name: "{customer}"
phone: "{phone}"
category: "{category}"
product: "{product}"
final_price: {final_price}
is_completed: {str(is_completed).lower()}
status: "{status_str}"
payment_method: "{b.get('payment_method') or ''}"
address: "{address}"
assignee: "{b.get('assignee') or ''}"
---

# 🧹 작업일지: {customer}님 ({category} {product})

> [!INFO] **예약 및 현장 기본 정보**
> - **작업일자**: {b_date} ({b.get('book_time_type') or '시간 미정'})
> - **고객명**: {customer}님 ({phone})
> - **주소**: {address}
> - **작업품목**: {category} - {product} ({b.get('quantity', 1)}대)
> - **결제금액**: {final_price:,}원 ({b.get('payment_method') or '결제방식 미정'})
> - **작업상태**: {'✅ 완료' if is_completed else '⏳ ' + status_str}
> - **담당자**: {b.get('assignee') or '미지정'}

## 📝 현장 메모 & 특이사항
{memo if memo else '노트 작성: 현장 소음, 곰팡이 오염도, 추가 청소 부위 등을 자유롭게 기록하세요.'}

## 📋 체크리스트
- [{'x' if is_completed else ' '}] 사전 점검 및 작동 확인
- [{'x' if is_completed else ' '}] 제품 분해 및 부품 세척
- [{'x' if is_completed else ' '}] 고압 세척 및 살균 소독
- [{'x' if is_completed else ' '}] 결합 후 최종 작동 검수
- [{'x' if is_completed else ' '}] 고객 안내 및 결제 완료
"""
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(content)
                synced_count += 1

            print(f" -> OK: {synced_count}개의 마크다운 작업일지 노트를 업데이트했습니다.")
        except Exception as e:
            print(f" -> ERROR: 예약 동기화 실패: {e}")

    def create_dashboards(self):
        """옵시디언 Dataview 대시보드 노트 생성"""
        print("\n[2/4] 옵시디언 Dataview 대시보드 노트를 생성 중입니다...")
        
        # 1. 작업일지 대시보드
        dashboard_path = os.path.join(self.cleanbro_dir, "작업일지_대시보드.md")
        dash_content = """# 🧹 클린브로 작업일지 & 매출 대시보드

> [!TIP]
> 이 대시보드가 정상적으로 표/달력 형태로 표시되려면 옵시디언 **Dataview** 플러그인이 활성화되어 있어야 합니다.

## 📅 이번 달 작업 목록
```dataview
TABLE date AS "작업일자", customer_name AS "고객명", category AS "품목", final_price AS "금액(원)", status AS "상태"
FROM "CleanBro/작업일지"
WHERE type = "booking"
SORT date DESC
```

## 💰 월별 완료 작업 총 매출 집계
```dataview
TABLE sum(rows.final_price) AS "총 매출액(원)", count(rows) AS "완료 건수"
FROM "CleanBro/작업일지"
WHERE type = "booking" AND is_completed = true
GROUP BY date.month
```

## 📌 카테고리별 작업 건수
```dataview
TABLE count(rows) AS "작업 건수"
FROM "CleanBro/작업일지"
WHERE type = "booking"
GROUP BY category
```
"""
        with open(dashboard_path, "w", encoding="utf-8") as f:
            f.write(dash_content)

        # 2. 블로그 작성 가이드 대시보드
        blog_dash_path = os.path.join(self.cleanbro_dir, "블로그_대시보드.md")
        blog_dash_content = """# 📝 네이버 블로그 원고 작성 & 포스팅 대시보드

## ✍️ 옵시디언에서 블로그 원고 자동 발행 등록하는 방법
1. `CleanBro/블로그_작성/` 폴더에 새 노트를 만듭니다.
2. 노트 상단에 제목과 태그를 작성합니다:
```markdown
# [속초 에어컨 청소] 여름철 필수 관리 현장 후기

태그: #속초에어컨청소 #클린브로 #에어컨분해청소

여기에 블로그 본문 내용을 자유롭게 작성하세요!
```
3. `run_obsidian_sync.bat`를 실행하면 이 원고가 자동으로 네이버 블로그 자동 포스팅 큐(`blog_queue.json`)에 등록됩니다!

## 📤 등록된 블로그 원고 큐
```dataview
TABLE date AS "등록일", status AS "발행상태"
FROM "CleanBro/블로그"
WHERE type = "blog_post"
SORT date DESC
```
"""
        with open(blog_dash_path, "w", encoding="utf-8") as f:
            f.write(blog_dash_content)

        print(" -> OK: Dataview 대시보드 생성 완료!")

    def sync_blog_queue(self):
        """blog_queue.json 데이터 -> 옵시디언 노출 & 옵시디언 원고 -> blog_queue.json 가져오기"""
        print("\n[3/4] 블로그 원고 큐 및 작성 노트를 동기화 중입니다...")
        queue_path = os.path.join(current_dir, "blog_queue.json")
        
        queue_data = []
        if os.path.exists(queue_path):
            try:
                with open(queue_path, "r", encoding="utf-8") as f:
                    queue_data = json.load(f)
            except Exception as e:
                print(f" -> blog_queue.json 읽기 실패: {e}")

        # 1. blog_queue.json 내용을 옵시디언 폴더로 내보내기
        export_count = 0
        for item in queue_data:
            item_id = item.get("id", "")
            req_data = item.get("request_data", {})
            title = req_data.get("title") or item.get("title") or "제목없음"
            body = req_data.get("body", "")
            tags = req_data.get("tags", [])
            status = item.get("status", "pending")
            created_at = format_date_str(item.get("created_at"))

            fname = f"[{'완료' if status == 'completed' else '대기'}]_{sanitize_filename(title[:30])}.md"
            fpath = os.path.join(self.blog_dir, fname)

            content = f"""---
type: blog_post
id: "{item_id}"
date: {created_at}
status: "{status}"
tags: {json.dumps(tags, ensure_ascii=False)}
---

# {title}

**태그**: {' '.join(tags)}

---

{body}
"""
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(content)
            export_count += 1

        print(f" -> OK: {export_count}개의 블로그 포스팅 원고를 옵시디언 `CleanBro/블로그` 폴더로 내보냈습니다.")

        # 2. 옵시디언 `CleanBro/블로그_작성` 폴더 내 새로운 .md 파일 자동 감지 및 Queue 등록 (역방향 동기화)
        import_count = 0
        draft_files = [os.path.join(self.blog_draft_dir, f) for f in os.listdir(self.blog_draft_dir) if f.endswith(".md") and not f.startswith("[등록완료]")]
        
        import uuid
        for df in draft_files:
            try:
                with open(df, "r", encoding="utf-8") as f:
                    raw_text = f.read()

                lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
                if not lines:
                    continue

                title = lines[0].lstrip("#").strip()
                tags = []
                body_lines = []

                for l in lines[1:]:
                    if l.startswith("태그:") or l.startswith("tags:") or l.startswith("#"):
                        found_tags = re.findall(r'#[\w가-힣]+', l)
                        if found_tags:
                            tags.extend(found_tags)
                        else:
                            body_lines.append(l)
                    else:
                        body_lines.append(l)

                body_text = "\n\n".join(body_lines)
                if not tags:
                    tags = ["#클린브로", "#가전청소"]

                new_queue_item = {
                    "id": str(uuid.uuid4()),
                    "title": title,
                    "request_data": {
                        "title": title,
                        "body": body_text,
                        "tags": list(set(tags)),
                        "photo_alt_texts": []
                    },
                    "status": "pending",
                    "created_at": datetime.now().isoformat()
                }

                queue_data.insert(0, new_queue_item)
                import_count += 1

                # 처리 완료 표시로 파일 이름 변경
                base_name = os.path.basename(df)
                new_df_name = os.path.join(self.blog_draft_dir, f"[등록완료]_{base_name}")
                os.rename(df, new_df_name)

            except Exception as ex:
                print(f" -> ERROR: 옵시디언 드래프트 파싱 실패 ({os.path.basename(df)}): {ex}")

        if import_count > 0:
            with open(queue_path, "w", encoding="utf-8") as f:
                json.dump(queue_data, f, ensure_ascii=False, indent=2)
            print(f" -> SUCCESS: 옵시디언에서 작성한 {import_count}개의 새로운 블로그 원고를 `blog_queue.json` 자동 포스팅 큐에 추가했습니다!")

    def sync_expenses(self, supabase: Client):
        """Supabase expenses 데이터 -> 옵시디언 장부 동기화"""
        print("\n[4/4] Supabase 지출 장부 데이터를 동기화 중입니다...")
        try:
            res = supabase.table("expenses").select("*").order("date_created", desc=True).execute()
            expenses = res.data or []
            print(f" -> 총 {len(expenses)}건의 지출 내역을 수집했습니다.")

            filepath = os.path.join(self.financial_dir, "지출_내역.md")
            
            lines = [
                "# 💳 클린브로 지출 장부\n",
                "| 일자 | 카테고리 | 금액(원) | 증빙(세금계산서/현금영수증) | 메모 |",
                "| --- | --- | --- | --- | --- |"
            ]

            for e in expenses:
                date_str = format_date_str(e.get("date_created") or e.get("created_at"))
                cat = e.get("category") or "일반지출"
                amt = e.get("amount") or 0
                tax_inv = "세금계산서" if e.get("has_tax_invoice") else ""
                cash_rec = "현금영수증" if e.get("has_cash_receipt") else ""
                proof = " / ".join(filter(None, [tax_inv, cash_rec])) or "-"
                memo = e.get("memo") or ""

                lines.append(f"| {date_str} | {cat} | {amt:,} | {proof} | {memo} |")

            with open(filepath, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))

            print(f" -> OK: 옵시디언 장부 파일(`{os.path.relpath(filepath, self.vault_path)}`) 업데이트 완료!")
        except Exception as e:
            print(f" -> ERROR: 지출 장부 동기화 실패: {e}")

def main():
    parser = argparse.ArgumentParser(description="클린브로 - 옵시디언(Obsidian) Vault 데이터 동기화 도구")
    parser.add_argument("--vault", type=str, help="옵시디언 볼트 경로 (미지정 시 .env 의 OBSIDIAN_VAULT_PATH 또는 ./obsidian_vault 사용)")
    args = parser.parse_args()

    print("==================================================")
    print("클린브로 <-> 옵시디언(Obsidian) 자동 동기화 시작")
    print("==================================================")

    sync_tool = ObsidianSync(vault_path=args.vault)
    print(f"[Vault 경로]: {sync_tool.vault_path}")

    try:
        supabase = get_supabase_client()
        sync_tool.sync_bookings(supabase)
        sync_tool.create_dashboards()
        sync_tool.sync_blog_queue()
        sync_tool.sync_expenses(supabase)

        print("\n==================================================")
        print("옵시디언 동기화 작업이 완료되었습니다!")
        print(f"옵시디언 볼트 위치: {sync_tool.vault_path}")
        print("==================================================")
    except Exception as e:
        print(f"\n오류 발생: {e}")

if __name__ == "__main__":
    main()
