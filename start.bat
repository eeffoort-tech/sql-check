@echo off

echo ================================================
echo   SQL-Check Project Launcher
echo ================================================
echo.

set "PROJECT_DIR=%~dp0"

echo [1/2] Project directory: %PROJECT_DIR%
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found!
    echo Install Python from https://python.org
    echo.
    pause
    exit /b 1
)

echo [2/2] Found Python. Starting server on port 3000...
echo.
echo ===============================================================
echo   Address: http://localhost:3000
echo   Pages:
echo     - Guide:      http://localhost:3000/guide.html
echo     - Admin:      http://localhost:3000/admin.html
echo     - Login:      http://localhost:3000/login.html
echo     - Index:      http://localhost:3000/index.html
echo ===============================================================
echo.
echo Press Ctrl+C to stop.
echo.

start http://localhost:3000/login.html

cd /d "%PROJECT_DIR%"
python -m http.server 3000
