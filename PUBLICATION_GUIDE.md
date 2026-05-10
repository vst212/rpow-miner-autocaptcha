# Publication Guide

This guide is for preparing the project for a public GitHub repository.

## Recommended Repository Name

Best choice:

```text
rpow-native-cli-portable
```

Why: it makes the native C miner the main signal while still describing the project as a portable CLI.

Other acceptable names:

```text
rpow-cli-portable
rpow2-cli
rpow2-miner-cli
rpow-cli
```

Avoid names like `official-rpow-cli` unless the RPOW2 project explicitly authorizes it.

## Public Repository Description

Use this GitHub description:

```text
Portable unofficial RPOW2 command-line client with a native C proof-of-work miner.
```

## Keep

Keep these files in the public repository:

```text
README.md
PUBLICATION_GUIDE.md
.gitignore
rpow-native-miner.c
build-native.ps1
build-native.sh
rpow-cli.js
rpow-miner-worker.js
index.js
INSTALL-OTHER-PC.md
```

Notes:

- `rpow-native-miner.c` is the core mining implementation and should be treated as the main miner source.
- `build-native.ps1` and `build-native.sh` let users build the native miner for their own OS.
- Native binaries such as `rpow-native-miner.exe` should be built for releases, not committed by default.
- `rpow-cli.js` wraps login, API requests, retries, session state and miner orchestration.
- `rpow-miner-worker.js` is required only for the slower `--engine node` fallback.
- `index.js` is currently used by `node rpow-cli.js map`, so keep it unless you remove that discovery feature from the CLI.

## Delete or Never Commit

Never publish:

```text
.rpow-cli-state.json
.rpow-cli-state.*.json
.env
*.log
```

`.rpow-cli-state.json` contains private runtime data:

```text
email
session cookies
current challenge
mining nonce progress
last mint metadata
```

If this file was ever committed, rotate/logout the session and remove it from git history before making the repository public.

## Optional Cleanup

Recommended before first public push:

```text
Rename rpow-cli.README.md to README.md or remove the duplicate old file.
Keep INSTALL-OTHER-PC.md only if you want a short Windows install note separate from README.
Add a LICENSE file if you want others to reuse or modify the code legally.
```

Suggested license: MIT, if you want permissive public reuse.

## First GitHub Push

From this folder:

```powershell
git init
git add README.md PUBLICATION_GUIDE.md .gitignore build-native.ps1 build-native.sh rpow-cli.js rpow-miner-worker.js rpow-native-miner.c index.js INSTALL-OTHER-PC.md
git status
git commit -m "Initial public release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/rpow-native-cli-portable.git
git push -u origin main
```

Do not use `git add .` for the first commit until you have checked `git status`.

## GitHub Repository Settings

Recommended settings:

```text
Visibility: Public
Default branch: main
Issues: Enabled
Discussions: Optional
Wiki: Disabled unless you plan to maintain docs there
```

Add topics:

```text
rpow
rpow2
cli
proof-of-work
nodejs
miner
portable
```

## Release Checklist

Before creating a GitHub Release:

```powershell
git status
node rpow-cli.js map
node rpow-cli.js ledger
node rpow-cli.js --help
```

Then verify:

```text
.rpow-cli-state.json is absent from git status.
README.md explains login, mining, sending, state, logs and security.
Native release binaries, if attached later, are built from the published rpow-native-miner.c source.
Build scripts exist for Windows and macOS/Linux.
README.md presents `--engine native` as the recommended mining path.
The repo description says unofficial unless the project is officially approved.
```

## Suggested Release Name

For the first release:

```text
v0.1.0
```

Release title:

```text
RPOW Native CLI Portable v0.1.0
```

Release notes:

```text
Initial public release with magic-link login, native C proof-of-work mining, minting, sending, activity and ledger commands. Includes C source, Windows/macOS/Linux build scripts, beginner build instructions and a slower JavaScript fallback.
```
