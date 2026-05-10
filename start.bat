@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

title RPOW Miner - Quick Start

:: ─────────────────────────────────────────────────────────
::  Paths
:: ─────────────────────────────────────────────────────────
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

set "CONFIG_FILE=.start-config.json"
set "STATE_FILE=.rpow-a.json"
set "ENV_FILE=.env"

:: ─────────────────────────────────────────────────────────
::  Banner
:: ─────────────────────────────────────────────────────────
echo.
echo  ===================================================================
echo   RPOW Miner  ^|  Quick Start
echo   Based on : github.com/stablemarkk/rpow_cli_miner
echo   Captcha  : https://yescaptcha.com/i/JLPgt4  (referral)
echo  ===================================================================
echo.

:: ─────────────────────────────────────────────────────────
::  1. Node.js check
:: ─────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found.
    echo          Download Node.js 18+ from https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%

:: ─────────────────────────────────────────────────────────
::  2. Load / create .env  →  YESCAPTCHA_KEY
:: ─────────────────────────────────────────────────────────
set "CAPTCHA_KEY="

if exist "%ENV_FILE%" (
    for /f "usebackq eol=| tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
        if "%%a"=="YESCAPTCHA_KEY" set "CAPTCHA_KEY=%%b"
    )
)

if "!CAPTCHA_KEY!"=="" (
    echo.
    echo  ─── YesCaptcha Setup ───────────────────────────────────────────
    echo.
    echo  YesCaptcha automatically solves Cloudflare Turnstile during login.
    echo.
    echo  Sign up (free credits available):
    echo    https://yescaptcha.com/i/JLPgt4
    echo.
    set /p "CAPTCHA_KEY=  Paste your YesCaptcha API key: "
    if "!CAPTCHA_KEY!"=="" (
        echo.
        echo  [ERROR] No API key entered. Cannot continue.
        pause
        exit /b 1
    )
    echo YESCAPTCHA_KEY=!CAPTCHA_KEY!>> "%ENV_FILE%"
    echo.
    echo  [OK] Key saved to .env
)
echo  [OK] YesCaptcha key loaded

:: ─────────────────────────────────────────────────────────
::  3. Load saved config  (resume detection)
:: ─────────────────────────────────────────────────────────
set "SAVED_EMAIL="
set "SAVED_ENGINE="
set "SAVED_WORKERS="
set "SAVED_GPU_BATCH="
set "SAVED_GPU_LOCAL="
set "USE_RESUME=N"

if exist "%CONFIG_FILE%" (
    rem Parse config JSON via Node  (:: cannot be used as comment inside blocks)
    node -e "try{var c=JSON.parse(require('fs').readFileSync('%CONFIG_FILE%','utf8'));['EMAIL='+c.email,'ENGINE='+c.engine,'WORKERS='+c.workers,'GPU_BATCH='+(c.gpu_batch||''),'GPU_LOCAL='+(c.gpu_local||'')].forEach(function(l){console.log(l)})}catch(e){}" > _tmp_cfg.txt 2>nul
    for /f "usebackq eol=| tokens=1,* delims==" %%a in ("_tmp_cfg.txt") do (
        if "%%a"=="EMAIL"     set "SAVED_EMAIL=%%b"
        if "%%a"=="ENGINE"    set "SAVED_ENGINE=%%b"
        if "%%a"=="WORKERS"   set "SAVED_WORKERS=%%b"
        if "%%a"=="GPU_BATCH" set "SAVED_GPU_BATCH=%%b"
        if "%%a"=="GPU_LOCAL" set "SAVED_GPU_LOCAL=%%b"
    )
    del _tmp_cfg.txt >nul 2>&1

    if not "!SAVED_EMAIL!"=="" (
        echo.
        echo  ─── Previous Session Found ──────────────────────────────────────
        echo.
        echo    Email   : !SAVED_EMAIL!
        echo    Engine  : !SAVED_ENGINE!
        echo    Workers : !SAVED_WORKERS!
        if not "!SAVED_GPU_BATCH!"=="" (
            echo    GPU Batch: !SAVED_GPU_BATCH!
            echo    GPU Local: !SAVED_GPU_LOCAL!
        )
        echo.
        set /p "RESUME_ANSWER=  Resume with this config? [Y/n]: "
        if "!RESUME_ANSWER!"=="" set "RESUME_ANSWER=Y"
        if /i "!RESUME_ANSWER!"=="y" set "USE_RESUME=Y"
        if /i "!RESUME_ANSWER!"=="Y" set "USE_RESUME=Y"
    )
)

:: ─────────────────────────────────────────────────────────
::  4. Email
:: ─────────────────────────────────────────────────────────
set "EMAIL="

if /i "!USE_RESUME!"=="Y" (
    set "EMAIL=!SAVED_EMAIL!"
) else (
    echo.
    set /p "EMAIL=  Enter your RPOW account email: "
    if "!EMAIL!"=="" (
        echo.
        echo  [ERROR] Email is required.
        pause
        exit /b 1
    )
)

