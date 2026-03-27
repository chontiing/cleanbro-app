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
import threading
import time
import uuid
import random
from dotenv import load_dotenv
load_dotenv()

import pyperclip
import requests
from PIL import Image
from io import BytesIO
from flask import Flask, request, jsonify
from flask_cors import CORS
from pydantic import BaseModel
from typing import Optional
from playwright.sync_api import sync_playwright

# ──────────────────────────────────────────────────
# 환경 변수 로드
# ──────────────────────────────────────────────────
NAVER_ID = os.getenv("NAVER_ID", "")
NAVER_PW = os.getenv("NAVER_PW", "")
NAVER_BLOG_ID = os.getenv("NAVER_BLOG_ID", "")
BOT_PORT = 8765

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("VITE_SUPABASE_ANON_KEY", "")

# ──────────────────────────────────────────────────
# 예약 발행 큐 관리 로직 (Supabase 기반)
# ──────────────────────────────────────────────────
def fetch_pending_supabase_task():
    try:
        url = f"{SUPABASE_URL}/rest/v1/bookings?category=eq.블로그자동화&product=eq.pending&order=id.asc&limit=1"
        headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        res = requests.get(url, headers=headers)
        if res.status_code == 200:
            data = res.json()
            if data: return data[0]
    except Exception as e:
        print(f"Supabase GET 에러: {e}")
    return None

def update_supabase_task(task_id, status, error_msg=None, published_url=None, new_memo_dict=None):
    try:
        req_url = f"{SUPABASE_URL}/rest/v1/bookings?id=eq.{task_id}"
        headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "return=representation"}
        
        # 기존 memo 가져오기
        res = requests.get(req_url, headers=headers)
        memo_dict = {}
        if res.status_code == 200 and res.json():
            try: memo_dict = json.loads(res.json()[0].get('memo', '{}'))
            except: pass
            
        if new_memo_dict:
            memo_dict.update(new_memo_dict)

        if published_url: memo_dict['published_url'] = published_url
        if error_msg: 
            memo_dict['error'] = error_msg
        elif status == "작성 완료" or status == "completed":
            memo_dict['error'] = None # 성공 시 에러 메시지 초기화
        
        payload = {
            "product": status,
            "memo": json.dumps(memo_dict, ensure_ascii=False)
        }
        if status == "completed" or "완료" in status:
            payload["is_completed"] = True
            
        requests.patch(req_url, headers=headers, json=payload)
    except Exception as e:
        print(f"Supabase PATCH 에러: {e}")

def generate_draft_via_edge(memo_dict):
    url = f"{SUPABASE_URL}/functions/v1/generate-blog-draft"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    req_body = {
        "imageUrls": memo_dict.get("image_urls", [])[:10],
        "category": memo_dict.get("category", "에어컨"),
        "product": memo_dict.get("product", "범용"),
        "address": memo_dict.get("address", ""),
        "customerName": memo_dict.get("customer_name", ""),
        "memo": f"카테고리: {memo_dict.get('category')}, 품목: {memo_dict.get('product')}",
        "businessProfile": memo_dict.get("businessProfile", {}),
        "aiGuidelines": memo_dict.get("aiGuidelines", "")
    }
    
    max_retries = 3
    for attempt in range(1, max_retries + 1):
        print(f"[Bot] AI 서버(Gemini)에 블로그 초안 생성 요청 중... (시도 {attempt}/{max_retries})")
        res = requests.post(url, json=req_body, headers=headers)
        if res.status_code == 200:
            data = res.json()
            if "error" in data:
                err_msg = data["error"]
                print(f"[Bot] AI 초안 생성 에러 응답: {err_msg}")
                if attempt < max_retries and ("503" in err_msg or "UNAVAILABLE" in err_msg or "오류" in err_msg or "실패" in err_msg):
                    print(f"[Bot] 10초 대기 후 재시도합니다...")
                    time.sleep(10)
                    continue
                raise Exception(f"AI 초안 생성 실패: {err_msg}")
                
            draft = data.get("draft")
            if not draft:
                raise Exception("AI 초안 생성 실패: draft 필드가 없습니다.")
            return draft
        else:
            if attempt < max_retries:
                print(f"[Bot] 서버 에러 ({res.status_code}). 10초 후 재시도...")
                time.sleep(10)
                continue
            raise Exception(f"AI 초안 생성 실패 (HTTP {res.status_code}): {res.text}")

