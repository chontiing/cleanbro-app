@echo off
chcp 65001 > nul
echo ╔══════════════════════════════════════════╗
echo ║   CleanBro 블로그 봇 자동 설치 스크립트   ║
echo ╚══════════════════════════════════════════╝
echo.

:: ① Python 설치 확인
python --version 2>nul
if %errorlevel% neq 0 (
    echo [X] Python이 설치되어 있지 않습니다.
    echo     https://www.python.org/downloads/ 에서 설치 후 다시 실행하세요.
    echo     [설치 시 꼭 체크] Add python.exe to PATH
    pause
    exit /b 1
)

echo [OK] Python 설치 확인
echo.

:: ② pip 패키지 설치
echo [설치 중] flask flask-cors playwright python-dotenv...
pip install flask flask-cors playwright python-dotenv
if %errorlevel% neq 0 (
    echo [X] 패키지 설치 실패
    pause
    exit /b 1
)

:: ③ Playwright Chromium 설치
echo.
echo [설치 중] Playwright Chromium 브라우저...
playwright install chromium
if %errorlevel% neq 0 (
    echo [X] Playwright 브라우저 설치 실패
    pause
    exit /b 1
)

echo.
echo ══════════════════════════════════════════
echo  [완료] 설치가 완료되었습니다!
echo  다음 명령어로 서버를 실행하세요:
echo    python blog_publisher\blog_server.py
echo ══════════════════════════════════════════
pause
