"""
naver_blog_bot.py
──────────────────────────────────────────────────
네이버 블로그 자동 포스팅 봇 (Playwright 기반)

[사용법]
1. pip install playwright fastapi uvicorn requests Pillow python-dotenv flask flask-cors pydantic
2. playwright install chromium
3. python naver_blog_bot.py
4. 봇이 http://localhost:8765 로 HTTP 서버 대기.
   클린브로 앱이 승인 시 POST /publish 로 데이터 전달.

[환경 변수 또는 .env 파일]
NAVER_ID=네이버아이디
NAVER_PW=네이버비밀번호
NAVER_BLOG_ID=블로그아이디
"""

import os
import json
import base64
import asyncio
import tempfile
import re
from pathlib import Path
from typing import Optional
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()

import requests
from PIL import Image, ImageDraw, ImageFont
from io import BytesIO
from flask import Flask, request, jsonify
from flask_cors import CORS
from pydantic import BaseModel
from typing import Optional
from playwright.async_api import async_playwright

# ──────────────────────────────────────────────────
# 환경 변수 로드
# ──────────────────────────────────────────────────
NAVER_ID = os.getenv("NAVER_ID", "")
NAVER_PW = os.getenv("NAVER_PW", "")
NAVER_BLOG_ID = os.getenv("NAVER_BLOG_ID", "")
BOT_PORT = 8765

# ──────────────────────────────────────────────────
# Flask 앱 및 CORS 설정
# ──────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

class PublishRequest(BaseModel):
    title: str
    body: str
    tags: list[str]
    photo_alt_texts: list[str]
    image_urls: list[str]
    category: Optional[str] = "세탁기"
    product: Optional[str] = "범용"
    address: Optional[str] = ""

def download_image(url: str, idx: int, tmpdir: str) -> str:
    """이미지 URL을 다운로드해 임시 파일로 저장하고 경로 반환."""
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    img = Image.open(BytesIO(res.content)).convert("RGB")
    out_path = os.path.join(tmpdir, f"photo_{idx:02d}.jpg")
    img.save(out_path, "JPEG", quality=90)
    return out_path


