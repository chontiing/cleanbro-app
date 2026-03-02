"""
CleanBro Naver Blog Auto Publisher
===================================
이 스크립트는 CleanBro 앱에서 AI가 생성한 블로그 초안을 받아
Playwright로 네이버 블로그에 자동 포스팅합니다.

사용법:
  python publish_blog.py --title "제목" --body "본문" --images "img1.jpg,img2.jpg" --tags "태그1,태그2"
또는 JSON 입력:
  python publish_blog.py --json '{"title":"...","body":"...","tags":[...],"imageUrls":[...]}'

필수 환경변수:
  NAVER_ID     : 네이버 아이디
  NAVER_PW     : 네이버 비밀번호
  NAVER_BLOG_ID: 블로그 ID (보통 네이버 아이디와 동일)

설치:
  pip install playwright python-dotenv
  playwright install chromium
"""

import argparse
import asyncio
import json
import os
import tempfile
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

try:
    from playwright.async_api import async_playwright, TimeoutError as PwTimeout
except ImportError:
    print("ERROR: playwright가 설치되지 않았습니다. 다음을 실행하세요:")
    print("  pip install playwright")
    print("  playwright install chromium")
    sys.exit(1)


# ──────────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────────
NAVER_ID = os.environ.get("NAVER_ID", "")
NAVER_PW = os.environ.get("NAVER_PW", "")
NAVER_BLOG_ID = os.environ.get("NAVER_BLOG_ID", NAVER_ID)

LOGIN_URL = "https://nid.naver.com/nidlogin.login"
WRITE_URL = f"https://blog.naver.com/{NAVER_BLOG_ID}/postwrite"


# ──────────────────────────────────────────────────
# 헬퍼: 이미지 URL → 로컬 임시 파일
# ──────────────────────────────────────────────────
async def download_image(session, url: str) -> str | None:
    """이미지 URL을 내려받아 임시 파일 경로를 반환합니다."""
    import urllib.request
    try:
        suffix = ".jpg"
        if ".png" in url.lower():
            suffix = ".png"
        elif ".webp" in url.lower():
            suffix = ".webp"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        urllib.request.urlretrieve(url, tmp.name)
        return tmp.name
    except Exception as e:
        print(f"[WARN] 이미지 다운로드 실패 ({url}): {e}")
        return None