:: ─────────────────────────────────────────────────────────
::  5. Session validity check  →  auto-relogin if needed
:: ─────────────────────────────────────────────────────────
echo.
echo  [INFO] Checking session for !EMAIL! ...

node rpow-cli.js me --state "%STATE_FILE%" >nul 2>&1
set "SESSION_OK=!errorlevel!"

if "!SESSION_OK!"=="0" (
    echo  [OK] Session is valid. Skipping login.
) else (
    echo  [INFO] Session missing or expired. Starting login ...
    echo.

    :: Request magic link (YesCaptcha will auto-solve Turnstile)
    node rpow-cli.js login --email "!EMAIL!" --state "%STATE_FILE%" --captcha-key "!CAPTCHA_KEY!"
    if errorlevel 1 (
        echo.
        echo  [ERROR] Login request failed. Check your API key and network connection.
        pause
        exit /b 1
    )

    echo.
    echo  ─── Magic Link ─────────────────────────────────────────────────
    echo.
    echo  Check your email for a message from RPOW.
    echo  Copy the full link (starts with https://...) and paste below.
    echo.
    set /p "MAGIC_LINK=  Magic link: "
    if "!MAGIC_LINK!"=="" (
        echo.
        echo  [ERROR] No magic link entered.
        pause
        exit /b 1
    )

    node rpow-cli.js complete-login --link "!MAGIC_LINK!" --state "%STATE_FILE%"
    if errorlevel 1 (
        echo.
        echo  [ERROR] Login failed. The link may have expired — try again.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Logged in as !EMAIL!
)

:: ─────────────────────────────────────────────────────────
::  6. Engine selection
:: ─────────────────────────────────────────────────────────
set "ENGINE="
set "GPU_BATCH="
set "GPU_LOCAL="
set "WORKERS="

if /i "!USE_RESUME!"=="Y" (
    set "ENGINE=!SAVED_ENGINE!"
    set "WORKERS=!SAVED_WORKERS!"
    set "GPU_BATCH=!SAVED_GPU_BATCH!"
    set "GPU_LOCAL=!SAVED_GPU_LOCAL!"
    goto :start_mining
)

:: Detect GPU binary
set "GPU_READY=N"
if exist "rpow-gpu-miner.exe" set "GPU_READY=Y"

echo.
echo  ─── Mining Engine ───────────────────────────────────────────────
echo.
echo    [1] GPU  - OpenCL, NVIDIA / AMD  (fastest, up to 700x vs browser)
if "!GPU_READY!"=="N" (
    echo         ! rpow-gpu-miner.exe not found
    echo           Run  .\build-gpu.ps1  first, or choose CPU
)
echo    [2] CPU  - native C workers      (fast, cross-platform)
echo    [3] Node - JavaScript fallback   (slowest)
echo.
set /p "ENGINE_CHOICE=  Choice [1/2/3, default=1]: "
if "!ENGINE_CHOICE!"=="" set "ENGINE_CHOICE=1"

if "!ENGINE_CHOICE!"=="1" set "ENGINE=gpu"
if "!ENGINE_CHOICE!"=="2" set "ENGINE=native"
if "!ENGINE_CHOICE!"=="3" set "ENGINE=node"

if "!ENGINE!"=="" (
    echo.
    echo  [ERROR] Invalid choice.
    pause
    exit /b 1
)

:: Auto-build GPU binary if missing
if "!ENGINE!"=="gpu" if "!GPU_READY!"=="N" (
    echo.
    echo  [INFO] Building GPU miner (requires Visual C++ / MSVC) ...
    powershell -ExecutionPolicy Bypass -File ".\build-gpu.ps1"
    if exist "rpow-gpu-miner.exe" (
        echo  [OK] GPU miner built.
        set "GPU_READY=Y"
    ) else (
        echo.
        echo  [WARN] GPU build failed. Falling back to native CPU.
        set "ENGINE=native"
    )
)

:: ─────────────────────────────────────────────────────────
::  7. Resource level  →  workers + GPU settings
:: ─────────────────────────────────────────────────────────
set /a CPU_COUNT=%NUMBER_OF_PROCESSORS%
if !CPU_COUNT! lss 1 set /a CPU_COUNT=1

echo.
echo  ─── Resource Usage ──────────────────────────────────────────────
echo.

if "!ENGINE!"=="gpu" (
    echo    [1] Full   — 16 workers  batch=2097152  local=256
    echo    [2] 80%%   — 12 workers  batch=1048576  local=128
    echo    [3] 50%%   —  8 workers  batch=524288   local=64
    echo    [4] 25%%   —  4 workers  batch=262144   local=32
    echo    [5] Custom
    echo.
    set /p "RES_CHOICE=  Choice [1-5, default=1]: "
    if "!RES_CHOICE!"=="" set "RES_CHOICE=1"

    if "!RES_CHOICE!"=="1" ( set "WORKERS=16" & set "GPU_BATCH=2097152" & set "GPU_LOCAL=256" )
    if "!RES_CHOICE!"=="2" ( set "WORKERS=12" & set "GPU_BATCH=1048576" & set "GPU_LOCAL=128" )
    if "!RES_CHOICE!"=="3" ( set "WORKERS=8"  & set "GPU_BATCH=524288"  & set "GPU_LOCAL=64"  )
    if "!RES_CHOICE!"=="4" ( set "WORKERS=4"  & set "GPU_BATCH=262144"  & set "GPU_LOCAL=32"  )
    if "!RES_CHOICE!"=="5" (
        echo.
        set /p "WORKERS=  GPU workers     [default=16]: "
        if "!WORKERS!"=="" set "WORKERS=16"
        set /p "GPU_BATCH=  GPU batch size  [default=2097152]: "
        if "!GPU_BATCH!"=="" set "GPU_BATCH=2097152"
        set /p "GPU_LOCAL=  GPU local size  [default=256]: "
        if "!GPU_LOCAL!"=="" set "GPU_LOCAL=256"
    )
) else (
    set /a W100=!CPU_COUNT!
    set /a W80=!CPU_COUNT! * 80 / 100
    if !W80! lss 1 set /a W80=1
    set /a W50=!CPU_COUNT! * 50 / 100
    if !W50! lss 1 set /a W50=1
    set /a W25=!CPU_COUNT! * 25 / 100
    if !W25! lss 1 set /a W25=1

    echo    Detected %CPU_COUNT% logical thread(s)
    echo.
    echo    [1] Full   — !W100! workers  (100%%)
    echo    [2] 80%%   — !W80! workers
    echo    [3] 50%%   — !W50! workers
    echo    [4] 25%%   — !W25! workers
    echo    [5] Custom
    echo.
    set /p "RES_CHOICE=  Choice [1-5, default=2]: "
    if "!RES_CHOICE!"=="" set "RES_CHOICE=2"

    if "!RES_CHOICE!"=="1" set "WORKERS=!W100!"
    if "!RES_CHOICE!"=="2" set "WORKERS=!W80!"
    if "!RES_CHOICE!"=="3" set "WORKERS=!W50!"
    if "!RES_CHOICE!"=="4" set "WORKERS=!W25!"
    if "!RES_CHOICE!"=="5" (
        echo.
        set /p "WORKERS=  Number of workers [default=!W80!]: "
        if "!WORKERS!"=="" set "WORKERS=!W80!"
    )
)

if "!WORKERS!"=="" set "WORKERS=1"

:: ─────────────────────────────────────────────────────────
::  8. Save config
:: ─────────────────────────────────────────────────────────
set "GPU_BATCH_VAL=null"
set "GPU_LOCAL_VAL=null"
if not "!GPU_BATCH!"=="" set "GPU_BATCH_VAL=!GPU_BATCH!"
if not "!GPU_LOCAL!"=="" set "GPU_LOCAL_VAL=!GPU_LOCAL!"

node -e "const fs=require('fs');fs.writeFileSync('.start-config.json',JSON.stringify({email:'!EMAIL!',engine:'!ENGINE!',workers:Number('!WORKERS!'),gpu_batch:!GPU_BATCH_VAL!,gpu_local:!GPU_LOCAL_VAL!},null,2));" 2>nul
echo.
echo  [OK] Config saved to %CONFIG_FILE%  (will be offered as resume next time)

:: ─────────────────────────────────────────────────────────
::  9. Launch mining
:: ─────────────────────────────────────────────────────────
:start_mining
echo.
echo  ===================================================================
echo   Starting RPOW Mining
echo   Email   : !EMAIL!
echo   Engine  : !ENGINE!
echo   Workers : !WORKERS!
if not "!GPU_BATCH!"=="" (
    echo   GPU Batch: !GPU_BATCH!
    echo   GPU Local: !GPU_LOCAL!
)
echo  ===================================================================
echo.

set "MINE_CMD=node rpow-cli.js mine --count 1000 --engine !ENGINE! --workers !WORKERS! --state %STATE_FILE%"
if not "!GPU_BATCH!"=="" set "MINE_CMD=!MINE_CMD! --gpu-batch !GPU_BATCH! --gpu-local-size !GPU_LOCAL!"

echo  Command: !MINE_CMD!
echo.

:mining_loop
!MINE_CMD!
set "MINE_EXIT=!errorlevel!"

if "!MINE_EXIT!"=="0" (
    echo.
    echo  [INFO] Mining round complete. Restarting ...
    echo.
    goto :mining_loop
)

echo.
echo  [INFO] Mining stopped (exit code !MINE_EXIT!).
echo.
pause
exit /b !MINE_EXIT!
