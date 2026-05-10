# rpow-miner-autocaptcha

A fork of [stablemarkk/rpow_cli_miner](https://github.com/stablemarkk/rpow_cli_miner) with an
interactive Windows launcher, Cloudflare Turnstile auto-solve, and a full-featured tools menu.

Native C/OpenCL RPOW miner with CPU and GPU backends — up to 700× faster than
browser mining and 35× faster than CPU.

## What this fork adds

| Feature | Details |
|---|---|
| `start.bat` | Interactive launcher: detects session, auto-login with captcha, engine + resource selection, resume |
| `other_features.bat` | GUI menu for account info, activity, send, ledger, cookie-login, logout, session check |
| YesCaptcha auto-solve | Automatically solves Cloudflare Turnstile during login (no manual copy-paste) |
| `.env` loader | `YESCAPTCHA_KEY` stored in `.env` — no extra npm packages |
| Decimal send | `--amount 1.25` — supports up to 9 decimal places via `amount_base_units` |
| Modern API | `formatBaseUnits` / `parseRpowToBaseUnits` — handles both legacy and modern server responses |
| Cookie login | `cookie-login` command strips `Cookie:` headers, quotes, whitespace automatically |
| Formatted output | `me`, `ledger`, `activity` all display human-readable RPOW values |

## Features

- Browserless CLI flow for RPOW backend/API
- Native CPU miner in C
- Native GPU miner in C with OpenCL
- Node fallback miner
- Session persistence with local state files
- Retry handling for transient API/network failures
- Portable Windows bundle with no `npm install`

## Included engines

- `--engine node`
- `--engine native`
- `--engine gpu`

## Quick start

```powershell
node rpow-cli.js login --email you@example.com --state .rpow-a.json
node rpow-cli.js complete-login --link "https://..." --state .rpow-a.json
node rpow-cli.js mine --count 1000 --engine gpu --state .rpow-a.json
```

## Windows GPU setup

1. Install Node.js 18+ and confirm it works:

```powershell
node -v
```

2. Make sure your GPU driver is installed with OpenCL support.

- NVIDIA: standard GeForce or Studio driver is usually enough.
- AMD: install the normal Adrenalin driver.

3. Build the GPU miner:

```powershell
.\build-gpu.ps1
```

4. Request a magic link:

```powershell
node rpow-cli.js login --email you@example.com --state .rpow-a.json
```

5. Complete login with the link from your email:

```powershell
node rpow-cli.js complete-login --link "https://..." --state .rpow-a.json
```

6. Start GPU mining:

```powershell
node rpow-cli.js mine --count 1000 --engine gpu --state .rpow-a.json
```

7. Optional tuning example for stronger GPUs:

```powershell
node rpow-cli.js mine --count 1000 --engine gpu --state .rpow-a.json --workers 16 --gpu-batch 2097152 --gpu-local-size 256
```

If the GPU binary does not start, test it directly:

```powershell
.\rpow-gpu-miner.exe --prefix 00 --difficulty 1 --batch-size 1024 --local-size 64
```

If GPU mining is unavailable, use CPU fallback:

```powershell
node rpow-cli.js mine --count 1000 --engine native --workers 8 --state .rpow-a.json
```

## GPU example

```powershell
node rpow-cli.js mine --count 1000 --engine gpu --state .rpow-a.json --workers 16 --gpu-batch 2097152 --gpu-local-size 256
```

## CPU example

```powershell
node rpow-cli.js mine --count 1000 --engine native --workers 12 --state .rpow-a.json
```

## Files

- `rpow-cli.js` - CLI orchestrator
- `rpow-native-miner.c` / `rpow-native-miner.exe` - native CPU miner
- `rpow-gpu-miner.c` / `rpow-gpu-miner.exe` - native GPU miner
- `rpow-miner-worker.js` - Node fallback worker
- `index.js` - frontend bundle used for API discovery

See `rpow-cli.README.md`, `INSTALL-OTHER-PC.md`, and `INSTALL-GPU-OTHER-PC.md` for more usage details.

## Quick start with `start.bat` (Windows)

`start.bat` is an interactive launcher that guides you through every step:

1. **Checks Node.js** is installed.
2. **Creates `.env`** if missing — prompts for your YesCaptcha key (used to
   automatically solve the Cloudflare Turnstile during login).
   Sign up at: <https://yescaptcha.com/i/JLPgt4>
3. **Validates your session** — if it has expired it walks you through the
   email + magic-link login automatically.
4. **Lets you choose** the mining engine (GPU / CPU / Node).
5. **Auto-detects CPU threads** and offers 100 % / 80 % / 50 % / 25 % presets.
6. **Saves settings** to `.start-config.json` so you can resume with one key-press next time.
7. **Loops mining** automatically after each round.

```bat
start.bat
```

`.start-config.json` and `.env` are excluded from git (see `.gitignore`).

---

## Credits & Legal Notice

This project is a fork of
**[stablemarkk/rpow_cli_miner](https://github.com/stablemarkk/rpow_cli_miner)**
by [@stablemarkk](https://github.com/stablemarkk).

> **No explicit open-source license** is present in the upstream repository.
> Under copyright law this means the original code remains "all rights reserved"
> by the original author.  This fork is published for **personal / educational
> use only**.  If you intend to use or redistribute this code commercially,
> please contact the upstream author to obtain explicit permission.

### Changes in this fork

- Cloudflare Turnstile auto-solving via [YesCaptcha](https://yescaptcha.com/i/JLPgt4)
- Pure Node.js `.env` loader — no extra npm packages
- `start.bat` — interactive launcher with session validation, engine selection, resource presets, config resume
- `other_features.bat` — full GUI menu for all non-mining commands
- `cookie-login` command with `normalizeCookieInput()` (strips headers/quotes/whitespace)
- `formatBaseUnits()` / `parseRpowToBaseUnits()` — decimal RPOW display and input
- `me`, `ledger`, `activity` output formatted for both legacy and modern server protocol
- `send` supports decimal amounts and sends both `amount` and `amount_base_units` fields

### Third-party services

| Service | Purpose | Terms |
|---------|---------|-------|
| [rpow2.com](https://rpow2.com) | RPOW mining backend | rpow2.com ToS |
| [YesCaptcha](https://yescaptcha.com/i/JLPgt4) | Captcha solving API | yescaptcha.com ToS |

Use of third-party services is subject to their own terms.  Always ensure
your mining activity complies with rpow2.com's rules and any applicable laws.
