@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

title RPOW Miner - Tools & Features

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

set "STATE_FILE=.rpow-a.json"
set "ENV_FILE=.env"

:: Load state file from saved config if present
if exist ".start-config.json" (
    for /f "delims=" %%L in ('node -e "try{const c=require('./.start-config.json');console.log(c.email||'')}catch(e){}" 2^>nul') do (
        set "SAVED_EMAIL=%%L"
    )
)

goto :main_menu

:: -----------------------------------------------------------------------
:main_menu
cls
echo.
echo  +-------------------------------------------------------------------+
echo  |          RPOW Miner  ^|  Tools ^& Features                        |
echo  |          github.com/stablemarkk/rpow_cli_miner                   |
echo  +-------------------------------------------------------------------+
echo.
echo   State file : %STATE_FILE%
if defined SAVED_EMAIL (
    echo   Account    : !SAVED_EMAIL!
)
echo.
echo  --- Account --------------------------------------------------------
echo.
echo    [1]  My Account Info        View balance, minted, sent, received
echo    [2]  Activity History       List all your recent transactions
echo    [3]  Send RPOW              Transfer tokens to another user
echo.
echo  --- Network --------------------------------------------------------
echo.
echo    [4]  Ledger / Stats         Network supply, difficulty, halving info
echo    [5]  API Map                Show all available API endpoints
echo.
echo  --- Session --------------------------------------------------------
echo.
echo    [6]  Cookie Login           Log in by pasting your session cookie
echo    [7]  Logout                 Clear saved session from this device
echo    [8]  Check Session          Test whether current session is valid
echo.
echo  --- Settings -------------------------------------------------------
echo.
echo    [9]  Change State File      Switch which account state file to use
echo    [0]  Exit
echo.
set /p "CHOICE=  Select option: "

if "!CHOICE!"=="1" goto :fn_me
if "!CHOICE!"=="2" goto :fn_activity
if "!CHOICE!"=="3" goto :fn_send
if "!CHOICE!"=="4" goto :fn_ledger
if "!CHOICE!"=="5" goto :fn_map
if "!CHOICE!"=="6" goto :fn_cookie_login
if "!CHOICE!"=="7" goto :fn_logout
if "!CHOICE!"=="8" goto :fn_check_session
if "!CHOICE!"=="9" goto :fn_change_state
if "!CHOICE!"=="0" goto :exit_bat
echo.
echo  [!] Invalid choice — press any key to retry.
pause >nul
goto :main_menu


:: -----------------------------------------------------------------------
:fn_me
cls
echo.
echo  +-------------------------------------------------------------------+
echo  |  [1] My Account Info                                             |
echo  +-------------------------------------------------------------------+
echo.
echo  What this does:
echo    Connects to the RPOW server and shows your current account details.
echo.
echo  Output you will see:
echo    balance   — how many RPOW tokens you currently hold
echo    minted    — total tokens you have mined (all time)
echo    sent      — total tokens you have sent to others
echo    received  — total tokens received from others
echo    (modern server also shows wrap_allowed, solana_wallet, wrapped srPOW)
echo.
echo  Requirements:
echo    You must be logged in. Run [8] Check Session if unsure.
echo.
echo  --------------------------------------------------------------------
echo.
set /p "GO=  Press ENTER to fetch account info, or type B to go back: "
if /i "!GO!"=="b" goto :main_menu
echo.
echo  --- Result ---------------------------------------------------------
echo.
node rpow-cli.js me --state "%STATE_FILE%"
if errorlevel 1 (
    echo.
    echo  [!] Command failed. Make sure you are logged in.
    echo      Run option [8] to check your session status.
)
echo.
echo  --------------------------------------------------------------------
set /p "BACK=  Press ENTER to return to main menu..."
goto :main_menu


:: -----------------------------------------------------------------------
:fn_activity
cls
echo.
echo  +-------------------------------------------------------------------+
echo  |  [2] Activity History                                            |
echo  +-------------------------------------------------------------------+
echo.
echo  What this does:
echo    Fetches your full transaction history from the RPOW server.
echo.
echo  Output you will see (one line per event):
echo    at          — date/time of the event (UTC)
echo    type        — mint / send / receive / claim / pending-claim
echo    amount      — token amount  (+minted  -sent)
echo    counterparty— the other user's email (for send/receive)
echo.
echo  Requirements:
echo    You must be logged in.
echo.
echo  --------------------------------------------------------------------
echo.
set /p "GO=  Press ENTER to fetch activity, or type B to go back: "
if /i "!GO!"=="b" goto :main_menu
echo.
echo  --- Result ---------------------------------------------------------
echo.
node rpow-cli.js activity --state "%STATE_FILE%"
if errorlevel 1 (
    echo.
    echo  [!] Command failed. Make sure you are logged in.
)
echo.
echo  --------------------------------------------------------------------
set /p "BACK=  Press ENTER to return to main menu..."
goto :main_menu


