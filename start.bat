@echo off
setlocal
cd /d "%~dp0"
title Wi-Fi Captive Portal and Marketing Gateway

echo ========================================================
echo   Wi-Fi Captive Portal and Marketing Gateway
echo ========================================================
echo.

:: Check for Administrator privileges
net session >nul 2>&1
if not errorlevel 1 goto :RUN_SERVER

echo [Info] Requesting Administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList '/k', 'cd /d ""%~dp0"" && start.bat' -Verb RunAs"
exit /b

:RUN_SERVER
cd /d "%~dp0"

:: Stop services holding Port 80
set STOPPED_IIS=0
sc query W3SVC 2>nul | find "RUNNING" >nul
if not errorlevel 1 (
    echo [Info] Pausing IIS W3SVC to free Port 80...
    net stop w3svc /y >nul 2>&1
    set STOPPED_IIS=1
)

set STOPPED_WMS=0
sc query Wms 2>nul | find "RUNNING" >nul
if not errorlevel 1 (
    echo [Info] Pausing MultiPoint Wms to free Port 80...
    net stop Wms /y >nul 2>&1
    net stop WmsRepair /y >nul 2>&1
    set STOPPED_WMS=1
)

echo [Info] Launching server.js...
echo.
node server.js

:: Cleanup when server is stopped
if "%STOPPED_IIS%"=="1" (
    echo [Info] Restoring IIS service W3SVC...
    net start w3svc >nul 2>&1
)

if "%STOPPED_WMS%"=="1" (
    echo [Info] Restoring MultiPoint service Wms...
    net start Wms >nul 2>&1
    net start WmsRepair >nul 2>&1
)

echo.
echo Server stopped.
pause
