"""
naver_blog_bot.py
─────────────────────────────────────────────────────────────────────────────
네이버 블로그 자동 포스팅 봇 (Playwright 기반)

[사용법]
1. pip install playwright fastapi uvicorn requests Pillow
2. playwright install chromium
3. python naver_blog_bot.py
4. 봇이 http://localhost:8765 로 HTTP 서버 대기.
   클린브로 앱이 승인 시 POST /publish 로 데이터 전달.

[환경 변수 또는 .env 파일]
NAVER_ID=네이버아이디
NAVER_PW=네이버비밀번호
"""

import os
import json
import base64
import asyncio
import tempfile
from pathlib import Path
from typing import Optional
from datetime import datetime

import requests
from PIL import Image
from io import BytesIO
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
from playwright.async_api import async_playwright

# ────────────────────────────────────────────────
# 환경 변수 로드
# ────────────────────────────────────────────────
NAVER_ID = os.getenv("NAVER_ID", "")
NAVER_PW = os.getenv("NAVER_PW", "")
BOT_PORT = int(os.getenv("BOT_PORT", "8765"))

# ────────────────────────────────────────────────
# FastAPI 앱
# ────────────────────────────────────────────────
app = FastAPI(title="CleanBro Naver Blog Bot")


class PublishRequest(BaseModel):
    title: str
    body: str
    tags: list[str]
    photo_alt_texts: list[str]
    image_urls: list[str]          # public URLs from Supabase Storage
    category: Optional[str] = "에어컨"
    product: Optional[str] = "벽걸이"
    address: Optional[str] = ""


def download_image(url: str, idx: int, tmpdir: str) -> str:
    """이미지 URL을 다운로드해 임시 파일로 저장 후 경로 반환."""
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    img = Image.open(BytesIO(res.content)).convert("RGB")
    # 네이버 업로드 혹은 파일 시스템 충돌 방지 위해 jpg로 통일
    out_path = os.path.join(tmpdir, f"photo_{idx:02d}.jpg")
    img.save(out_path, "JPEG", quality=90)
    return out_path