:: -----------------------------------------------------------------------
:fn_send
cls
echo.
echo  +-------------------------------------------------------------------+
echo  |  [3] Send RPOW                                                   |
echo  +-------------------------------------------------------------------+
echo.
echo  What this does:
echo    Transfers RPOW tokens from your account to another user.
echo.
echo  What you will be asked:
echo    Recipient email  — the full email address of the recipient
echo                       e.g.  friend@example.com
echo    Amount           — how many RPOW to send; supports decimals
echo                       e.g.  1       sends exactly 1 RPOW
echo                             0.5     sends half a RPOW
echo                             1.25    sends one and a quarter RPOW
echo                       Up to 9 decimal places are supported.
echo.
echo  Important notes:
echo    - The recipient must already have an RPOW account.
echo    - If the recipient does not exist yet, the transfer will be
echo      held as a "pending claim" until they register.
echo    - You cannot send more than your current balance.
echo    - Each send generates a unique transfer ID for your records.
echo.
echo  Requirements:
echo    You must be logged in with sufficient balance.
echo.
echo  --------------------------------------------------------------------
echo.
set /p "GO=  Type B to go back, or press ENTER to continue: "
if /i "!GO!"=="b" goto :main_menu
echo.

set "RECIPIENT="
set "SEND_AMOUNT="

set /p "RECIPIENT=  Recipient email address: "
if "!RECIPIENT!"=="" (
    echo.
    echo  [!] Recipient email cannot be empty.
    set /p "X=  Press ENTER to return to main menu..."
    goto :main_menu
)

echo.
echo  Example amounts:  1   /   0.5   /   2.75   /   0.000000001
set /p "SEND_AMOUNT=  Amount to send (in RPOW): "
if "!SEND_AMOUNT!"=="" (
    echo.
    echo  [!] Amount cannot be empty.
    set /p "X=  Press ENTER to return to main menu..."
    goto :main_menu
)

echo.
echo  --- Confirm --------------------------------------------------------
echo.
echo    Send  !SEND_AMOUNT! RPOW  →  !RECIPIENT!
echo.
set /p "CONFIRM=  Type YES to confirm, or anything else to cancel: "
if /i not "!CONFIRM!"=="yes" (
    echo.
    echo  Cancelled.
    set /p "BACK=  Press ENTER to return to main menu..."
    goto :main_menu
)

echo.
echo  --- Result ---------------------------------------------------------
echo.
node rpow-cli.js send --to "!RECIPIENT!" --amount "!SEND_AMOUNT!" --state "%STATE_FILE%"
if errorlevel 1 (
    echo.
    echo  [!] Send failed. Possible reasons:
    echo      - Insufficient balance
    echo      - Invalid recipient email
    echo      - Session expired  (run option [8])
    echo      - Network issue
)
echo.
echo  --------------------------------------------------------------------
set /p "BACK=  Press ENTER to return to main menu..."
goto :main_menu


:: -----------------------------------------------------------------------
:fn_ledger
cls
echo.
echo  +-------------------------------------------------------------------+
echo  |  [4] Ledger / Network Stats                                      |
echo  +-------------------------------------------------------------------+
echo.
echo  What this does:
echo    Fetches public network-wide statistics from the RPOW server.
echo    No login required.
echo.
echo  Output you will see:
echo    total_minted       — all RPOW ever created by miners
echo    total_transferred  — all RPOW ever sent between users
echo    circulating_supply — tokens currently in circulation
echo    difficulty_bits    — current mining difficulty (higher = harder)
echo    user_count         — total registered accounts on the network
echo.
echo  If the server is running modern protocol you also get:
echo    current_reward     — tokens rewarded per successful mine now
echo    next_reward        — tokens per mine after the next halving
echo    next_halving_at    — supply level at which next halving occurs
echo    to_next_halving    — remaining supply before halving triggers
echo    halving_index      — how many halvings have happened so far
echo    is_capped          — whether max supply has been reached
echo    max_supply         — total maximum supply
echo.
echo  --------------------------------------------------------------------
echo.
set /p "GO=  Press ENTER to fetch ledger, or type B to go back: "
if /i "!GO!"=="b" goto :main_menu
echo.
echo  --- Result ---------------------------------------------------------
echo.
node rpow-cli.js ledger --state "%STATE_FILE%"
if errorlevel 1 (
    echo.
    echo  [!] Command failed. Check your network connection.
)
echo.
echo  --------------------------------------------------------------------
set /p "BACK=  Press ENTER to return to main menu..."
goto :main_menu


