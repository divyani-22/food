@echo off
title Smart Food AI Platform (IngreScan + FreshGuard)
echo ==============================================================
echo   Launching Unified Smart Food AI Platform
echo   - FreshGuard (PyTorch Produce Freshness AI on :5000)
echo   - IngreScan-AI (Packaged Food & Full-Stack Web App on :3000)
echo ==============================================================
echo.

cd /d "%~dp0"

echo [*] Starting FreshGuard Flask AI backend...
start "FreshGuard AI (:5000)" cmd /k "python app.py"

echo [*] Waiting for AI model to load (up to 90 seconds)...
set /a tries=0
:waitloop
curl -s -o nul http://127.0.0.1:5000/api/samples && goto ready
set /a tries+=1
if %tries% geq 45 (
  echo [!] FreshGuard did not respond in time; continuing anyway.
  goto ready
)
timeout /t 2 /nobreak >nul
goto waitloop
:ready

echo [*] Starting IngreScan Unified Web Application...
cd IngreScan-AI
set NODE_ENV=development
start "IngreScan Unified App (:3000)" cmd /k "npx tsx watch server/_core/index.ts"

echo [*] Opening application in browser...
timeout /t 2 /nobreak >nul
start http://localhost:3000/

echo.
echo ==============================================================
echo   All systems running!
echo   Single Website URL: http://localhost:3000/
echo ==============================================================
pause
