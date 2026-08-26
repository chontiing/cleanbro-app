# 클린브로앱

에어컨·세탁기 청소 사업(클린브로) 사장님용 예약·운영 관리 웹앱. 브라우저에서 바로 쓰는 SPA로, 설치가 필요 없다.

## 구성

- `app/` — React 19 + Vite + Tailwind CSS로 만든 메인 웹앱 (예약 캘린더, SMS 자동발송, 매출/지출 관리, 재고 관리, AI 사진 분석 기반 블로그 자동화)
- `supabase/` — 백엔드 (PostgreSQL DB, Auth, Storage, Edge Functions)
- `naver_blog_bot.py` — 앱에서 큐에 등록한 청소 전후 사진을 네이버 블로그에 자동 포스팅하는 Python 봇 (Playwright로 네이버 블로그에 로그인해 발행)
- `blog_publisher/` — 블로그 발행 관련 보조 스크립트
- `stitch_screens/` — UI 디자인 목업

## 실행 방법

### 메인 앱

```bash
cd app
npm install
npm run dev       # 개발 서버
npm run build     # 프로덕션 빌드
```

`app/.env`에 다음 환경변수가 필요하다 (커밋 금지, `.gitignore`에 포함됨):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GEMINI_API_KEY=
```

### 네이버 블로그 자동 포스팅 봇

앱의 "분해자료" 탭에서 포스팅을 예약하면, 이 봇이 로컬에서 큐를 폴링해 실제 발행을 처리한다. **봇이 실행 중이어야 자동 포스팅이 동작한다.**

```bash
python naver_blog_bot.py
```

루트 `.env`에 다음 환경변수가 필요하다:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
NAVER_ID=
NAVER_PW=
NAVER_BLOG_ID=
```

## 사업 확장 시 참고

현재 서비스 카테고리(에어컨/세탁기)는 `app/src/App.jsx`의 `CATEGORIES`, `DEFAULT_PRICES` 상수와 업체 프로필의 `ac_guide_url`/`washer_guide_url` 필드에 하드코딩되어 있다. 새 사업 종류를 추가하려면 이 부분들을 함께 수정해야 한다.

## 알려진 이슈

- `app/src/App.jsx`가 6천 줄이 넘는 단일 컴포넌트로, 기능별 분리가 필요함 (별도 계획 진행 예정)
- `naver_blog_bot.py`가 로컬 PC에서만 상시 실행되어야 함 — 클라우드 배포 시 안정성 개선 여지 있음