:: -----------------------------------------------------------------------
:fn_map
cls
echo.
echo  +-------------------------------------------------------------------+
echo  |  [5] API Map                                                     |
echo  +-------------------------------------------------------------------+
echo.
echo  What this does:
echo    Reads the bundled index.js from rpow2.com and prints a summary
echo    of every API endpoint the site uses, plus the mining algorithm.
echo    Useful for developers or to verify the API is working as expected.
echo    No login required.
echo.
echo  Output you will see:
echo    - API origin URL
echo    - Each endpoint: method + path  (e.g. POST /auth/request)
echo    - Mining protocol description
echo.
echo  --------------------------------------------------------------------
echo.
set /p "GO=  Press ENTER to show API map, or type B to go back: "
if /i "!GO!"=="b" goto :main_menu
echo.
echo  --- Result ---------------------------------------------------------
echo.
node rpow-cli.js map --state "%STATE_FILE%"
echo.
echo  --------------------------------------------------------------------
set /p "BACK=  Press ENTER to return to main menu..."
goto :main_menu


:: -----------------------------------------------------------------------
:fn_cookie_login
cls
echo.
echo  +-------------------------------------------------------------------+
echo  |  [6] Cookie Login                                                |
echo  +-------------------------------------------------------------------+
echo.
echo  What this does:
echo    Lets you log in by pasting your session cookie directly.
echo    Use this if you already have a valid session from a browser
echo    or another device, and want to use it here without receiving
echo    a new magic-link email.
echo.
echo  How to get your cookie from a browser:
echo    1. Open https://rpow2.com in Chrome / Firefox / Edge
echo    2. Log in normally via email
echo    3. Open DevTools  (press F12)
echo    4. Go to Application tab  →  Cookies  →  https://rpow2.com
echo    5. Find the cookie named  rpow_session
echo    6. Copy its Value
echo.
echo  What you can paste (any of these formats work):
echo    abc123xyz...                               (raw value)
echo    rpow_session=abc123xyz...                  (with name prefix)
echo    rpow_session=abc123xyz...; Path=/; HttpOnly (full Set-Cookie string)
echo    Cookie: rpow_session=abc123xyz...          (with header prefix)
echo.
echo  The tool will automatically clean up whatever format you paste.
echo.
echo  --------------------------------------------------------------------
echo.
set /p "GO=  Type B to go back, or press ENTER to continue: "
if /i "!GO!"=="b" goto :main_menu
echo.
echo  Paste your cookie below and press ENTER:
echo  (Tip: right-click in this window to paste)
echo.
set /p "COOKIE_VALUE=  Cookie: "
if "!COOKIE_VALUE!"=="" (
    echo.
    echo  [!] No cookie entered.
    set /p "X=  Press ENTER to return to main menu..."
    goto :main_menu
)

echo.
echo  --- Result ---------------------------------------------------------
echo.
node rpow-cli.js cookie-login --cookie "!COOKIE_VALUE!" --state "%STATE_FILE%"
if errorlevel 1 (
    echo.
    echo  [!] Cookie login failed. Possible reasons:
    echo      - Cookie has expired  (get a fresh one from your browser)
    echo      - You copied the wrong value  (make sure to copy the Value,
    echo        not the Name column in DevTools)
    echo      - Network error connecting to api.rpow2.com
)
echo.
echo  --------------------------------------------------------------------
set /p "BACK=  Press ENTER to return to main menu..."
goto :main_menu


:: -----------------------------------------------------------------------
:fn_logout
cls
echo.
echo  +-------------------------------------------------------------------+
echo  |  [7] Logout                                                      |
echo  +-------------------------------------------------------------------+
echo.
echo  What this does:
echo    1. Tells the RPOW server to invalidate your current session token.
echo    2. Removes the saved session cookie from your local state file.
echo.
echo  After logout:
echo    - Mining will stop working (session invalid)
echo    - You will need to run  start.bat  or use option [6] Cookie Login
echo      to log in again before you can mine or view your account.
echo.
echo  Note: This only logs out THIS device. Other devices with their own
echo  state files are not affected.
echo.
echo  --------------------------------------------------------------------
echo.
set /p "CONFIRM=  Type YES to log out, or anything else to cancel: "
if /i not "!CONFIRM!"=="yes" (
    echo.
    echo  Cancelled.
    set /p "BACK=  Press ENTER to return to main menu..."
    goto :main_menu
)
echo.
echo  --- Result ---------------------------------------------------------
echo.
node rpow-cli.js logout --state "%STATE_FILE%"
if errorlevel 1 (
    echo.
    echo  [!] Logout request failed (server may have already invalidated
    echo      the session). Local session cookie has still been cleared.
)
echo.
echo  --------------------------------------------------------------------
set /p "BACK=  Press ENTER to return to main menu..."
goto :main_menu