async def post_to_naver(data: PublishRequest) -> str:
    """Playwright로 네이버 블로그에 포스팅하고 발행된 URL을 반환."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
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
            # ── 1. 네이버 로그인 ──────────────────────────────────────────
            print("[Bot] 네이버 로그인 중...")
            await page.goto("https://nid.naver.com/nidlogin.login", timeout=30000)
            await page.wait_for_timeout(1500)

            # JavaScript injection으로 로그인 (봇 감지 우회)
            await page.evaluate(
                f"""
                document.querySelector('#id').value = '{NAVER_ID}';
                document.querySelector('#pw').value = '{NAVER_PW}';
                """
            )
            await page.wait_for_timeout(800)
            await page.click("#log\\.login")
            await page.wait_for_timeout(3000)

            # 로그인 성공 여부 확인
            if "nid.naver.com" in page.url and "login" in page.url:
                raise Exception("네이버 로그인 실패. 아이디/비밀번호를 확인하세요.")
            print("[Bot] 로그인 완료:", page.url)

            # ── 2. 블로그 글쓰기 에디터 접속 ─────────────────────────────
            await page.goto(
                f"https://blog.naver.com/{NAVER_ID}/postwrite",
                timeout=30000
            )
            await page.wait_for_timeout(4000)

            # 스마트에디터 ONE iframe으로 전환
            editor_frame = None
            for frame in page.frames:
                if "smart-editor" in (frame.url or "") or "SE3" in (frame.name or ""):
                    editor_frame = frame
                    break
            if editor_frame is None:
                # 일반적인 iframe 탐색
                frames = page.frames
                for f in frames:
                    if f != page.main_frame:
                        editor_frame = f
                        break

            target = editor_frame or page

            # ── 3. 제목 입력 ──────────────────────────────────────────────
            print("[Bot] 제목 입력 중...")
            await page.wait_for_timeout(2000)

            # 제목 필드 탐색 (selector 변동 대응)
            title_selectors = [
                ".se-title-input",
                "[placeholder*='제목']",
                ".pcol1",
                ".__se_title_input",
            ]
            for sel in title_selectors:
                try:
                    el = await page.wait_for_selector(sel, timeout=5000)
                    if el:
                        await el.click()
                        await el.type(data.title, delay=40)
                        break
                except Exception:
                    continue

            # ── 4. 이미지 다운로드 ────────────────────────────────────────
            print("[Bot] 이미지 다운로드 중...")
            with tempfile.TemporaryDirectory() as tmpdir:
                img_paths = []
                for i, url in enumerate(data.image_urls[:10]):
                    try:
                        path = download_image(url, i, tmpdir)
                        img_paths.append(path)
                    except Exception as e:
                        print(f"  [경고] 이미지 {i} 다운로드 실패: {e}")

                # ── 5. 이미지 업로드 ──────────────────────────────────────
                print(f"[Bot] {len(img_paths)}장 이미지 파일 탐색 및 업로드 중...")
                # 파일 업로드 input 트리거
                try:
                    # 이미지 버튼 클릭
                    for btn_sel in [
                        "button[title*='사진']",
                        "button[data-type='image']",
                        ".tool_item_image",
                        ".se-toolbar-btn-image",
                    ]:
                        try:
                            btn = await page.wait_for_selector(btn_sel, timeout=3000)
                            if btn:
                                await btn.click()
                                await page.wait_for_timeout(1500)
                                break
                        except Exception:
                            continue

                    # 파일 input 찾기 후 파일 세팅
                    file_input = await page.wait_for_selector(
                        "input[type='file']", timeout=5000
                    )
                    if file_input and img_paths:
                        await file_input.set_input_files(img_paths)
                        await page.wait_for_timeout(5000)  # 업로드 대기
                    print("[Bot] 이미지 업로드 완료")
                except Exception as e:
                    print(f"[경고] 이미지 업로드 오류: {e}")

                # ── 6. 본문 입력 ──────────────────────────────────────────
                print("[Bot] 본문 입력 중...")
                await page.wait_for_timeout(2000)

                # 본문 영역 클릭
                body_selectors = [
                    ".se-main-container",
                    ".se-component-content",
                    "[contenteditable='true']",
                    ".se-text-paragraph",
                ]
                body_el = None
                for sel in body_selectors:
                    try:
                        body_el = await page.wait_for_selector(sel, timeout=5000)
                        if body_el:
                            await body_el.click()
                            break
                    except Exception:
                        continue

                if body_el:
                    # 본문을 단락 단위로 입력 (너무 빠르게 붙여넣기 시 에디터가 씹힘)
                    paragraphs = data.body.split("\n")
                    for para in paragraphs:
                        await page.keyboard.type(para, delay=5)
                        await page.keyboard.press("Enter")
                    await page.wait_for_timeout(1500)

                # ── 7. 태그 입력 ──────────────────────────────────────────
                print("[Bot] 태그 입력 중...")
                tag_selectors = [
                    ".se-tag-input input",
                    "input[placeholder*='태그']",
                    ".tag_input",
                ]
                for sel in tag_selectors:
                    try:
                        tag_input = await page.wait_for_selector(sel, timeout=4000)
                        if tag_input:
                            for tag in data.tags[:10]:
                                await tag_input.click()
                                await tag_input.type(tag.lstrip("#"), delay=30)
                                await page.keyboard.press("Enter")
                                await page.wait_for_timeout(300)
                            break
                    except Exception:
                        continue

                # ── 8. 발행 ───────────────────────────────────────────────
                print("[Bot] 발행 중...")
                publish_selectors = [
                    "button:has-text('발행')",
                    ".btn_publish",
                    ".publish_btn",
                    "[class*='publish']",
                ]
                for sel in publish_selectors:
                    try:
                        pub_btn = await page.wait_for_selector(sel, timeout=5000)
                        if pub_btn:
                            await pub_btn.click()
                            await page.wait_for_timeout(3000)
                            break
                    except Exception:
                        continue

                # 발행 확인 팝업 처리
                try:
                    confirm_btn = await page.wait_for_selector(
                        "button:has-text('확인'), button:has-text('발행하기')",
                        timeout=5000,
                    )
                    if confirm_btn:
                        await confirm_btn.click()
                        await page.wait_for_timeout(4000)
                except Exception:
                    pass

                # 발행 후 URL 수집
                published_url = page.url
                print(f"[Bot] 발행 완료: {published_url}")

        finally:
            await context.close()
            await browser.close()

        return published_url


# ────────────────────────────────────────────────
# API 엔드포인트
# ────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "naver_id": NAVER_ID[:3] + "***" if NAVER_ID else "NOT SET"}


@app.post("/publish")
async def publish(req: PublishRequest):
    if not NAVER_ID or not NAVER_PW:
        raise HTTPException(
            status_code=500,
            detail="NAVER_ID / NAVER_PW 환경변수가 설정되지 않았습니다."
        )
    try:
        url = await post_to_naver(req)
        return {"success": True, "published_url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────
# 실행
# ────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"🤖 CleanBro 네이버 블로그 봇 시작 (포트: {BOT_PORT})")
    print(f"   네이버 아이디: {NAVER_ID[:3] + '***' if NAVER_ID else '❌ 미설정'}")
    print(f"   접속: http://localhost:{BOT_PORT}/health")
    uvicorn.run(app, host="0.0.0.0", port=BOT_PORT)
