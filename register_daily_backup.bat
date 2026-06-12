@echo off
color 0A
title Cleanbro Daily Backup Register

:: Check admin privilege
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ====================================================
    echo [ERROR] This script must be run as Administrator.
    echo Right-click and select 'Run as Administrator'.
    echo ====================================================
    pause
    exit /b
)

cd /d "%~dp0"
set SCRIPT_PATH=%~dp0run_daily_backup_silent.bat

echo ====================================================
echo Registering Cleanbro Daily Backup Task
echo It will back up reservation data daily at 23:30.
echo ====================================================
echo.

schtasks /create /tn "CleanbroDailyBackup" /tr "\"%SCRIPT_PATH%\"" /sc daily /st 23:30 /f

if %errorLevel% eq 0 (
    echo.
    echo [SUCCESS] Daily backup task registered successfully!
    echo CleanbroDailyBackup will run every day at 23:30.
) else (
    echo.
    echo [FAILED] Failed to register the task scheduler.
)
echo.
pause
