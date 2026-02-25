@echo off
echo ===================================
echo   Hanna-Med RPA - Build Installer
echo ===================================
echo.

REM Check Python
python --version >NUL 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Install Python 3.10+.
    pause
    exit /b 1
)

REM Install/upgrade pyinstaller
echo [1/3] Installing PyInstaller...
pip install pyinstaller --upgrade --quiet

REM Clean previous builds
echo [2/3] Cleaning previous builds...
if exist "dist" rmdir /s /q dist
if exist "build" rmdir /s /q build

REM Build
echo [3/3] Building HannamedRPA.exe...
pyinstaller hannamed-rpa.spec --noconfirm

echo.
if exist "dist\HannamedRPA.exe" (
    echo ===================================
    echo   BUILD SUCCESSFUL
    echo   Output: dist\HannamedRPA.exe
    echo ===================================
    echo.
    echo To run:
    echo   dist\HannamedRPA.exe
) else (
    echo [ERROR] Build failed. Check errors above.
)

pause