:: -----------------------------------------------------------------------
:fn_check_session
cls
echo.
echo  +-------------------------------------------------------------------+
echo  |  [8] Check Session                                               |
echo  +-------------------------------------------------------------------+
echo.
echo  What this does:
echo    Calls GET /me on the RPOW server to check whether the session
echo    cookie stored in your state file is still valid.
echo.
echo  Result meanings:
echo    VALID   — You are logged in. Mining and other commands will work.
echo    INVALID — Session has expired or was never set.
echo              → Run  start.bat  to log in again, or
echo              → Use option [6] Cookie Login to paste a cookie.
echo.
echo  --------------------------------------------------------------------
echo.
set /p "GO=  Press ENTER to check session, or type B to go back: "
if /i "!GO!"=="b" goto :main_menu
echo.

node rpow-cli.js me --state "%STATE_FILE%" >nul 2>&1
if "!errorlevel!"=="0" (
    echo  +----------------------------------------------------------------+
    echo  |  SESSION STATUS:  VALID  ✓                                     |
    echo  |  Your session is active and mining commands will work.         |
    echo  +----------------------------------------------------------------+
    echo.
    echo  Fetching account details...
    echo.
    node rpow-cli.js me --state "%STATE_FILE%"
) else (
    echo  +----------------------------------------------------------------+
    echo  |  SESSION STATUS:  INVALID  ✗                                   |
    echo  |  You are not logged in or your session has expired.            |
    echo  +----------------------------------------------------------------+
    echo.
    echo  To log in:
    echo    Option A — Close this window and run  start.bat
    echo               (handles captcha and magic link automatically)
    echo    Option B — Option [6] Cookie Login
    echo               (paste a cookie you already have from a browser)
)
echo.
echo  --------------------------------------------------------------------
set /p "BACK=  Press ENTER to return to main menu..."
goto :main_menu


:: -----------------------------------------------------------------------
:fn_change_state
cls
echo.
echo  +-------------------------------------------------------------------+
echo  |  [9] Change State File                                           |
echo  +-------------------------------------------------------------------+
echo.
echo  What this does:
echo    Lets you switch which account state file this tool uses.
echo    Each state file holds the session cookie for ONE account.
echo    Use different state files to manage multiple RPOW accounts.
echo.
echo  Current state file:  %STATE_FILE%
echo.
echo  Examples of valid file names:
echo    .rpow-a.json          (account A — default)
echo    .rpow-b.json          (account B)
echo    .rpow-work.json       (a work account)
echo    .rpow-2.json
echo.
echo  Note:
echo    The file name must end in .json.
echo    If the file does not exist yet it will be created on first login.
echo    This change only lasts for the current session of this tool.
echo    To make it permanent, edit STATE_FILE at the top of other_features.bat
echo    or run  start.bat  (which also uses .rpow-a.json by default).
echo.
echo  --------------------------------------------------------------------
echo.
set /p "NEW_STATE=  Enter new state file name (or B to go back): "
if /i "!NEW_STATE!"=="b" goto :main_menu
if "!NEW_STATE!"=="" (
    echo.
    echo  [!] No filename entered. Keeping current: %STATE_FILE%
    set /p "X=  Press ENTER to return to main menu..."
    goto :main_menu
)

:: Basic validation — must end in .json
echo !NEW_STATE! | findstr /i "\.json$" >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [!] File name must end in .json
    set /p "X=  Press ENTER to return to main menu..."
    goto :main_menu
)

set "STATE_FILE=!NEW_STATE!"
echo.
echo  [OK] State file changed to: !STATE_FILE!
if exist "!STATE_FILE!" (
    echo       File exists — checking session...
    echo.
    node rpow-cli.js me --state "!STATE_FILE!" >nul 2>&1
    if "!errorlevel!"=="0" (
        echo       Session: VALID ✓
    ) else (
        echo       Session: not logged in for this state file.
    )
) else (
    echo       File does not exist yet — it will be created on first login.
)
echo.
echo  --------------------------------------------------------------------
set /p "BACK=  Press ENTER to return to main menu..."
goto :main_menu


:: -----------------------------------------------------------------------
:exit_bat
echo.
echo  Goodbye!
echo.
timeout /t 1 >nul
exit /b 0