# ──────────────────────────────────────────────────
# 메인 퍼블리셔
# ──────────────────────────────────────────────────
async def publish(title: str, body: str, tags: list[str], image_urls: list[str]) -> dict:
    if not NAVER_ID or not NAVER_PW:
        return {"success": False, "error": "NAVER_ID / NAVER_PW 환경변수를 설정해주세요."}

    # 이미지 미리 내려받기
    local_images = []
    for url in image_urls[:10]:
        path = await download_image(None, url)
        if path:
            local_images.append(path)

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,   # True로 바꾸면 창 없이 실행
            slow_mo=200,
        )
        ctx = await browser.new_context()
        page = await ctx.new_page()

        try:
            # ── 1. 네이버 로그인 ───────────────────────────────
            print("[1/4] 네이버 로그인 중...")
            await page.goto(LOGIN_URL, wait_until="domcontentloaded")
            await page.fill("#id", NAVER_ID)
            await page.fill("#pw", NAVER_PW)
            await page.click(".btn_login")
            await page.wait_for_url("**/naver.com/**", timeout=15_000)
            print("     로그인 완료!")

            # ── 2. 블로그 글쓰기 페이지 이동 ──────────────────
            print("[2/4] 블로그 글쓰기 페이지로 이동 중...")
            await page.goto(WRITE_URL, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(3000)

            # 글쓰기 iframe 진입
            frame = None
            for fr in page.frames:
                if "postwrite" in fr.url or "blog.naver.com" in fr.url:
                    frame = fr
                    break
            target = frame or page

            # ── 3. 제목 입력 ───────────────────────────────────
            print("[3/4] 제목 및 본문 입력 중...")
            try:
                title_input = target.locator(".se-title-input, #postTitle, [data-placeholder='제목']").first
                await title_input.click()
                await title_input.fill(title)
            except Exception as e:
                print(f"     [WARN] 제목 입력 실패: {e}")

            await page.wait_for_timeout(1000)

            # ── 4. 이미지 업로드 ───────────────────────────────
            if local_images:
                try:
                    # 이미지 버튼 클릭
                    img_btn = target.locator("[data-log='image'], button[aria-label*='사진'], .se-image-btn").first
                    await img_btn.click()
                    await page.wait_for_timeout(1500)

                    # 파일 선택 다이얼로그 처리
                    async with page.expect_file_chooser() as fc_info:
                        upload_btn = target.locator("input[type='file']").first
                        await upload_btn.click()
                    file_chooser = await fc_info.value
                    await file_chooser.set_files(local_images[:5])
                    await page.wait_for_timeout(4000)
                    print(f"     이미지 {len(local_images)}장 업로드 완료!")
                except Exception as e:
                    print(f"     [WARN] 이미지 업로드 실패: {e}")

            # ── 5. 본문 입력 ───────────────────────────────────
            try:
                body_area = target.locator(".se-content, .se-text-paragraph, [role='textbox']").first
                await body_area.click()
                # 줄바꿈 처리하며 입력
                for line in body.split("\n"):
                    await body_area.type(line)
                    await page.keyboard.press("Enter")
                print("     본문 입력 완료!")
            except Exception as e:
                print(f"     [WARN] 본문 입력 실패: {e}")

            # ── 6. 태그 입력 ───────────────────────────────────
            if tags:
                try:
                    tag_input = target.locator(".tag_input, input[placeholder*='태그']").first
                    for tag in tags[:10]:
                        clean_tag = tag.replace("#", "").strip()
                        await tag_input.fill(clean_tag)
                        await page.keyboard.press("Enter")
                    print(f"     태그 {len(tags)}개 입력 완료!")
                except Exception as e:
                    print(f"     [WARN] 태그 입력 실패: {e}")

            # ── 7. 발행 ────────────────────────────────────────
            print("[4/4] 블로그 포스팅 발행 중...")
            try:
                publish_btn = target.locator("button:has-text('발행'), .publish_btn, [data-log='publish']").first
                await publish_btn.click()
                await page.wait_for_timeout(2000)

                # 발행 확인 팝업
                confirm_btn = page.locator("button:has-text('발행'), .confirm_btn").first
                if await confirm_btn.is_visible():
                    await confirm_btn.click()

                await page.wait_for_timeout(3000)
                post_url = page.url
                print(f"     ✅ 발행 완료! URL: {post_url}")
                return {"success": True, "url": post_url}
            except Exception as e:
                return {"success": False, "error": f"발행 버튼 클릭 실패: {e}"}

        except PwTimeout as e:
            return {"success": False, "error": f"시간 초과: {e}"}
        except Exception as e:
            return {"success": False, "error": str(e)}
        finally:
            # 임시 파일 정리
            for f in local_images:
                try:
                    os.unlink(f)
                except Exception:
                    pass
            await browser.close()


# ──────────────────────────────────────────────────
# CLI 진입점
# ──────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="CleanBro NaverBlog Publisher")
    parser.add_argument("--json", help="JSON 문자열로 전체 초안 전달", default=None)
    parser.add_argument("--title", default="")
    parser.add_argument("--body", default="")
    parser.add_argument("--tags", default="", help="쉼표 구분 태그")
    parser.add_argument("--images", default="", help="쉼표 구분 이미지 URL")
    args = parser.parse_args()

    if args.json:
        data = json.loads(args.json)
        title = data.get("title", "")
        body = data.get("body", "")
        tags = data.get("tags", [])
        images = data.get("imageUrls", data.get("images", []))
    else:
        title = args.title
        body = args.body
        tags = [t.strip() for t in args.tags.split(",") if t.strip()]
        images = [u.strip() for u in args.images.split(",") if u.strip()]

    result = asyncio.run(publish(title, body, tags, images))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
