"""
CleanBro Blog Auto-Publisher HTTP Server
=========================================
Flask 서버로 실행하면 앱에서 POST /publish 요청을 받아
Playwright로 네이버 블로그에 자동 포스팅합니다.

실행:
  python blog_server.py

.env 파일 필수 설정:
  NAVER_ID=네이버아이디
  NAVER_PW=네이버비밀번호
  NAVER_BLOG_ID=블로그아이디  (보통 아이디와 동일)
"""

import asyncio
import json
import os
import sys
import tempfile
import threading
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

try:
    from flask import Flask, request, jsonify
    from flask_cors import CORS
except ImportError:
    print("ERROR: flask / flask-cors가 없습니다.")
    print("  pip install flask flask-cors playwright python-dotenv")
    sys.exit(1)

try:
    from playwright.async_api import async_playwright, TimeoutError as PwTimeout
except ImportError:
    print("ERROR: playwright가 없습니다.")
    print("  pip install playwright")
    print("  playwright install chromium")
    sys.exit(1)

import urllib.request

app = Flask(__name__)
CORS(app)  # React 앱에서 cross-origin 요청 허용

NAVER_ID      = os.environ.get("NAVER_ID", "")
NAVER_PW      = os.environ.get("NAVER_PW", "")
NAVER_BLOG_ID = os.environ.get("NAVER_BLOG_ID", NAVER_ID)
LOGIN_URL     = "https://nid.naver.com/nidlogin.login"
WRITE_URL     = f"https://blog.naver.com/{NAVER_BLOG_ID}/postwrite"


def download_image(url: str) -> str | None:
    try:
        suffix = ".png" if ".png" in url.lower() else ".jpg"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        urllib.request.urlretrieve(url, tmp.name)
        return tmp.name
    except Exception as e:
        print(f"[WARN] 이미지 다운로드 실패: {e}")
        return None


async def _publish(title: str, body: str, tags: list, image_urls: list) -> dict:
    if not NAVER_ID or not NAVER_PW:
        return {"success": False, "error": ".env 파일에 NAVER_ID / NAVER_PW를 설정해주세요."}

    local_images = [p for url in image_urls[:10] if (p := download_image(url))]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, slow_mo=150)
        ctx = await browser.new_context()
        page = await ctx.new_page()

        try:
            # 1. 로그인
            print("[1/4] 네이버 로그인...")
            await page.goto(LOGIN_URL, wait_until="domcontentloaded")
            await page.fill("#id", NAVER_ID)
            await page.fill("#pw", NAVER_PW)
            await page.click(".btn_login")
            await page.wait_for_url("**/naver.com/**", timeout=15_000)
            print("     로그인 완료")

            # 2. 블로그 글쓰기
            print("[2/4] 글쓰기 페이지 이동...")
            await page.goto(WRITE_URL, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(3000)

            frame = None
            for fr in page.frames:
                if "postwrite" in fr.url or "blog.naver.com" in fr.url:
                    frame = fr
                    break
            target = frame or page

            # 3. 제목
            print("[3/4] 제목 및 본문 입력...")
            try:
                title_el = target.locator(".se-title-input, #postTitle, [data-placeholder='제목']").first
                await title_el.click()
                await title_el.fill(title)
            except Exception as e:
                print(f"     [WARN] 제목 입력 실패: {e}")

            await page.wait_for_timeout(800)

            # 4. 이미지
            if local_images:
                try:
                    img_btn = target.locator("[data-log='image'], button[aria-label*='사진'], .se-image-btn").first
                    await img_btn.click()
                    await page.wait_for_timeout(1500)
                    async with page.expect_file_chooser() as fc_info:
                        await target.locator("input[type='file']").first.click()
                    fc = await fc_info.value
                    await fc.set_files(local_images[:5])
                    await page.wait_for_timeout(4000)
                    print(f"     이미지 {len(local_images)}장 업로드")
                except Exception as e:
                    print(f"     [WARN] 이미지 업로드 실패: {e}")

            # 5. 본문
            try:
                body_area = target.locator(".se-content, .se-text-paragraph, [role='textbox']").first
                await body_area.click()
                for line in body.split("\n"):
                    await body_area.type(line)
                    await page.keyboard.press("Enter")
                print("     본문 입력 완료")
            except Exception as e:
                print(f"     [WARN] 본문 입력 실패: {e}")

            # 6. 태그
            if tags:
                try:
                    tag_input = target.locator(".tag_input, input[placeholder*='태그']").first
                    for tag in tags[:10]:
                        await tag_input.fill(tag.replace("#", "").strip())
                        await page.keyboard.press("Enter")
                    print(f"     태그 {len(tags)}개 입력")
                except Exception as e:
                    print(f"     [WARN] 태그 입력 실패: {e}")

            # 7. 발행
            print("[4/4] 발행 중...")
            pub_btn = target.locator("button:has-text('발행'), .publish_btn").first
            await pub_btn.click()
            await page.wait_for_timeout(2000)
            confirm = page.locator("button:has-text('발행'), .confirm_btn").first
            if await confirm.is_visible():
                await confirm.click()
            await page.wait_for_timeout(3000)
            post_url = page.url
            print(f"     ✅ 발행 완료 → {post_url}")
            return {"success": True, "published_url": post_url}

        except PwTimeout as e:
            return {"success": False, "error": f"시간 초과: {e}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
        finally:
            for f in local_images:
                try: os.unlink(f)
                except: pass
            await browser.close()


def run_async(coro):
    """별도 스레드에서 asyncio 루프 실행"""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "message": "CleanBro Blog Server is running"})


@app.route("/publish", methods=["POST"])
def publish_blog():
    data = request.get_json(force=True)
    title      = data.get("title", "CleanBro 작업 완료 후기")
    body       = data.get("body", "")
    tags       = data.get("tags", [])
    image_urls = data.get("image_urls", data.get("imageUrls", []))

    try:
        result = run_async(_publish(title, body, tags, image_urls))
        if result.get("success"):
            return jsonify(result), 200
        else:
            return jsonify(result), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    print("=" * 50)
    print("  CleanBro 네이버 블로그 자동 발행 서버")
    print("  http://localhost:8765 에서 실행 중")
    print("=" * 50)
    if not NAVER_ID:
        print("\n⚠️  .env 파일에 NAVER_ID, NAVER_PW를 설정해주세요!\n")
    app.run(host="0.0.0.0", port=8765, debug=False, threaded=True)
