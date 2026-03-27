@echo off
chcp 65001 > nul
echo ══════════════════════════════════════════
echo   CleanBro 네이버 블로그 자동 발행 서버
echo   http://localhost:8765
echo ══════════════════════════════════════════
echo.

:: greenlet 버전 고정 (3.3.x는 DLL 호환 오류)
"C:\Users\hoyeo\AppData\Local\Programs\Python\Python313\python.exe" -m pip install "greenlet==3.1.1" -q --force-reinstall 2>nul

:: 서버 실행
"C:\Users\hoyeo\AppData\Local\Programs\Python\Python313\python.exe" naver_blog_bot.py

pause
