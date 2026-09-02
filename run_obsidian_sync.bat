@echo off
chcp 65001 > nul
echo ==================================================
echo [클린브로] 옵시디언(Obsidian) 통합 데이터 동기화
echo ==================================================
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" (
    .venv\Scripts\python.exe obsidian_sync.py
) else (
    python obsidian_sync.py
)

echo.
echo 작업이 완료되었습니다. 창을 닫으려면 아무 키나 누르세요.
pause > nul