def post_karrot_news(draft, image_url, business_id=None):
    if not draft.get("karrotText"): return
    try:
        url = f"{SUPABASE_URL}/rest/v1/social_posts"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "business_id": business_id,
            "blog_title": draft.get("title", ""),
            "karrot_content": draft.get("karrotText", ""),
            "image_url": image_url
        }
        requests.post(url, json=payload, headers=headers)
        print("[Bot] 당근마켓 소식 DB 저장 완료")
    except Exception as e:
        print(f"[Bot] 당근소식 저장 실패: {e}")

def schedule_loop():
    print("[스케줄러] Supabase 대기열 감시 시작 (60초 주기)")
    while True:
        try:
            task = fetch_pending_supabase_task()
            if task:
                task_id = task['id']
                try:
                    memo_dict = json.loads(task.get('memo', '{}'))
                    
                    # 1. 모바일 앱에서 위임한 AI 초안 생성이 필요한 경우 처리
                    if memo_dict.get("needs_gemini"):
                        update_supabase_task(task_id, "processing")
                        print(f"\n[스케줄러] 모바일 AI 초안 위임 감지 (ID: {task_id}) - Gemini 요청 시작...")
                        draft = generate_draft_via_edge(memo_dict)
                        
                        memo_dict["title"] = draft.get("title", "제목 없음")
                        memo_dict["body"] = draft.get("body", "")
                        memo_dict["tags"] = draft.get("tags", [])
                        memo_dict["photo_alt_texts"] = draft.get("photoAltTexts", [])
                        memo_dict["needs_gemini"] = False # 처리 완료 마크
                        
                        # 당근 소식 DB 저장
                        img_urls = memo_dict.get("image_urls", [])
                        post_karrot_news(draft, img_urls[0] if img_urls else None, task.get("business_id"))
                        
                        # 생성된 텍스트를 DB로 한 번 안전하게 저장해 둡니다
                        update_supabase_task(task_id, "processing", new_memo_dict=memo_dict)

                    memo_dict["service_type"] = task.get("service_type") or memo_dict.get("category", "에어컨")
                    memo_dict["model_name"] = task.get("model_name") or memo_dict.get("product", "범용")
                    req_data = PublishRequest(**memo_dict)
                    req_data.save_as_draft = True # 사용자 요청: 항상 임시저장으로 처리
                    print(f"\\n[스케줄러] 네이버 블로그 발행 작업 시작 (ID: {task_id}) - {req_data.title}")
                    
                    if not memo_dict.get("needs_gemini"):
                        update_supabase_task(task_id, "processing")
                        
                    url = post_to_naver(req_data)
                    
                    print(f"[스케줄러] 발행 성공! URL: {url}")
                    update_supabase_task(task_id, "작성 완료", published_url=url, new_memo_dict={"title": req_data.title})
                    
                except Exception as e:
                    print(f"[스케줄러] 작업 실패: {e}")
                    update_supabase_task(task_id, "failed", error_msg=str(e))
                
                # 발행 작업 후 랜덤 딜레이 대기 (실제론 12~24시간 랜덤, 테스트/현재는 60초)
                print("[스케줄러] 60초간 대기합니다...")
                time.sleep(60)
                continue
                
        except Exception as e:
            print(f"[스케줄러] 메인 루프 에러: {e}")
            
        # 매일 아침 8시경 (8시 0분 ~ 8시 30분 사이) 오늘 일정 알림(Morning SMS) 트리거
        now = datetime.now()
        if now.hour == 8 and now.minute < 30:
            if not getattr(schedule_loop, "morning_sms_sent_today", False):
                print(f"[스케줄러/시스템] ☀️ 아침 8시가 넘어 고객 모닝 알림 문자를 일괄 트리거합니다.")
                try:
                    m_res = requests.post(
                        f"{SUPABASE_URL}/functions/v1/send-sms",
                        json={"action": "send_morning_reminders"},
                        headers={"Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}
                    )
                    print(f"[스케줄러/시스템] 모닝 트리거 완료: {m_res.status_code}")
                    schedule_loop.morning_sms_sent_today = True
                except Exception as e:
                    print(f"[스케줄러/오류] 모닝 알림 트리거 실패: {e}")
        elif now.hour >= 9:
            schedule_loop.morning_sms_sent_today = False
            
        # 5초마다 큐 상태 체크 (더 빠르게 반응하도록 수정)
        time.sleep(5)

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
    save_as_draft: Optional[bool] = True
    service_type: Optional[str] = "에어컨"
    model_name: Optional[str] = "LG 듀얼"
    aiGuidelines: Optional[str] = ""


def download_image(url: str, idx: int, tmpdir: str, prefix: str = "sokcho-aircon-clean-cleanbro") -> str:
    """이미지 URL을 다운로드해 임시 파일로 저장하고 경로 반환."""
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    img = Image.open(BytesIO(res.content)).convert("RGB")
    out_path = os.path.join(tmpdir, f"{prefix}-{idx+1}.jpg")
    img.save(out_path, "JPEG", quality=90)
    return out_path


def post_to_naver(data: PublishRequest) -> str:
    """Playwright로 네이버 블로그에 포스팅하고 발행된 URL을 반환."""
    blog_id = NAVER_BLOG_ID or "carehome-"
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/121.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()

        try:
            # ── 1. 네이버 로그인 ──────────────────────────
            print("[Bot] 네이버 로그인 중...")
            page.goto("https://nid.naver.com/nidlogin.login", timeout=30000)
            page.wait_for_timeout(2000)

            # JavaScript 주입 대신 사람이 직접 복사/붙여넣기 하는 방식으로 우회 (자동입력 방지 방어)
            page.click('#id')
            pyperclip.copy(NAVER_ID)
            page.keyboard.down('Control')
            page.keyboard.press('v')
            page.keyboard.up('Control')
            page.wait_for_timeout(1000)

            page.click('#pw')
            pyperclip.copy(NAVER_PW)
            page.keyboard.down('Control')
            page.keyboard.press('v')
            page.keyboard.up('Control')
            page.wait_for_timeout(1000)
            
            page.click("#log\\.login")
            page.wait_for_timeout(4000)

            # 로그인 성공 여부 확인
            if "nid.naver.com" in page.url and "login" in page.url:
                raise Exception("네이버 로그인 실패. 아이디/비밀번호를 확인하세요.")
            print("[Bot] 로그인 완료:", page.url)

            # ── 2. 블로그 글쓰기 에디터 접속 ──────────────
            editor_url = f"https://blog.naver.com/{blog_id}/postwrite"
            
            # 카테고리 식별 (인스턴티는 categoryNo=22)
            if getattr(data, 'category', '') == '인스턴티':
                editor_url += "?categoryNo=22"

            print(f"[Bot] 에디터 접속: {editor_url}")
            page.goto(editor_url, timeout=30000)
            page.wait_for_timeout(5000)

            # ── 2.1 팝업 처리 (작성중인 글이 있습니다 등) ──
            print("[Bot] 팝업 체크 중...")
            page.wait_for_timeout(2000)
            
            try:
                # 팝업 대화상자가 떴는지 전체적으로 검사
                # 네이버 블로그는 "이전에 작성 중이던 글이 있습니다.", "작성중인 글이 있습니다" 등으로 표시됩니다.
                cancel_clicked = False
                
                # 시도 1: 명시적인 취소 버튼 클래스 찾기
                cancel_btn = page.locator(".se-popup-button-cancel").first
                if cancel_btn.is_visible(timeout=3000):
                    print("[Bot] 팝업 발견 (종류: se-popup-button-cancel). '취소' 클릭.")
                    cancel_btn.click(timeout=2000)
                    cancel_clicked = True
                    
                # 시도 2: 텍스트로 찾기
                if not cancel_clicked:
                    popup_texts = ["작성 중이던 글", "작성중인 글", "이어서 작성", "저장된 글"]
                    for p_text in popup_texts:
                        if page.locator(f"text='{p_text}'").is_visible():
                            print(f"[Bot] 팝업 발견 (텍스트: {p_text}). '취소' 버튼 탐색.")
                            # 동일한 팝업 내의 취소 버튼을 찾습니다. 보통 취소/확인이 세트입니다.
                            btn = page.get_by_role("button", name="취소").first
                            if btn.is_visible():
                                btn.click(timeout=2000)
                                cancel_clicked = True
                                break
                                
                if cancel_clicked:
                    page.wait_for_timeout(2000)
                    
                # 가끔 뜨는 도움말/공지 팝업 닫기
                if page.get_by_text("도움말").first.is_visible(timeout=1000):
                    page.locator("button.se-popup-button-close").first.click(timeout=2000)
                    page.wait_for_timeout(500)
            except Exception as e:
                print(f"[Bot] 팝업 처리 오류 (무시하고 계속): {e}")


            # ── 3. 제목 입력 ──────────────────────────────
            print("[Bot] 제목 입력 중...")
            
            # 네이버 SmartEditor ONE 제목 영역
            title_written = False
            title_selectors = [
                ".se-title-text",
                ".se-documentTitle",
                "span:text-is('제목')",
                "span:has-text('제목')",
                ".se-documentTitle-editView .se-text-paragraph",
                "[placeholder*='제목']",
            ]
            for sel in title_selectors:
                try:
                    el = page.wait_for_selector(sel, timeout=3000)
                    if el:
                        el.click()
                        page.wait_for_timeout(500)
                        page.keyboard.type(data.title, delay=30)
                        title_written = True
                        print(f"[Bot] 제목 입력 완료 (selector: {sel})")
                        break
                except Exception:
                    continue
            
            if not title_written:
                print("[경고] 제목 입력 실패 - 셀렉터를 찾지 못함")

            # ── 4. 이미지 다운로드 ────────────────────────
            print("[Bot] 이미지 다운로드 중...")
            with tempfile.TemporaryDirectory() as tmpdir:
                img_paths = []
                # 제목에서 지역명 추출하여 영문 접두사 생성 (이미지 OCR 검색 최적화)
                region_eng = "sokcho"
                if "고성" in data.title: region_eng = "goseong"
                elif "양양" in data.title: region_eng = "yangyang"
                elif "강릉" in data.title: region_eng = "gangneung"
                prefix = f"{region_eng}-aircon-clean-cleanbro"
                
                for i, url in enumerate(data.image_urls[:10]):
                    try:
                        path = download_image(url, i, tmpdir, prefix)
                        img_paths.append(path)
                        print(f"  [Bot] 이미지 {i+1} 다운로드 완료 ({prefix}-{i+1}.jpg)")
                    except Exception as e:
                        print(f"  [경고] 이미지 {i} 다운로드 실패: {e}")

                # ── 5. 본문 영역 클릭 ─────────────────────
                print("[Bot] 본문 영역 진입...")
                page.wait_for_timeout(2000)

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
                        body_el = page.wait_for_selector(sel, timeout=3000)
                        if body_el:
                            body_el.click()
                            body_entered = True
                            print(f"[Bot] 본문 영역 진입 완료 (selector: {sel})")
                            break
                    except Exception:
                        continue
                
                if not body_entered:
                    # Tab키로 본문 이동 시도
                    page.keyboard.press("Tab")
                    page.wait_for_timeout(500)
                    print("[Bot] Tab키로 본문 이동 시도")

                page.wait_for_timeout(1000)

                # ── 5.5 대표 썸네일 자동 생성 및 업로드 ──────────────────
                print("[Bot] 대표 썸네일 생성 및 업로드 시도 중...")
                try:
                    from thumbnail_generator import create_thumbnail
                    thumb_path = create_thumbnail(
                        service_type=data.service_type, 
                        model_name=data.model_name,
                        output_path=os.path.join(tmpdir, f"main-thumb-{prefix}.jpg")
                    )
                    if thumb_path and os.path.exists(thumb_path):
                        # 파일 업로드 (1번째 이미지이므로 에디터가 자동 대표 지정함)
                        with page.expect_file_chooser() as fc_info:
                            photo_btn = page.locator("button[data-type='image'], button.se-image-toolbar-button").first
                            photo_btn.click(timeout=3000)
                        file_chooser = fc_info.value
                        file_chooser.set_files(thumb_path)
                        print("[Bot] 대표 썸네일 업로드 성공!")
                        page.wait_for_timeout(3000) # 업로드 대기
                        
                        # 썸네일을 대표사진으로 명시적 클릭 시도 (선택 사항)
                        try:
                            # 방금 추가된 이미지를 클릭
                            img_el = page.locator(".se-image-resource").last
                            if img_el.count() > 0:
                                img_el.click(timeout=1000)
                                page.wait_for_timeout(500)
                                # '대표' 버튼 클릭
                                rep_btn = page.locator("button.se-inline-image-button-represent, button:has-text('대표')").first
                                if rep_btn.count() > 0:
                                    rep_btn.click(timeout=1000)
                                    print("[Bot] 대표 사진 뱃지 명시적 활성화 성공")
                        except Exception as e_rep:
                            print(f"[경고] 대표 사진 강제 클릭 실패(무시): {e_rep}")
                        
                        # 사진 밑으로 커서 이동 후 한 줄 띄우기
                        page.keyboard.press("End")
                        page.keyboard.press("Enter")
                        page.wait_for_timeout(500)
                except Exception as e_thumb:
                    print(f"[경고] 썸네일 생성/업로드 중 오류: {e_thumb}")

                # ── 6. 본문 및 이미지 교차 입력 ───────────
                print("[Bot] 본문 및 이미지 교차 입력 중...")
                
                tokens = re.split(r'(\[IMAGE_\d+\])', data.body)
                for token in tokens:
                    if not token:
                        continue

                    match = re.match(r'\[IMAGE_(\d+)\]', token)
                    if match:
                        idx = int(match.group(1)) - 1
                        if 0 <= idx < len(img_paths):
                            print(f"[Bot] {idx+1}번째 이미지 삽입 중...")
                            try:
                                # 방법 1: Playwright file_chooser 활용 (가장 안정적이고 추천되는 방식)
                                photo_btn_clicked = False
                                photo_selectors = [
                                    ".se-toolbar-item-image button",
                                    ".se-toolbar-item-image",
                                    "button.se-image-toolbar-button",
                                    "[data-name='image']",
                                    "button[data-type='image']",
                                    ".se-toolbar .se-toolbar-item:first-child",
                                    ".blog_toolbar button:first-child",
                                    "a.se-oglink-toolbar-button",
                                ]
                                
                                for btn_sel in photo_selectors:
                                    try:
                                        btn = page.query_selector(btn_sel)
                                        if btn and btn.is_visible():
                                            with page.expect_file_chooser(timeout=3000) as fc_info:
                                                btn.click()
                                            file_chooser = fc_info.value
                                            file_chooser.set_files(img_paths[idx])
                                            page.wait_for_timeout(7000) # 업로드 대기 시간
                                            photo_btn_clicked = True
                                            print(f"[Bot] 이미지 {idx+1} 업로드 완료 (filechooser 기반)")
                                            break
                                    except Exception as e:
                                        continue
                                
                                if not photo_btn_clicked:
                                    # 방법 2: 숨겨진 file input 찾기 (Fallback)
                                    file_inputs = page.query_selector_all("input[type='file'][accept*='image']")
                                    if not file_inputs:
                                        file_inputs = page.query_selector_all("input[type='file']")
                                    
                                    if file_inputs:
                                        file_inputs[-1].set_input_files(img_paths[idx])
                                        page.wait_for_timeout(7000)
                                        print(f"[Bot] 이미지 {idx+1} 직접 file input(마지막 요소)으로 업로드 완료 (Fallback)")
                                    else:
                                        print(f"[경고] 사진 버튼 및 file input을 찾지 못함")
                                        
                                page.wait_for_timeout(1000)
                                
                                # 이미지 삽입 후 커서를 다음 줄로 이동
                                page.keyboard.press("End")
                                page.keyboard.press("Enter")
                                page.wait_for_timeout(500)
                                
                            except Exception as e:
                                print(f"[경고] 이미지 {idx+1} 업로드 오류: {e}")
                    else:
                        # 텍스트 입력
                        paragraphs = token.split("\n")
                        for para in paragraphs:
                            if para.strip():
                                page.keyboard.type(para.strip(), delay=15)
                            page.keyboard.press("Enter")
                        page.wait_for_timeout(500)
                        
                # ── 6.4 추가 링크 (인스턴티 전용 플레이스 등) ─────────────────────────
                if data.category == "인스턴티" or data.service_type == "인스턴티":
                    print("[Bot] 인스턴티 전용 플레이스 주소 링크 추가 중...")
                    try:
                        page.keyboard.press("Control+End")
                        page.keyboard.press("Enter")
                        page.keyboard.press("Enter")
                        # 텍스트 + 링크 주소를 함께 기입
                        link_text = "📍 인스턴티 매장 오시는 길 및 안내 📍\nhttps://naver.me/F1ap5TAh\n"
                        page.keyboard.type(link_text, delay=20)
                        # 엔터 여러 번 눌러서 OG 링크 박스가 확실히 생성되게 유도
                        page.keyboard.press("Enter")
                        page.wait_for_timeout(2000)
                    except Exception as e:
                        print(f"[경고] 인스턴티 링크 추가 실패: {e}")
                        
                # ── 6.5 장소(Map) 추가 로직 ──────────────────────────
                print("[Bot] 장소(Map) 컴포넌트 맨 밑에 추가 중...")
                try:
                    # 커서를 문서 맨 끝으로 완벽히 이동 (Windows 환경: Ctrl+End)
                    page.keyboard.press("Control+End")
                    page.keyboard.press("Enter")
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(1000)

                    # 1. 툴바에서 '장소' 버튼 클릭
                    place_btn = page.locator("button[data-type='place'], button.se-place-toolbar-button").first
                    if place_btn.count() > 0:
                        place_btn.click(timeout=3000)
                        page.wait_for_timeout(2000)
                        
                        # 2. 장소 검색 팝업 내부 인풋
                        search_input = page.locator("input.se-popup-place-search-input, .se-place-search-input, input[placeholder*='장소']").first
                        if search_input.count() > 0:
                            place_keyword = "인스턴티" if getattr(data, 'category', '') == '인스턴티' or getattr(data, 'service_type', '') == '인스턴티' else "클린브로"
                            search_input.fill(place_keyword)
                            search_input.press("Enter")
                            page.wait_for_timeout(2000)
                            
                            # 3. 추가 버튼 클릭 (.se-place-search-add-button 등)
                            add_btn = page.locator("button:has-text('추가'), .se-place-search-add-button, .se-place-list-item button").first
                            if add_btn.count() > 0:
                                add_btn.click()
                                page.wait_for_timeout(1000)
                                
                                # 4. 완료/확인 버튼 클릭
                                confirm_btn = page.locator("button:has-text('확인'), .se-place-confirm-button, button:has-text('완료')").first
                                if confirm_btn.count() > 0:
                                    confirm_btn.click()
                                    page.wait_for_timeout(2000)
                                    print("[Bot] 장소(Map) 컴포넌트 성공적으로 추가됨.")
                except Exception as e:
                    print(f"[경고] 장소 컴포넌트 추가 실패: {e}")

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
                        tag_input = page.wait_for_selector(sel, timeout=1000)
                        if tag_input:
                            for tag in data.tags[:10]:
                                tag_input.click()
                                tag_text = tag.lstrip("#").strip()
                                if tag_text:
                                    tag_input.type(tag_text, delay=30)
                                    page.keyboard.press("Enter")
                                    page.wait_for_timeout(300)
                            tag_written = True
                            print(f"[Bot] 태그 입력 완료 (selector: {sel})")
                            break
                    except Exception:
                        continue
                
                if not tag_written:
                    print("[경고] 태그 입력 실패 - 셀렉터를 찾지 못함")

                if data.save_as_draft:
                    print("[Bot] 임시저장/발행 전 이미지 업로드 안정화 대기 (10초)...")
                    page.wait_for_timeout(10000)
                    print("[Bot] 임시저장 시도 중...")
                    page.wait_for_timeout(1000)
                    draft_saved = False
                    
                    draft_selectors = [
                        "button.btn_save",
                        "button:has-text('저장')",
                        ".p_btn_save",
                        ".se-publish-save-btn",
                        "span:has-text('저장')",
                        ".btn_save"
                    ]
                    
                    for sel in draft_selectors:
                        try:
                            save_btn = page.locator(sel).first
                            # is_visible() 이 다른 투명 레이어 때문에 False일 수 있으므로 강제(force) 클릭 시도
                            if save_btn.count() > 0:
                                print(f"[Bot] 임시저장 버튼 발견 시도: (selector: {sel})")
                                save_btn.click(timeout=3000, force=True)
                                page.wait_for_timeout(3000)
                                draft_saved = True
                                break
                        except Exception:
                            continue
                            
                    if not draft_saved:
                        try:
                            # 최후의 수단: 텍스트로 찾기 (강제 클릭)
                            save_btn = page.locator("text='저장'").first
                            if save_btn.count() > 0:
                                print("[Bot] 임시저장 버튼 발견 (텍스트 검색)")
                                save_btn.click(timeout=3000, force=True)
                                page.wait_for_timeout(3000)
                                draft_saved = True
                        except Exception as e:
                            print(f"[Bot] 텍스트 검색 실패: {e}")

                    if draft_saved:
                        print("[Bot] 임시저장 완료!")
                        return "[임시저장 완료] " + editor_url
                    else:
                        raise Exception("임시저장 버튼을 찾지 못했습니다.")

                # ── 8. 발행 ───────────────────────────────
                print("[Bot] 발행 시도 중...")
                page.wait_for_timeout(1000)
                
                published = False
                
                try:
                    main_btn = page.locator("button, a").filter(has_text="발행").locator("visible=true").first
                    if main_btn.count() > 0:
                        print(f"[Bot] 1단계 발행 버튼 찾아냄: {main_btn.inner_text()}")
                        main_btn.evaluate("el => el.click()")
                        page.wait_for_timeout(2000)
                        
                        try:
                            # 1단계 누른 직후 모달 스크린샷 캡처
                            page.screenshot(path="debug_panel.png")
                        except: pass
                    
                    final_btn = page.locator("button, a").filter(has_text="발행").filter(has_not_text="0건").filter(has_not_text="예약").filter(has_not_text="취소").locator("visible=true").last
                    if final_btn.count() > 0:
                        print(f"[Bot] 2단계 최종 발행 버튼 찾아냄: {final_btn.inner_text()}")
                        final_btn.evaluate("el => el.click()")
                        page.wait_for_timeout(10000) # 발행 후 충분히 대기
                        published = True

                except Exception as e:
                    print(f"[경고] 발행 단계 오류: {e}")

                if not published:
                    print("[경고] 발행 버튼을 여러 번 탐색해도 실패하여 백업 클릭을 시도합니다.")
                    try:
                        blist = page.locator("text='발행'")
                        count = blist.count()
                        for i in range(count):
                            print(f"[Bot] 백업 탐색 클릭 {i+1}번째: {blist.nth(i).inner_text()}")
                            blist.nth(i).evaluate("el => el.click()")
                            page.wait_for_timeout(2000)
                    except Exception as e:
                        print(f"[경고] 백업 탐색 실패: {e}")
                
                 # 무조건 최종 스크린샷 저장
                try:
                    page.screenshot(path="debug_final.png")
                except: pass

                # 최종 URL 확인
                page.wait_for_timeout(5000)
                published_url = page.url
                
                # SmartEditor ONE은 발행 후 보통 blog.naver.com/아이디/글번호 형태나 메인으로 이동함
                # postwrite가 여전히 URL에 있으면 명백한 실패
                if "postwrite" in published_url:
                    print(f"[경고] 1차 발행 시도 후 여전히 에디터에 머물러 있습니다. (URL: {published_url})")
                    # 3단계: 아주 원시적인 방법으로 다시 시도
                    try:
                        # 화면상의 모든 '발행' 글자를 가진 버튼/링크를 다 눌러봅니다.
                        all_publish_btns = page.locator("button, a, span").filter(has_text="발행").locator("visible=true")
                        btn_count = all_publish_btns.count()
                        print(f"[Bot] '발행' 텍스트 포함 요소 {btn_count}개 발견. 순차 클릭 시도...")
                        for i in range(btn_count):
                            target = all_publish_btns.nth(i)
                            txt = target.inner_text().strip()
                            if txt == "발행":
                                print(f"[Bot] ({i+1}/{btn_count}) 정확히 '발행' 버튼 클릭")
                                target.evaluate("el => el.click()")
                                page.wait_for_timeout(5000)
                                if "postwrite" not in page.url:
                                    print("[Bot] 발행 성공 감지!")
                                    break
                    except Exception as e:
                        print(f"[경고] 최종 복구 시도 중 에러: {e}")
                
                published_url = page.url
                print(f"[Bot] 최종 URL 확인 결과: {published_url}")
                
                if "postwrite" in published_url:
                    raise Exception(f"발행 버튼을 눌렀으나 페이지가 전환되지 않았습니다. (현재 URL: {published_url})")

        finally:
            context.close()
            browser.close()

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
        url = post_to_naver(req)
        return jsonify({"success": True, "published_url": url})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"detail": str(e)}), 500


