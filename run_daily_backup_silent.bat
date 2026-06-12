@echo off
cd /d "%~dp0"

echo ========================================== >> backup_log.txt
echo [Backup Executed: %date% %time%] >> backup_log.txt
echo ========================================== >> backup_log.txt

.venv\Scripts\python.exe backup_db.py >> backup_log.txt 2>&1

echo. >> backup_log.txt