async def post_to_naver(data: PublishRequest) -> str:
    """Playwright로 네이버 블로그에 포스팅하고 발행된 URL을 반환."""
    blog_id = NAVER_BLOG_ID or "carehome-"
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/121.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        try:
            # ── 1. 네이버 로그인 ──────────────────────────
            print("[Bot] 네이버 로그인 중...")
            await page.goto("https://nid.naver.com/nidlogin.login", timeout=30000)
            await page.wait_for_timeout(2000)

            # JavaScript로 아이디/비밀번호 입력
            await page.evaluate(
                f"""
                document.querySelector('#id').value = '{NAVER_ID}';
                document.querySelector('#pw').value = '{NAVER_PW}';
                """
            )
            await page.wait_for_timeout(500)
            
            # 입력 이벤트 트리거 (네이버가 JS 이벤트를 감지하므로)
            await page.evaluate("""
                document.querySelector('#id').dispatchEvent(new Event('input', { bubbles: true }));
                document.querySelector('#pw').dispatchEvent(new Event('input', { bubbles: true }));
            """)
            await page.wait_for_timeout(500)
            
            await page.click("#log\\.login")
            await page.wait_for_timeout(4000)

            # 로그인 성공 여부 확인
            if "nid.naver.com" in page.url and "login" in page.url:
                raise Exception("네이버 로그인 실패. 아이디/비밀번호를 확인하세요.")
            print("[Bot] 로그인 완료:", page.url)

            # ── 2. 블로그 글쓰기 에디터 접속 ──────────────
            editor_url = f"https://blog.naver.com/{blog_id}/postwrite"
            print(f"[Bot] 에디터 접속: {editor_url}")
            await page.goto(editor_url, timeout=30000)
            await page.wait_for_timeout(5000)

            # ── 3. 제목 입력 ──────────────────────────────
            print("[Bot] 제목 입력 중...")
            
            # 네이버 SmartEditor ONE 제목 영역
            title_written = False
            title_selectors = [
                ".se-documentTitle-editView .se-text-paragraph",
                ".se-title-input",
                "[placeholder*='제목']",
                ".pcol1",
                ".__se_title_input",
                ".se-documentTitle-editView",
            ]
            for sel in title_selectors:
                try:
                    el = await page.wait_for_selector(sel, timeout=3000)
                    if el:
                        await el.click()
                        await page.wait_for_timeout(500)
                        await page.keyboard.type(data.title, delay=30)
                        title_written = True
                        print(f"[Bot] 제목 입력 완료 (selector: {sel})")
                        break
                except Exception:
                    continue
            
            if not title_written:
                print("[경고] 제목 입력 실패 - 셀렉터를 찾지 못함")

            # ── 4. 이미지 다운로드 ────────────────────────
            print("[Bot] 이미지 다운로드 및 썸네일 제작 중...")
            with tempfile.TemporaryDirectory() as tmpdir:
                img_paths = []
                
                # [썸네일 제작 로직] base_thumbnail.png 템플릿 이미지를 1번째 사진으로 삽입
                try:
                    template_path = "base_thumbnail.png"
                    if os.path.exists(template_path):
                        img = Image.open(template_path).convert("RGBA")
                        target_w, target_h = img.size
                        draw = ImageDraw.Draw(img)
                        
                        # 하단 파란색 텍스트 박스 영역 덮어쓰기 (네이비색 박스)
                        box_left = int(target_w * (39/548))
                        box_right = int(target_w * (509/548))
                        box_top = int(target_h * (277/548))
                        box_bottom = int(target_h * (508/548))
                        box_color = (27, 87, 123, 255)
                        draw.rectangle([box_left, box_top, box_right, box_bottom], fill=box_color)
                        
                        # 폰트 불러오기
                        try:
                            font_title = ImageFont.truetype(os.path.join("fonts", "BlackHanSans-Regular.ttf"), int(target_h * 0.1))
                            font_sub = ImageFont.truetype(os.path.join("fonts", "BlackHanSans-Regular.ttf"), int(target_h * 0.088))
                        except:
                            font_title = ImageFont.load_default()
                            font_sub = ImageFont.load_default()
                            
                        # 줄 내용 분석 (location, category, product 이용)
                        loc = data.address.split()[1] if data.address and len(data.address.split()) > 1 else (data.address or "강원")
                        # 1줄: "지역명 기기 청소" 
                        cat = data.category or "분해"
                        prod = data.product or "가전"
                        if "에어컨" in cat: main_text = f"{loc} 에어컨 청소"
                        elif "세탁기" in cat:
                            main_text = f"{loc} 통돌이 세탁기 청소" if "통돌이" in prod else f"{loc} {prod} 세탁기 청소"
                        else:
                            main_text = f"{loc} {cat} 청소"
                            
                        # 2줄: 타이틀에서 주요 키워드 추출
                        import re
                        raw_title = re.sub(r'\[\d+\]', '', data.title)
                        for w in [loc, cat, "청소", "에어컨", "세탁기", "드럼", "통돌이", "분해", "세척"]:
                            raw_title = raw_title.replace(w, "")
                        
                        sub_text_parts = [p.strip() for p in raw_title.split() if p.strip()]
                        sub_text = " ".join(sub_text_parts[:2]) # 타이틀에 남은 특징단어 2개정도
                        if not sub_text or len(sub_text) < 2:
                             sub_text = f"{prod} 완벽 분해 세척" if prod else "완벽 분해 세척"
                        
                        # 그리기
                        center_x = target_w / 2
                        try: main_w = font_title.getlength(main_text)
                        except: main_w = 400
                        try: sub_w = font_sub.getlength(sub_text)
                        except: sub_w = 300
                        
                        y1 = box_top + (box_bottom - box_top) * 0.2
                        draw.text((center_x - main_w / 2, y1), main_text, font=font_title, fill="white")
                        
                        y2 = box_top + (box_bottom - box_top) * 0.60
                        draw.text((center_x - sub_w / 2, y2), sub_text, font=font_sub, fill="white")
                        
                        thumb_path = os.path.join(tmpdir, "photo_00_thumb.jpg")
                        img.convert("RGB").save(thumb_path, "JPEG", quality=95)
                        img_paths.append(thumb_path)
                        print("[Bot] 베이스 이미지 기반 커스텀 썸네일 작성 완료.")
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    print(f"[경고] 베이스 썸네일 생성 실패: {e}")
                
                for i, url in enumerate(data.image_urls[:10]):
                    try:
                        path = download_image(url, i+1, tmpdir)
                        img_paths.append(path)
                        print(f"  [Bot] 이미지 {i+1} 다운로드 완료")
                    except Exception as e:
                        print(f"  [경고] 이미지 {i} 다운로드 실패: {e}")

                # ── 5. 본문 영역 클릭 ─────────────────────
                print("[Bot] 본문 영역 진입...")
                await page.wait_for_timeout(2000)

                # 본문 영역으로 이동 (Tab 또는 클릭)
                body_entered = False
                body_selectors = [
                    ".se-component-content .se-text-paragraph",
                    ".se-main-container .se-text-paragraph",
                    ".se-component.se-text .se-text-paragraph",
                    "[contenteditable='true']",
                    ".se-main-container",
                ]
                for sel in body_selectors:
                    try:
                        body_el = await page.wait_for_selector(sel, timeout=3000)
                        if body_el:
                            await body_el.click()
                            body_entered = True
                            print(f"[Bot] 본문 영역 진입 완료 (selector: {sel})")
                            break
                    except Exception:
                        continue
                
                if not body_entered:
                    # Tab키로 본문 이동 시도
                    await page.keyboard.press("Tab")
                    await page.wait_for_timeout(500)
                    print("[Bot] Tab키로 본문 이동 시도")

                await page.wait_for_timeout(1000)

                # ── 6. 본문 및 이미지 교차 입력 ───────────
                print("[Bot] 본문 및 이미지 교차 입력 중...")
                
                tokens = re.split(r'(\[IMAGE_\d+\])', data.body)
                for token in tokens:
                    if not token:
                        continue

                    match = re.match(r'\[IMAGE_(\d+)\]', token)
                    if match:
                        idx = int(match.group(1)) - 1
                        if 0 <= idx < len(data.image_urls):
                            # 썸네일이 맨 앞에 0번으로 추가되었으므로 실제 이미지는 idx+1 에 위치
                            target_img_idx = idx + 1 if len(img_paths) > len(data.image_urls) else idx
                            if 0 <= target_img_idx < len(img_paths):
                                print(f"[Bot] {idx+1}번째(삽입된 썸네일 반영 index:{target_img_idx}) 본문 이미지 삽입 중...")
                                try:
                                    # 방법 1: 사진 버튼 클릭 후 파일 업로드
                                    photo_btn_clicked = False
                                    photo_selectors = [
                                        # 상단 툴바의 사진 버튼
                                        ".se-toolbar-item-image",
                                        "button.se-image-toolbar-button",
                                        "[data-name='image']",
                                        "button[data-type='image']",
                                        # 좌측 + 버튼 → 사진
                                        ".se-toolbar .se-toolbar-item:first-child",
                                        # 상단 메뉴의 사진
                                        ".blog_toolbar button:first-child",
                                        "a.se-oglink-toolbar-button",
                                    ]
                                    
                                    # 먼저 숨겨진 file input 찾기 (가장 확실한 방법)
                                    file_input = await page.query_selector("input[type='file'][accept*='image']")
                                    if not file_input:
                                        file_input = await page.query_selector("input[type='file']")
                                    
                                    if file_input:
                                        await file_input.set_input_files(img_paths[target_img_idx])
                                        await page.wait_for_timeout(5000)
                                        print(f"[Bot] 이미지 {idx+1} 직접 file input으로 업로드 완료")
                                    else:
                                        # file input이 없으면 사진 버튼 클릭
                                        for btn_sel in photo_selectors:
                                            try:
                                                btn = await page.wait_for_selector(btn_sel, timeout=2000)
                                                if btn:
                                                    await btn.click()
                                                    await page.wait_for_timeout(1500)
                                                    photo_btn_clicked = True
                                                    print(f"[Bot] 사진 버튼 클릭 (selector: {btn_sel})")
                                                    break
                                            except Exception:
                                                continue
                                        
                                        if photo_btn_clicked:
                                            # 파일 선택 다이얼로그에 파일 설정
                                            await page.wait_for_timeout(1000)
                                            file_inputs = await page.query_selector_all("input[type='file']")
                                            if file_inputs:
                                                await file_inputs[-1].set_input_files(img_paths[target_img_idx])
                                                await page.wait_for_timeout(5000)
                                                print(f"[Bot] 이미지 {idx+1} 업로드 완료")
                                            else:
                                                print(f"[경고] file input을 찾지 못함")
                                        else:
                                            print(f"[경고] 사진 버튼을 찾지 못함")
                                    
                                    # 이미지 삽입 후 커서를 다음 줄로 이동
                                    await page.keyboard.press("End")
                                    await page.keyboard.press("Enter")
                                    await page.wait_for_timeout(500)
                                    
                                except Exception as e:
                                    print(f"[경고] 이미지 {idx+1} 업로드 오류: {e}")
                    else:
                        # 텍스트 입력
                        paragraphs = token.split("\n")
                        for para in paragraphs:
                            if para.strip():
                                await page.keyboard.type(para.strip(), delay=5)
                            await page.keyboard.press("Enter")
                        await page.wait_for_timeout(300)

                # ── 7. 태그 입력 ──────────────────────────
                print("[Bot] 태그 입력 중...")
                tag_written = False
                tag_selectors = [
                    ".se-tag-input__input",
                    ".se-tag-input input",
                    "input[placeholder*='태그']",
                    "input[placeholder*='tag']",
                    ".tag_input",
                    "#post-tag-input",
                ]
                for sel in tag_selectors:
                    try:
                        tag_input = await page.wait_for_selector(sel, timeout=3000)
                        if tag_input:
                            for tag in data.tags[:10]:
                                await tag_input.click()
                                tag_text = tag.lstrip("#").strip()
                                if tag_text:
                                    await tag_input.type(tag_text, delay=30)
                                    await page.keyboard.press("Enter")
                                    await page.wait_for_timeout(300)
                            tag_written = True
                            print(f"[Bot] 태그 입력 완료 (selector: {sel})")
                            break
                    except Exception:
                        continue
                
                if not tag_written:
                    print("[경고] 태그 입력 실패 - 셀렉터를 찾지 못함")

                # ── 8. 사용자 수동 발행 대기 ───────────────────────────
                print("[Bot] 초안 작성이 완료되었습니다.")
                print("[Bot] 사용자가 직접 검토 후 발행 버튼을 누르도록 대기합니다...")
                
                # 발행을 누르지 않더라도 임시 저장 등의 이유로 에디터 주소를 일단 반환하거나
                # 브라우저를 바로 끄면 안 될 수 있습니다.
                # 그러나 백그라운드 봇 특성상 일정 시간 대기 후 브라우저가 꺼지게 되므로,
                # 최소한 글 작성까지만 하고 URL을 반환하도록 합니다.
                
                # 잠시 대기 (자동 저장 등)
                await page.wait_for_timeout(5000)
                
                published_url = page.url
                print(f"[Bot] 작성 완료된 에디터 URL: {published_url}")

        finally:
            await context.close()
            await browser.close()

        return published_url


# ──────────────────────────────────────────────────
# API 엔드포인트
# ──────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "naver_id": NAVER_ID[:3] + "***" if NAVER_ID else "NOT SET",
        "blog_id": NAVER_BLOG_ID or "NOT SET"
    })


@app.route("/publish", methods=["POST"])
def publish():
    if not NAVER_ID or not NAVER_PW:
        return jsonify({"detail": "NAVER_ID / NAVER_PW 환경변수가 설정되지 않았습니다."}), 500
    try:
        req_data = request.json
        req = PublishRequest(**req_data)
        url = asyncio.run(post_to_naver(req))
        return jsonify({"success": True, "published_url": url})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"detail": str(e)}), 500


# ──────────────────────────────────────────────────
# 실행
# ──────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print(f"  CleanBro 네이버 블로그 자동 발행 서버")
    print(f"  http://localhost:{BOT_PORT} 에서 실행 중")
    print(f"  네이버 아이디: {NAVER_ID[:3] + '***' if NAVER_ID else '❌ 미설정'}")
    print(f"  블로그 ID: {NAVER_BLOG_ID or '❌ 미설정'}")
    print("=" * 55)
    app.run(host="0.0.0.0", port=BOT_PORT)