@app.route("/draft", methods=["POST"])
def draft():
    if not NAVER_ID or not NAVER_PW:
        return jsonify({"detail": "NAVER_ID / NAVER_PW 환경변수가 설정되지 않았습니다."}), 500
    try:
        req_data = request.json
        req_data["save_as_draft"] = True
        req = PublishRequest(**req_data)
        url = post_to_naver(req)
        return jsonify({"success": True, "published_url": url})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"detail": str(e)}), 500


@app.route("/schedule", methods=["POST"])
def schedule_publish():
    if not NAVER_ID or not NAVER_PW:
        return jsonify({"detail": "NAVER_ID / NAVER_PW 환경변수가 설정되지 않았습니다."}), 500
        
    try:
        req_data = request.json
        req = PublishRequest(**req_data)
        
        with queue_lock:
            pending_items = [q for q in blog_queue if q.get("status") in ["pending", "processing"]]
            if len(pending_items) >= 30:
                return jsonify({"detail": "예약 대기열이 가득 찼습니다 (최대 30개)."}), 400
                
            now = datetime.now().timestamp()
            latest_time = now
            if pending_items:
                latest_time = max(item.get("scheduled_for", now) for item in pending_items)
                
            # 12시간 ~ 24시간 사이의 임의(Random) 시간 간격 (43200초 ~ 86400초)
            random_delay = random.randint(43200, 86400)
            
            # 마지막 예약 시간(또는 현재) 기준 12~24시간 후
            next_time = max(now, latest_time) + random_delay
            
            dt_str = datetime.fromtimestamp(next_time).strftime('%Y-%m-%d %H:%M:%S')
            
            queue_item = {
                "id": str(uuid.uuid4()),
                "title": req.title,
                "request_data": req_data,
                "scheduled_for": next_time,
                "scheduled_for_text": dt_str,
                "status": "pending",
                "created_at": now
            }
            
            blog_queue.append(queue_item)
            blog_queue.sort(key=lambda x: x.get("scheduled_for", 0))
            save_queue(blog_queue)
            
        return jsonify({
            "success": True, 
            "message": f"예약이 접수되었습니다! 예상 발행 시간: {dt_str}",
            "expected_time": dt_str,
            "item_id": queue_item["id"]
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"detail": str(e)}), 500

