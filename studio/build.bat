@echo off
title Gemini CLI Studio — Windows Builder
echo.
echo  ================================================================
echo   Gemini CLI Studio — Build pour Windows 10/11 Pro x64
echo  ================================================================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERREUR] Node.js non trouve. Installez Node.js 20+ depuis https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js detecte :
node --version

:: Install dependencies
echo.
echo [1/3] Installation des dependances...
call npm install
if %errorlevel% neq 0 (
    echo [ERREUR] npm install a echoue.
    pause
    exit /b 1
)
echo [OK] Dependances installees.

:: Build React app
echo.
echo [2/3] Build de l'application React (Vite)...
call npm run build
if %errorlevel% neq 0 (
    echo [ERREUR] Le build Vite a echoue.
    pause
    exit /b 1
)
echo [OK] Application React compilee dans dist/

:: Package with electron-builder
echo.
echo [3/3] Packaging Electron pour Windows x64...
call npx electron-builder --win --x64
if %errorlevel% neq 0 (
    echo [ERREUR] electron-builder a echoue.
    pause
    exit /b 1
)

echo.
echo  ================================================================
echo   BUILD TERMINE !
echo   L'installeur se trouve dans : studio\release\
echo   Fichier : Gemini CLI Studio Setup x64.exe
echo  ================================================================
echo.
start "" "release"
pause
