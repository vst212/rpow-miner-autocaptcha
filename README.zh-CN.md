# rpow-miner-autocaptcha

[stablemarkk/rpow_cli_miner](https://github.com/stablemarkk/rpow_cli_miner) 的 Fork，新增了 Windows 交互式启动器、Cloudflare Turnstile 自动验证码识别以及功能完整的工具菜单。

原生 C/OpenCL RPOW 矿工，支持 CPU 和 GPU 后端 — 比浏览器挖矿快 700 倍，比纯 CPU 快 35 倍。

## 本 Fork 新增内容

| 功能 | 说明 |
|---|---|
| `start.bat` | 交互式启动器：检测会话、自动登录（含验证码）、选择引擎与资源、断点续挖 |
| `other_features.bat` | 图形菜单：账户信息、活动记录、发送、账本、Cookie 登录、登出、会话检查 |
| YesCaptcha 自动识别 | 登录时自动识别 Cloudflare Turnstile（无需手动复制粘贴） |
| `.env` 加载器 | `YESCAPTCHA_KEY`、`RPOW_SITE`、`RPOW_API` 保存在 `.env` 中，无需额外 npm 包 |
| 多服务器支持 | 通过 `.env` 或 `--site`/`--api` 参数切换 rpow2.com / rpow3.com（或任意服务器） |
| 小数发送 | `--amount 1.25` — 最多支持 9 位小数，通过 `amount_base_units` 实现 |
| 现代 API | `formatBaseUnits` / `parseRpowToBaseUnits` — 兼容新旧服务器响应格式 |
| Cookie 登录 | `cookie-login` 命令自动去除 `Cookie:` 前缀、引号及多余空白 |
| 格式化输出 | `me`、`ledger`、`activity` 均以人类可读的 RPOW 数值显示 |

## 功能概览

- 无需浏览器的 RPOW CLI 流程
- 原生 C CPU 矿工
- 原生 C + OpenCL GPU 矿工
- 会话持久化（本地状态文件）
- 自动重试处理瞬时 API / 网络故障
- 无需 `npm install` 的便携 Windows 包

## 支持的引擎

- `--engine native`（原生 CPU）
- `--engine gpu`（GPU，需 OpenCL）

## 快速开始

```powershell
node rpow-cli.js login --email you@example.com --state .rpow-a.json
node rpow-cli.js complete-login --link "https://..." --state .rpow-a.json
node rpow-cli.js mine --count 1000 --engine gpu --state .rpow-a.json
```

## Windows GPU 安装

1. 安装 Node.js 18+ 并确认可用：

```powershell
node -v
```

2. 确保 GPU 驱动已安装并支持 OpenCL：

   - NVIDIA：标准 GeForce 或 Studio 驱动通常已包含 OpenCL。
   - AMD：安装标准 Adrenalin 驱动即可。

3. 编译 GPU 矿工：

```powershell
.\build-gpu.ps1
```

4. 请求魔法链接：

```powershell
node rpow-cli.js login --email you@example.com --state .rpow-a.json
```

5. 用邮件中的链接完成登录：

```powershell
node rpow-cli.js complete-login --link "https://..." --state .rpow-a.json
```

6. 开始 GPU 挖矿：

```powershell
node rpow-cli.js mine --count 1000 --engine gpu --state .rpow-a.json
```

7. 针对高端 GPU 的可选调优示例：

```powershell
node rpow-cli.js mine --count 1000 --engine gpu --state .rpow-a.json --workers 16 --gpu-batch 2097152 --gpu-local-size 256
```

如果 GPU 二进制文件无法启动，可直接测试：

```powershell
.\rpow-gpu-miner.exe --prefix 00 --difficulty 1 --batch-size 1024 --local-size 64
```

如果 GPU 不可用，改用 CPU：

```powershell
node rpow-cli.js mine --count 1000 --engine native --workers 8 --state .rpow-a.json
```

## GPU 示例

```powershell
node rpow-cli.js mine --count 1000 --engine gpu --state .rpow-a.json --workers 16 --gpu-batch 2097152 --gpu-local-size 256
```

## CPU 示例

```powershell
node rpow-cli.js mine --count 1000 --engine native --workers 12 --state .rpow-a.json
```

## 文件说明

- `rpow-cli.js` — CLI 协调器
- `rpow-native-miner.c` / `rpow-native-miner.exe` — 原生 CPU 矿工
- `rpow-gpu-miner.c` / `rpow-gpu-miner.exe` — 原生 GPU 矿工
- `rpow-miner-worker.js` — Node 后备 worker
- `index.js` — 用于 API 探测的前端包

更多使用细节请参阅 `rpow-cli.README.md`、`INSTALL-OTHER-PC.md` 和 `INSTALL-GPU-OTHER-PC.md`。

## 使用 `start.bat` 快速开始（Windows）

`start.bat` 是一个交互式启动器，引导你完成每一个步骤：

1. **检查 Node.js** 是否已安装。
2. **创建 `.env`**（若不存在）— 提示输入 YesCaptcha Key，用于自动识别登录时的 Cloudflare Turnstile。
   注册地址：<https://yescaptcha.com/i/JLPgt4>
3. **验证会话** — 若已过期，自动引导完成邮件 + 魔法链接登录。
4. **选择挖矿引擎**（GPU / CPU）。
5. **自动检测 CPU 线程数**，提供 100% / 80% / 50% / 25% 预设。
6. **保存设置**到 `.start-config.json`，下次一键继续。
7. **自动循环挖矿**，每轮结束后自动重启。

```bat
start.bat
```

`.start-config.json` 和 `.env` 已被 `.gitignore` 排除在版本控制之外。

## 切换挖矿服务器

默认服务器为 **rpow2.com**。如需切换到其他服务器，在 `.env` 中添加：

```
RPOW_SITE=https://rpow3.com
RPOW_API=https://api.rpow3.com
```

或每次运行时通过参数指定：

```powershell
node rpow-cli.js mine --site https://rpow3.com --api https://api.rpow3.com --state .rpow-a.json
```

优先级：`--site`/`--api` 参数 > `.env` 设置 > 默认值（rpow2.com）。

---

## 版权声明

本项目 Fork 自 **[stablemarkk/rpow_cli_miner](https://github.com/stablemarkk/rpow_cli_miner)**，作者 [@stablemarkk](https://github.com/stablemarkk)。

> 上游仓库**未附带明确的开源许可证**。根据版权法，这意味着原始代码仍属作者"保留所有权利"。本 Fork 仅供**个人 / 学习**使用。如需商业使用或再发行，请联系上游作者获取授权。

### 本 Fork 的改动

- 通过 [YesCaptcha](https://yescaptcha.com/i/JLPgt4) 自动识别 Cloudflare Turnstile
- 纯 Node.js `.env` 加载器，无需额外 npm 包
- `start.bat` — 含会话验证、引擎选择、资源预设、配置恢复的交互式启动器
- `other_features.bat` — 全功能图形菜单（非挖矿命令）
- `cookie-login` 命令，含 `normalizeCookieInput()`（自动去除 headers / 引号 / 空白）
- `formatBaseUnits()` / `parseRpowToBaseUnits()` — 小数 RPOW 显示与输入
- `me`、`ledger`、`activity` 输出兼容新旧服务器协议
- `send` 支持小数金额，同时发送 `amount` 和 `amount_base_units` 字段

### 第三方服务

| 服务 | 用途 | 条款 |
|---------|---------|-------|
| [rpow2.com](https://rpow2.com) | RPOW 挖矿后端 | rpow2.com 使用条款 |
| [YesCaptcha](https://yescaptcha.com/i/JLPgt4) | 验证码识别 API | yescaptcha.com 使用条款 |

使用第三方服务须遵守其各自条款。请确保你的挖矿活动符合 rpow2.com 规则及适用法律。