@app.route("/ai_meeting", methods=["POST"])
def ai_meeting():
    try:
        req_data = request.json
        issue = req_data.get("issue", "검색 노출 누락 또는 조회수 저조")
        category = req_data.get("category", "일반")
        
        system_prompt = f"""당신은 블로그 성과 개선을 위한 'AI 최고 전략 회의'의 마스터 AI입니다.
현재 우리 업체의 블로그(주력 카테고리: {category}) 최신 포스팅이 '{issue}' 문제로 인해 스탯이 저조하다는 현장 보고가 들어왔습니다.
SEO 마케터, 카피라이터, 데이터 분석가 AI 3명이 내부적으로 치열하게 원인을 분석하고 토론한 결과라고 가정하십시오.

글을 작성하는 하위 AI 에디터가 다음 포스팅을 생성할 때 **절대적으로 따라야만 하는 가장 강력하고 혁신적인 업그레이드 지침 3가지**를 도출하여 알려주세요.
*주의사항: 장황한 서론 없이, 하위 AI 에디터의 시스템 프롬프트에 바로 붙여넣기 좋게 "명령조"의 텍스트로만 300~500자 이내로 작성하세요. (예: "1. 서론에 자극적인 숫자 훅을 배치하라. 2. ...")
"""

        GEMINI_KEY = os.getenv("VITE_GEMINI_API_KEY", "")
        if not GEMINI_KEY:
            return jsonify({"detail": "Gemini API 키가 없습니다."}), 500

        res = requests.post(
            f"https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key={{GEMINI_KEY}}",
            json={
                "contents": [{"role": "user", "parts": [{"text": system_prompt}]}],
                "generationConfig": {"temperature": 0.8, "maxOutputTokens": 800}
            }
        )
        if res.status_code == 200:
            data = res.json()
            guidelines = data["candidates"][0]["content"]["parts"][0]["text"]
            return jsonify({"success": True, "guidelines": guidelines.strip()})
        else:
            return jsonify({"detail": f"AI 전략 회의 에러: {res.text}"}), 500
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"detail": str(e)}), 500

