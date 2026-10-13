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

echo [*] Waiting 3 seconds for AI model to load...
timeout /t 3 /nobreak >nul

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