@app.route("/queue", methods=["GET"])
def get_queue():
    with queue_lock:
        active_items = [q for q in blog_queue if q.get("status") != "deleted"]
        return jsonify({"queue": active_items})

@app.route("/queue/<item_id>", methods=["DELETE"])
def delete_queue(item_id):
    with queue_lock:
        for item in blog_queue:
            if item["id"] == item_id:
                if item["status"] == "processing":
                    return jsonify({"detail": "이미 기동되어 발행 중인 포스팅은 취소할 수 없습니다."}), 400
                item["status"] = "deleted"
                save_queue(blog_queue)
                return jsonify({"success": True})
        return jsonify({"detail": "해당 예약을 찾을 수 없습니다."}), 404

@app.route("/queue/<item_id>/status", methods=["PATCH"])
def update_queue_status(item_id):
    try:
        new_status = request.json.get("status")
        if not new_status:
            return jsonify({"detail": "변경할 status 값이 필요합니다."}), 400
            
        with queue_lock:
            for item in blog_queue:
                if item["id"] == item_id:
                    item["status"] = new_status
                    save_queue(blog_queue)
                    return jsonify({"success": True, "id": item_id, "status": new_status})
        return jsonify({"detail": "해당 예약을 찾을 수 없습니다."}), 404
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


# ──────────────────────────────────────────────────
# 실행
# ──────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print(f"  CleanBro 네이버 블로그 자동 발행 서버")
    
    # 백그라운드 스케줄러 쓰레드 시작
    t = threading.Thread(target=schedule_loop, daemon=True)
    t.start()
    
    print(f"  http://localhost:{BOT_PORT} 에서 실행 중")
    print(f"  네이버 아이디: {NAVER_ID[:3] + '***' if NAVER_ID else '❌ 미설정'}")
    print(f"  블로그 ID: {NAVER_BLOG_ID or '❌ 미설정'}")
    print("=" * 55)
    app.run(host="0.0.0.0", port=BOT_PORT)