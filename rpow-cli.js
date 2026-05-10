#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { Worker } = require("worker_threads");

// 載入 .env 檔（若存在）
(function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !(key in process.env)) process.env[key] = value;
  }
})();

const DEFAULT_SITE_ORIGIN = process.env.RPOW_SITE || "https://rpow2.com";
const DEFAULT_API_ORIGIN = process.env.RPOW_API  || "https://api.rpow2.com";
const DEFAULT_INDEX = path.join(__dirname, "index.js");
const DEFAULT_STATE = path.join(__dirname, ".rpow-cli-state.json");
const MINER_WORKER = path.join(__dirname, "rpow-miner-worker.js");
const NATIVE_MINER = path.join(__dirname, "rpow-native-miner.exe");
const GPU_MINER = path.join(__dirname, "rpow-gpu-miner.exe");
const SAFE_HOSTS = new Set([
  "api.rpow2.com",
  "rpow2.com",
  "www.rpow2.com",
  "api.rpow3.com",
  "rpow3.com",
  "www.rpow3.com",
  "127.0.0.1.sslip.io",
]);
function registerCustomOrigins(...origins) {
  for (const o of origins) {
    if (!o) continue;
    try { SAFE_HOSTS.add(new URL(o).hostname); } catch {}
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const YESCAPTCHA_API = "https://api.yescaptcha.com";
let TURNSTILE_SITE_KEY = process.env.RPOW_TURNSTILE_KEY || "0x4AAAAAADLyZ9ztTUV1Pm1F";
let TURNSTILE_SITE_URL = "https://rpow2.com";

async function fetchTurnstileSiteKey(siteUrl) {
  try {
    const res = await fetch(siteUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await res.text();
    const match = /data-sitekey=["']([^"']+)["']/.exec(html);
    if (match) {
      log("info", "detected Turnstile site key from page", { key: match[1] });
      return match[1];
    }
    log("info", "no data-sitekey found in page HTML, using default/env key");
  } catch (err) {
    log("warn", "could not fetch site key from page, using default", { error: err.message });
  }
  return null;
}

async function solveTurnstileOnce(clientKey) {
  log("info", "submitting Turnstile task to YesCaptcha...");
  const createRes = await fetch(`${YESCAPTCHA_API}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey,
      softID: 4595,
      task: {
        type: "TurnstileTaskProxyless",
        websiteURL: TURNSTILE_SITE_URL,
        websiteKey: TURNSTILE_SITE_KEY,
      },
    }),
  });
  const createData = await createRes.json();
  if (createData.errorId !== 0) {
    throw new Error(`YesCaptcha createTask error: ${createData.errorDescription || createData.errorCode}`);
  }
  const taskId = createData.taskId;
  log("info", "Turnstile task created", { taskId });

  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const resultRes = await fetch(`${YESCAPTCHA_API}/getTaskResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey, taskId }),
    });
    const resultData = await resultRes.json();
    if (resultData.errorId !== 0) {
      throw new Error(`YesCaptcha getTaskResult error: ${resultData.errorDescription || resultData.errorCode}`);
    }
    if (resultData.status === "ready") {
      log("info", "Turnstile token obtained");
      return resultData.solution.token;
    }
    log("info", `Turnstile solving... (${i + 1}/40)`);
  }
  throw new Error("YesCaptcha: timed out waiting for Turnstile solution");
}

async function solveTurnstile(clientKey, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await solveTurnstileOnce(clientKey);
    } catch (err) {
      if (attempt < maxAttempts) {
        log("warn", `Turnstile attempt ${attempt}/${maxAttempts} failed, retrying...`, { error: err.message });
        await sleep(2000);
      } else {
        throw err;
      }
    }
  }
}
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function log(level, message, data) {
  const suffix = data === undefined ? "" : ` ${formatLogData(data)}`;
  const upper = level.toUpperCase();
  const plainLevel = upper.padEnd(7);
  const color = process.env.NO_COLOR
    ? ""
    : upper === "SUCCESS" ? COLORS.green
      : upper === "WARN" ? COLORS.yellow
        : upper === "ERROR" ? COLORS.red
          : upper === "INFO" ? COLORS.cyan
            : "";
  const reset = color ? COLORS.reset : "";
  console.log(`${new Date().toISOString()} ${color}${plainLevel}${reset} ${message}${suffix}`);
}

function verboseEnabled() {
  return process.env.RPOW_VERBOSE === "1" || globalThis.__RPOW_VERBOSE__ === true;
}

function debugLog(message, data) {
  if (verboseEnabled()) log("info", message, data);
}

function formatLogData(data) {
  if (data === null || typeof data !== "object") return String(data);
  return Object.entries(data).map(([key, value]) => {
    if (value === undefined) return null;
    if (value === null) return `${key}=null`;
    if (typeof value === "object") return `${key}=${JSON.stringify(value)}`;
    const text = String(value);
    return /^[A-Za-z0-9._:/?=-]+$/.test(text) ? `${key}=${text}` : `${key}=${JSON.stringify(text)}`;
  }).filter(Boolean).join(" ");
}

function safeUrlForLog(url) {
  return `${url.origin}${url.pathname}${url.search ? "?..." : ""}`;
}

function retryAfterMs(headers) {
  const value = headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function isAuthRequest(method, url) {
  return method === "POST" && url.pathname === "/auth/request";
}

function looksLikeProviderRateLimit(err) {
  return err.status === 429
    || err.code === "RATE_LIMITED"
    || /too many requests|rate limit|try again/i.test(err.message || "");
}

function isChallengeRequest(method, url) {
  return method === "POST" && url.pathname === "/challenge";
}

function errorCode(err) {
  return err?.code || err?.cause?.code || err?.cause?.cause?.code;
}

function isTransientNetworkError(err) {
  const code = errorCode(err);
  return err?.name === "AbortError"
    || err?.message === "fetch failed"
    || [
      "ECONNRESET",
      "ECONNREFUSED",
      "EPIPE",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(code);
}

function isRecoverableMineError(err) {
  return err?.retryable
    || isTransientNetworkError(err)
    || [408, 425, 429, 500, 502, 503, 504].includes(err?.status);
}

function cooldownDelayMs(err) {
  const message = err?.message || "";
  const secondsMatch = /\bwait\s+(\d+(?:\.\d+)?)s\b/i.exec(message);
  if (secondsMatch) return Math.ceil(Number(secondsMatch[1]) * 1000) + 250;
  const plainSecondsMatch = /\bwait\s+(\d+(?:\.\d+)?)\s+seconds?\b/i.exec(message);
  if (plainSecondsMatch) return Math.ceil(Number(plainSecondsMatch[1]) * 1000) + 250;
  return null;
}

function mineRetryDelayMs(failures, err) {
  const cooldownMs = cooldownDelayMs(err);
  if (err?.status === 429 && err?.code === "COOLDOWN" && cooldownMs) return cooldownMs;
  const retryAfter = Math.min(err?.retryAfterMs || 0, 15000);
  const backoff = Math.min(15000, 1000 * 2 ** Math.max(0, failures - 1));
  return Math.max(backoff, retryAfter || 0, 1000) + Math.floor(Math.random() * 250);
}

function postMintDelayMs() {
  return 5000 + Math.floor(Math.random() * 350);
}

function loadState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

function isRetryableStateWriteError(err) {
  return ["EPERM", "EACCES", "EBUSY"].includes(err?.code);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function saveState(file, state) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  fs.writeFileSync(tmp, payload);
  try {
    for (let attempt = 1; ; attempt += 1) {
      try {
        fs.renameSync(tmp, file);
        return;
      } catch (err) {
        if (!isRetryableStateWriteError(err) || attempt >= 5) throw err;
        sleepSync(attempt * 25);
      }
    }
  } catch (err) {
    if (!isRetryableStateWriteError(err)) throw err;
    fs.writeFileSync(file, payload);
    try {
      fs.unlinkSync(tmp);
    } catch (unlinkErr) {
      if (unlinkErr.code !== "ENOENT") debugLog("state tmp cleanup skipped", { file: tmp, code: unlinkErr.code });
    }
    log("warn", "state rename was blocked; fell back to direct overwrite", { file, code: err.code });
  }
}

function discoverFromIndex(indexFile) {
  const js = fs.readFileSync(indexFile, "utf8");
  const apiOrigin = /const\s+\w+\s*=\s*"([^"]+)";\s*async function\s+\w+\(\w+,\s*\w+,\s*\w+\)/.exec(js)?.[1]
    || DEFAULT_API_ORIGIN;
  const endpoints = [...js.matchAll(/(\w+):\s*(?:(?:\(\)|\w+)\s*=>\s*)?\w+\("([A-Z]+)",\s*"([^"]+)"/g)]
    .map((m) => ({ name: m[1], method: m[2], path: m[3] }));
  const workerPath = /new URL\("([^"]*miner\.worker-[^"]+\.js)"/.exec(js)?.[1] || null;
  return { apiOrigin, endpoints, workerPath };
}

function printApiMap(discovered) {
  console.log(`API origin: ${discovered.apiOrigin}`);
  console.log("Browser request defaults: credentials=include, JSON content-type only when body exists.");
  console.log("Sequence:");
  console.log("1. POST /auth/request { email } -> sends magic link, no browser UI needed.");
  console.log("2. Open/fetch magic link -> server sets session cookie; CLI stores Set-Cookie values.");
  console.log("3. GET /me -> verifies session and balance.");
  console.log("4. POST /challenge -> { challenge_id, nonce_prefix, difficulty_bits }.");
  console.log("5. Mine locally: SHA-256(nonce_prefix || uint64-le nonce), accept trailing zero bits >= difficulty_bits.");
  console.log("6. POST /mint { challenge_id, solution_nonce } -> mints/claims token.");
  console.log("7. Repeat from /challenge for more tokens; no separate commit/reveal endpoint is used by this site.");
  console.log("Endpoints found in index.js:");
  for (const e of discovered.endpoints) console.log(`- ${e.name}: ${e.method} ${e.path}`);
  if (discovered.workerPath) console.log(`Worker: ${discovered.workerPath}`);
}

function assertSafeUrl(rawUrl, apiOrigin) {
  const url = new URL(rawUrl, apiOrigin);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error(`blocked non-http URL: ${rawUrl}`);
  if (!SAFE_HOSTS.has(url.hostname)) throw new Error(`blocked host outside site/API allowlist: ${url.hostname}`);
  return url;
}

function cookieHeader(cookies = {}) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeSetCookies(state, setCookieHeaders) {
  if (!setCookieHeaders || setCookieHeaders.length === 0) return;
  state.cookies ||= {};
  for (const header of setCookieHeaders) {
    const first = header.split(";", 1)[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (value) state.cookies[name] = value;
    else delete state.cookies[name];
  }
}

function responseSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

class RpowClient {
  constructor(options) {
    this.apiOrigin = options.apiOrigin;
    this.siteOrigin = options.siteOrigin;
    this.stateFile = options.stateFile;
    this.state = loadState(this.stateFile);
    this.timeoutMs = Number(options.timeoutMs || 45000);
    this.maxRetries = Number(options.retries || 5);
  }

  save() {
    this.state.updated_at = new Date().toISOString();
    saveState(this.stateFile, this.state);
  }

  async request(method, urlOrPath, body, options = {}) {
    const url = assertSafeUrl(urlOrPath, this.apiOrigin);
    let attempt = 0;
    while (true) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
      const started = Date.now();
      try {
        const headers = {
          "accept": "*/*",
          "accept-language": "en-US,en;q=0.9,ru;q=0.8",
          "origin": this.siteOrigin,
          "priority": "u=1, i",
          "referer": `${this.siteOrigin}/`,
          "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-site",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        };
        const cookies = cookieHeader(this.state.cookies);
        if (cookies) headers.cookie = cookies;
        let payload;
        if (body !== undefined) {
          headers["content-type"] = "application/json";
          payload = JSON.stringify(body);
        }
        debugLog("HTTP ->", {
          method,
          url: safeUrlForLog(url),
          attempt,
          has_body: body !== undefined,
          has_cookie: Boolean(headers.cookie),
        });
        const res = await fetch(url, {
          method,
          headers,
          body: payload,
          redirect: options.redirect || "manual",
          signal: controller.signal,
        });
        storeSetCookies(this.state, responseSetCookies(res.headers));
        this.save();
        const text = await res.text();
        const parsed = text ? tryJson(text) : undefined;
        debugLog("HTTP <-", {
          method,
          url: safeUrlForLog(url),
          attempt,
          status: res.status,
          ms: Date.now() - started,
          set_cookie: responseSetCookies(res.headers).length > 0,
          retry_after_ms: retryAfterMs(res.headers),
        });
        if (res.status === 401 && options.allowUnauthorized !== true) {
          const err = new Error(parsed?.message || "login required");
          err.code = "UNAUTHORIZED";
          err.status = res.status;
          throw err;
        }
        if (!res.ok && ![301, 302, 303, 307, 308].includes(res.status)) {
          const err = new Error(parsed?.message || res.statusText || `HTTP ${res.status}`);
          err.status = res.status;
          err.code = parsed?.error;
          err.retryable = [408, 425, 429, 500, 502, 503, 504].includes(res.status);
          if (isAuthRequest(method, url) && looksLikeProviderRateLimit(err)) {
            err.retryable = false;
            err.cooldownMs = Math.max(retryAfterMs(res.headers) || 0, 60000);
          }
          err.retryAfterMs = retryAfterMs(res.headers);
          throw err;
        }
        return { res, data: parsed ?? text };
      } catch (err) {
        if (isAuthRequest(method, url) && looksLikeProviderRateLimit(err)) {
          const waitSeconds = Math.ceil((err.cooldownMs || 60000) / 1000);
          const e = new Error(`magic-link request is rate-limited; wait at least ${waitSeconds}s before running login again`);
          e.code = err.code || "RATE_LIMITED";
          e.status = err.status;
          throw e;
        }
        const retryable = err.retryable || isTransientNetworkError(err);
        const blockedByNoRetry = options.noRetryStatuses && err.status && options.noRetryStatuses.includes(err.status);
        if (!retryable || blockedByNoRetry || attempt > this.maxRetries) throw err;
        const challengeCooldown = isChallengeRequest(method, url) && err?.status === 429 && err?.code === "COOLDOWN";
        const backoff = Math.min(30000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
        const parsedCooldown = challengeCooldown ? (cooldownDelayMs(err) ?? 2500) : null;
        const delay = challengeCooldown
          ? Math.max(parsedCooldown, Math.min(err.retryAfterMs || 0, 60000))
          : Math.max(backoff, Math.min(err.retryAfterMs || 0, 60000));
        log("warn", `request failed, retrying in ${delay}ms`, {
          method,
          url: safeUrlForLog(url),
          attempt,
          status: err.status,
          code: errorCode(err),
          error: err.message,
        });
        await sleep(delay);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  async followMagicLink(link) {
    let url = assertSafeUrl(link, this.apiOrigin).href;
    for (let i = 0; i < 8; i += 1) {
      const { res, data } = await this.request("GET", url, undefined, { redirect: "manual", allowUnauthorized: true });
      const location = res.headers.get("location");
      log("info", "magic-link step", { status: res.status, location: location ? safeUrlForLog(assertSafeUrl(location, url)) : null });
      if (![301, 302, 303, 307, 308].includes(res.status) || !location) return data;
      url = assertSafeUrl(location, url).href;
    }
    throw new Error("too many redirects while completing magic link");
  }

  async api(method, pathName, body, options) {
    return (await this.request(method, pathName, body, options)).data;
  }
}

// ─── base-units helpers (ported from MeepoTu/rpow Rust fork) ───────────────
const BASE_UNITS_PER_RPOW = 1_000_000_000n;

function formatBaseUnits(raw) {
  let value;
  try { value = BigInt(raw); } catch { return String(raw); }
  const whole = value / BASE_UNITS_PER_RPOW;
  const frac = value % BASE_UNITS_PER_RPOW;
  if (frac === 0n) return whole.toString();
  const fracAbs = frac < 0n ? -frac : frac;
  const fracText = fracAbs.toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole}.${fracText}`;
}

function parseRpowToBaseUnits(raw) {
  const input = (raw || "").trim();
  if (!input) throw new Error("amount must not be empty");
  if (input.startsWith("-")) throw new Error("amount must be positive");
  const parts = input.split(".");
  if (parts.length > 2) throw new Error("amount must be a decimal with at most one dot");
  const whole = parts[0];
  const frac = parts[1] || "";
  if (!whole || !/^\d+$/.test(whole)) throw new Error("amount must contain only digits");
  if (frac && !/^\d+$/.test(frac)) throw new Error("amount must contain only digits");
  if (frac.length > 9) throw new Error("amount supports at most 9 decimal places");
  const fracPadded = frac.padEnd(9, "0");
  const total = BigInt(whole) * BASE_UNITS_PER_RPOW + BigInt(fracPadded);
  if (total <= 0n) throw new Error("amount must be positive");
  return total.toString();
}

function normalizeCookieInput(input) {
  let s = (input || "").trim();
  // strip Cookie: / Set-Cookie: prefix
  for (const prefix of ["Cookie:", "cookie:", "Set-Cookie:", "set-cookie:"]) {
    if (s.startsWith(prefix)) { s = s.slice(prefix.length).trim(); break; }
  }
  // extract value of rpow_session=...
  const idx = s.indexOf("rpow_session=");
  if (idx !== -1) s = s.slice(idx + "rpow_session=".length);
  // take up to first ;
  s = (s.split(";")[0] || "").trim().replace(/^["']|["']$/g, "");
  // strip internal whitespace
  s = s.replace(/\s+/g, "");
  if (!s) throw new Error("cookie value is empty");
  return s;
}
// ─────────────────────────────────────────────────────────────────────────────

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) throw new Error(`bad nonce_prefix hex: ${hex}`);
  return Buffer.from(hex, "hex");
}

function nonceLe64(nonce) {
  const out = Buffer.allocUnsafe(8);
  let n = BigInt(nonce);
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function trailingZeroBits(buf) {
  let bits = 0;
  for (let i = buf.length - 1; i >= 0; i -= 1) {
    const byte = buf[i];
    if (byte === 0) {
      bits += 8;
      continue;
    }
    for (let bit = 0; bit < 8; bit += 1) {
      if ((byte & (1 << bit)) === 0) bits += 1;
      else return bits;
    }
  }
  return bits;
}

function defaultWorkerCount() {
  return Math.max(1, Math.min(os.cpus().length - 1, os.cpus().length, 8));
}

function mineSolutionSingleThread(challenge, state, stateFile, logEveryMs) {
  const prefix = hexToBytes(challenge.nonce_prefix);
  const difficulty = Number(challenge.difficulty_bits);
  const expiresAt = challenge.expires_at ? Date.parse(challenge.expires_at) : null;
  const cutoffAt = Number.isFinite(expiresAt) ? expiresAt - 5000 : null;
  let nonce = BigInt(state.mining?.nonce || "0");
  let hashes = BigInt(state.mining?.hashes || "0");
  const started = Date.now();
  let lastLog = started;
  while (true) {
    if (cutoffAt && Date.now() >= cutoffAt) {
      const err = new Error("challenge expired before a solution was found");
      err.code = "CHALLENGE_EXPIRED";
      err.retryable = true;
      throw err;
    }
    const digest = crypto.createHash("sha256").update(prefix).update(nonceLe64(nonce)).digest();
    if (trailingZeroBits(digest) >= difficulty) {
      state.mining = { ...state.mining, nonce: nonce.toString(), hashes: hashes.toString(), found_at: new Date().toISOString() };
      saveState(stateFile, state);
      return { solution_nonce: nonce.toString(), hashes: hashes.toString(), digest: digest.toString("hex") };
    }
    nonce += 1n;
    hashes += 1n;
    const now = Date.now();
    if (now - lastLog >= logEveryMs) {
      const seconds = Math.max(1, (now - started) / 1000);
      const rate = Number(hashes) / seconds;
      state.mining = { challenge_id: challenge.challenge_id, nonce: nonce.toString(), hashes: hashes.toString(), difficulty_bits: difficulty };
      saveState(stateFile, state);
      log("info", "mining progress", {
        hashes: hashes.toString(),
        nonce: nonce.toString(),
        rate_mhs: `${(rate / 1_000_000).toFixed(2)} MH/s`,
        rate_hps: Math.round(rate),
      });
      lastLog = now;
    }
  }
}

function mineSolutionParallel(challenge, state, stateFile, logEveryMs, workerCount) {
  if (workerCount <= 1) return Promise.resolve(mineSolutionSingleThread(challenge, state, stateFile, logEveryMs));

  return new Promise((resolve, reject) => {
    const difficulty = Number(challenge.difficulty_bits);
    const expiresAt = challenge.expires_at ? Date.parse(challenge.expires_at) : null;
    const cutoffAt = Number.isFinite(expiresAt) ? expiresAt - 5000 : null;
    const startNonce = BigInt(state.mining?.nonce || "0");
    const started = Date.now();
    const workers = [];
    const workerStats = new Map();
    let settled = false;
    let lastSavedNonce = startNonce;

    function cleanup() {
      for (const worker of workers) worker.terminate().catch(() => {});
    }

    function totalHashes() {
      let total = 0n;
      for (const stats of workerStats.values()) total += BigInt(stats.hashes || "0");
      return total;
    }

    function maxNonce() {
      let max = lastSavedNonce;
      for (const stats of workerStats.values()) {
        if (!stats.nonce) continue;
        const n = BigInt(stats.nonce);
        if (n > max) max = n;
      }
      return max;
    }

    const progressTimer = setInterval(() => {
      if (settled) return;
      const hashes = totalHashes();
      const seconds = Math.max(1, (Date.now() - started) / 1000);
      const rate = Number(hashes) / seconds;
      lastSavedNonce = maxNonce();
      state.mining = {
        challenge_id: challenge.challenge_id,
        nonce: lastSavedNonce.toString(),
        hashes: hashes.toString(),
        difficulty_bits: difficulty,
        workers: workerCount,
      };
      saveState(stateFile, state);
      log("info", "mining progress", {
        hashes: hashes.toString(),
        nonce: lastSavedNonce.toString(),
        workers: workerCount,
        rate_mhs: `${(rate / 1_000_000).toFixed(2)} MH/s`,
        rate_hps: Math.round(rate),
      });
    }, logEveryMs);

    for (let i = 0; i < workerCount; i += 1) {
      const worker = new Worker(MINER_WORKER, {
        workerData: {
          noncePrefix: challenge.nonce_prefix,
          difficultyBits: difficulty,
          startNonce: (startNonce + BigInt(i)).toString(),
          stride: String(workerCount),
          cutoffAt,
          progressEveryMs: Math.max(500, Math.floor(logEveryMs / 2)),
        },
      });
      workers.push(worker);
      workerStats.set(i, { hashes: "0", nonce: (startNonce + BigInt(i)).toString() });

      worker.on("message", (message) => {
        if (settled) return;
        if (message.hashes !== undefined || message.nonce !== undefined) {
          workerStats.set(i, {
            hashes: message.hashes ?? workerStats.get(i)?.hashes ?? "0",
            nonce: message.nonce ?? workerStats.get(i)?.nonce,
          });
        }
        if (message.type === "found") {
          settled = true;
          clearInterval(progressTimer);
          cleanup();
          const hashes = totalHashes();
          const seconds = Math.max(0.001, (Date.now() - started) / 1000);
          const rate = Number(hashes) / seconds;
          state.mining = {
            ...state.mining,
            nonce: message.solution_nonce,
            hashes: hashes.toString(),
            found_at: new Date().toISOString(),
            workers: workerCount,
          };
          saveState(stateFile, state);
          resolve({
            solution_nonce: message.solution_nonce,
            hashes: hashes.toString(),
            digest: message.digest,
            speed: `${(rate / 1_000_000).toFixed(2)} MH/s`,
            elapsed_ms: Date.now() - started,
          });
        }
        if (message.type === "expired") {
          settled = true;
          clearInterval(progressTimer);
          cleanup();
          const err = new Error("challenge expired before a solution was found");
          err.code = "CHALLENGE_EXPIRED";
          err.retryable = true;
          reject(err);
        }
      });

      worker.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearInterval(progressTimer);
        cleanup();
        reject(err);
      });

      worker.on("exit", (code) => {
        if (!settled && code !== 0) {
          settled = true;
          clearInterval(progressTimer);
          cleanup();
          reject(new Error(`miner worker exited with code ${code}`));
        }
      });
    }
  });
}

function mineSolutionNative(challenge, state, stateFile, logEveryMs, workerCount) {
  if (!fs.existsSync(NATIVE_MINER)) {
    throw new Error(`native miner not built: ${NATIVE_MINER}`);
  }
  return new Promise((resolve, reject) => {
    const difficulty = Number(challenge.difficulty_bits);
    const expiresAt = challenge.expires_at ? Date.parse(challenge.expires_at) : null;
    const cutoffAt = Number.isFinite(expiresAt) ? expiresAt - 5000 : 0;
    const startNonce = BigInt(state.mining?.nonce || "0");
    const started = Date.now();
    let settled = false;
    let stderr = "";

    const child = spawn(NATIVE_MINER, [
      "--prefix", challenge.nonce_prefix,
      "--difficulty", String(difficulty),
      "--workers", String(workerCount),
      "--start", startNonce.toString(),
      "--cutoff-ms", String(cutoffAt || 0),
      "--progress-ms", String(logEveryMs),
    ], { windowsHide: true });

    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const idx = buffer.indexOf("\n");
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          log("warn", "native miner emitted non-json line", { line });
          continue;
        }
        if (message.type === "progress") {
          const hashes = BigInt(message.hashes || "0");
          const seconds = Math.max(1, (Date.now() - started) / 1000);
          const rate = Number(hashes) / seconds;
          state.mining = {
            challenge_id: challenge.challenge_id,
            nonce: message.nonce,
            hashes: hashes.toString(),
            difficulty_bits: difficulty,
            workers: workerCount,
            engine: "native",
          };
          saveState(stateFile, state);
          log("info", "mining", {
            hashes: hashes.toString(),
            nonce: message.nonce,
            workers: workerCount,
            engine: "native",
            speed: `${(rate / 1_000_000).toFixed(2)} MH/s`,
          });
        }
        if (message.type === "found") {
          settled = true;
          const hashes = BigInt(message.hashes || "0");
          const seconds = Math.max(0.001, (Date.now() - started) / 1000);
          const rate = Number(hashes) / seconds;
          state.mining = {
            ...state.mining,
            nonce: message.solution_nonce,
            hashes: message.hashes,
            found_at: new Date().toISOString(),
            workers: workerCount,
            engine: "native",
          };
          saveState(stateFile, state);
          resolve({
            solution_nonce: message.solution_nonce,
            hashes: message.hashes,
            digest: message.digest,
            speed: `${(rate / 1_000_000).toFixed(2)} MH/s`,
            elapsed_ms: Date.now() - started,
          });
        }
        if (message.type === "expired") {
          settled = true;
          const err = new Error("challenge expired before a solution was found");
          err.code = "CHALLENGE_EXPIRED";
          err.retryable = true;
          reject(err);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (settled) return;
      if (code === 0) return;
      reject(new Error(`native miner exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

function mineSolutionGpu(challenge, state, stateFile, logEveryMs, workerCount, args = {}) {
  if (!fs.existsSync(GPU_MINER)) {
    throw new Error(`gpu miner not built: ${GPU_MINER}`);
  }
  return new Promise((resolve, reject) => {
    const difficulty = Number(challenge.difficulty_bits);
    const expiresAt = challenge.expires_at ? Date.parse(challenge.expires_at) : null;
    const cutoffAt = Number.isFinite(expiresAt) ? expiresAt - 5000 : 0;
    const startNonce = BigInt(state.mining?.nonce || "0");
    const started = Date.now();
    let settled = false;
    let stderr = "";

    const gpuBatchSize = Number(args["gpu-batch"] || Math.max(65536, workerCount * 262144));
    const minerArgs = [
      "--prefix", challenge.nonce_prefix,
      "--difficulty", String(difficulty),
      "--start", startNonce.toString(),
      "--cutoff-ms", String(cutoffAt || 0),
      "--progress-ms", String(logEveryMs),
      "--batch-size", String(gpuBatchSize),
    ];
    if (args["gpu-local-size"]) minerArgs.push("--local-size", String(args["gpu-local-size"]));
    if (args["gpu-platform"]) minerArgs.push("--platform-index", String(args["gpu-platform"]));
    if (args["gpu-device"]) minerArgs.push("--device-index", String(args["gpu-device"]));

    const child = spawn(GPU_MINER, minerArgs, { windowsHide: true });

    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const idx = buffer.indexOf("\n");
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          log("warn", "gpu miner emitted non-json line", { line });
          continue;
        }
        if (message.type === "progress") {
          const hashes = BigInt(message.hashes || "0");
          const seconds = Math.max(1, (Date.now() - started) / 1000);
          const rate = Number(hashes) / seconds;
          state.mining = {
            challenge_id: challenge.challenge_id,
            nonce: message.nonce,
            hashes: hashes.toString(),
            difficulty_bits: difficulty,
            workers: workerCount,
            engine: "gpu",
            gpu_batch_size: message.batch_size,
            gpu_local_size: message.local_size,
            gpu_device: message.device,
          };
          saveState(stateFile, state);
          log("info", "mining", {
            hashes: hashes.toString(),
            nonce: message.nonce,
            workers: workerCount,
            engine: "gpu",
            device: message.device,
            batch_size: message.batch_size,
            local_size: message.local_size,
            speed: `${(rate / 1_000_000).toFixed(2)} MH/s`,
          });
        }
        if (message.type === "found") {
          settled = true;
          const hashes = BigInt(message.hashes || "0");
          const seconds = Math.max(0.001, (Date.now() - started) / 1000);
          const rate = Number(hashes) / seconds;
          state.mining = {
            ...state.mining,
            nonce: message.solution_nonce,
            hashes: message.hashes,
            found_at: new Date().toISOString(),
            workers: workerCount,
            engine: "gpu",
            gpu_batch_size: message.batch_size,
            gpu_local_size: message.local_size,
            gpu_device: message.device,
          };
          saveState(stateFile, state);
          resolve({
            solution_nonce: message.solution_nonce,
            hashes: message.hashes,
            digest: message.digest,
            speed: `${(rate / 1_000_000).toFixed(2)} MH/s`,
            elapsed_ms: Date.now() - started,
          });
        }
        if (message.type === "expired") {
          settled = true;
          const err = new Error("challenge expired before a solution was found");
          err.code = "CHALLENGE_EXPIRED";
          err.retryable = true;
          reject(err);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (settled) return;
      if (code === 0) return;
      reject(new Error(`gpu miner exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function promptLine(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(label, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  globalThis.__RPOW_VERBOSE__ = args.verbose === true;
  const command = args._[0] || "help";
  const discovered = discoverFromIndex(args.index || DEFAULT_INDEX);
  const envSite = process.env.RPOW_SITE;
  const envApi  = process.env.RPOW_API;
  const resolvedSite = args.site || envSite || DEFAULT_SITE_ORIGIN;
  const resolvedApi  = args.api  || envApi  || discovered.apiOrigin;
  registerCustomOrigins(resolvedSite, resolvedApi);
  TURNSTILE_SITE_URL = resolvedSite;
  const client = new RpowClient({
    apiOrigin: resolvedApi,
    siteOrigin: resolvedSite,
    stateFile: args.state || DEFAULT_STATE,
    timeoutMs: args.timeout || 45000,
    retries: args.retries || 5,
  });

  if (command === "map") {
    printApiMap(discovered);
    return;
  }

  if (command === "login") {
    const email = args.email || await promptLine("email: ");
    let body = { email };
    const captchaKey = args["captcha-key"] || process.env.YESCAPTCHA_KEY;
    if (captchaKey) {
      // Only solve Turnstile if:
      // 1. User explicitly set RPOW_TURNSTILE_KEY, OR
      // 2. We successfully detected a site key from the page HTML
      let shouldSolve = false;
      if (process.env.RPOW_TURNSTILE_KEY) {
        shouldSolve = true;
        log("info", "using Turnstile site key from RPOW_TURNSTILE_KEY env");
      } else {
        const detected = await fetchTurnstileSiteKey(resolvedSite);
        if (detected) {
          TURNSTILE_SITE_KEY = detected;
          log("info", "using detected Turnstile site key");
        } else {
          log("info", "no site key detected on page, will try with default key");
        }
        shouldSolve = true;
      }
      if (shouldSolve) {
        const token = await solveTurnstile(captchaKey);
        body.turnstile_token = token;
      }
    }
    await client.api("POST", "/auth/request", body);
    client.state.email = email;
    client.state.login_requested_at = new Date().toISOString();
    client.save();
    log("success", "magic link requested; run complete-login with the emailed URL");
    return;
  }

  if (command === "complete-login") {
    const link = args.link || await promptLine("magic link: ");
    await client.followMagicLink(link);
    const me = await client.api("GET", "/me");
    log("success", "session active", me);
    return;
  }

  if (command === "cookie-login") {
    const cookieInput = args.cookie
      || await promptLine("paste rpow_session cookie (or full Set-Cookie / Cookie header): ");
    const sessionCookie = normalizeCookieInput(cookieInput);
    // validate by calling /me with the cookie injected directly
    const tmpClient = new RpowClient({
      apiOrigin: client.apiOrigin,
      siteOrigin: client.siteOrigin,
      stateFile: client.stateFile,
      timeoutMs: client.timeoutMs,
      maxRetries: client.maxRetries,
    });
    tmpClient.state.cookies = { rpow_session: sessionCookie };
    const me = await tmpClient.api("GET", "/me");
    client.state.cookies = { rpow_session: sessionCookie };
    client.save();
    log("success", "cookie login complete", { email: me.email });
    return;
  }

  if (command === "me") {
    const me = await client.api("GET", "/me");
    const display = {
      email: me.email,
      balance: me.balance_base_units !== undefined ? formatBaseUnits(me.balance_base_units) : String(me.balance),
      minted:  me.minted_base_units  !== undefined ? formatBaseUnits(me.minted_base_units)  : String(me.minted),
      sent:    me.sent_base_units    !== undefined ? formatBaseUnits(me.sent_base_units)    : String(me.sent),
      received:me.received_base_units!== undefined ? formatBaseUnits(me.received_base_units): String(me.received),
    };
    if (me.wrap_allowed !== undefined) display.wrap_allowed = me.wrap_allowed;
    if (me.solana_wallet)              display.solana_wallet = me.solana_wallet;
    if (me.srpow_supply_owned_base_units !== undefined)
      display.wrapped = formatBaseUnits(me.srpow_supply_owned_base_units);
    log("info", "me", display);
    return;
  }

  if (command === "ledger") {
    const l = await client.api("GET", "/ledger", undefined, { allowUnauthorized: true });
    const display = {
      total_minted:       l.total_minted_base_units       !== undefined ? formatBaseUnits(l.total_minted_base_units)       : String(l.total_minted),
      total_transferred:  l.total_transferred_base_units  !== undefined ? formatBaseUnits(l.total_transferred_base_units)  : String(l.total_transferred),
      circulating_supply: l.circulating_supply_base_units !== undefined ? formatBaseUnits(l.circulating_supply_base_units) : String(l.circulating_supply),
      difficulty_bits:    l.current_difficulty_bits,
      user_count:         l.user_count,
    };
    if (l.current_reward_base_units !== undefined)  display.current_reward   = formatBaseUnits(l.current_reward_base_units);
    if (l.next_reward_base_units    !== undefined)  display.next_reward      = formatBaseUnits(l.next_reward_base_units);
    if (l.next_halving_at_base_units!== undefined)  display.next_halving_at  = formatBaseUnits(l.next_halving_at_base_units);
    if (l.base_units_to_next_halving!== undefined)  display.to_next_halving  = formatBaseUnits(l.base_units_to_next_halving);
    if (l.halving_index             !== undefined)  display.halving_index    = l.halving_index;
    if (l.is_capped                 !== undefined)  display.is_capped        = l.is_capped;
    if (l.max_supply_base_units     !== undefined)  display.max_supply       = formatBaseUnits(l.max_supply_base_units);
    log("info", "ledger", display);
    return;
  }

  if (command === "activity") {
    const items = await client.api("GET", "/activity");
    if (!Array.isArray(items) || items.length === 0) {
      log("info", "activity", "(no activity yet)");
      return;
    }
    for (const item of items) {
      const amountDisplay = item.amount_base_units !== undefined
        ? formatBaseUnits(item.amount_base_units)
        : String(item.amount);
      const sign = item.type === "send" ? "-" : "+";
      log("info", "activity", {
        at: item.at,
        type: item.type,
        amount: `${sign}${amountDisplay}`,
        counterparty: item.counterparty_email || "",
      });
    }
    return;
  }

  if (command === "send") {
    const recipient = args.to || await promptLine("recipient email: ");
    const amountInput = args.amount || await promptLine("amount (e.g. 1.5): ");
    const amount_base_units = parseRpowToBaseUnits(amountInput);
    // also include legacy integer field when the amount is a whole number
    const legacySuffix = "000000000";
    const legacyWhole = amount_base_units.endsWith(legacySuffix)
      ? amount_base_units.slice(0, -legacySuffix.length)
      : null;
    const body = { recipient_email: recipient, amount_base_units, idempotency_key: args.idempotency || crypto.randomUUID() };
    if (legacyWhole !== null) body.amount = Number(legacyWhole);
    const result = await client.api("POST", "/send", body);
    const transferred = result.transferred_base_units !== undefined
      ? formatBaseUnits(result.transferred_base_units)
      : String(result.transferred);
    log("success", "send result", {
      ok: result.ok,
      transferred,
      recipient_email: result.recipient_email,
      transfer_id: result.transfer_id,
      pending: result.pending || false,
    });
    return;
  }

  if (command === "logout") {
    await client.api("POST", "/auth/logout");
    client.state.cookies = {};
    client.save();
    log("success", "logged out");
    return;
  }

  if (command === "mine" || command === "run") {
    const target = Number(args.count || args.tokens || 1);
    const workers = Number(args.workers || defaultWorkerCount());
    const engine = args.engine || (fs.existsSync(NATIVE_MINER) ? "native" : "node");
    const logEveryMs = Number(args["log-every-ms"] || (["native", "gpu"].includes(engine) ? 1000 : 5000));
    if (!Number.isInteger(workers) || workers < 1) throw new Error("--workers must be a positive integer");
    if (!["native", "node", "gpu"].includes(engine)) throw new Error("--engine must be native, gpu or node");
    let minted = 0;
    let consecutiveRecoverableFailures = 0;
    while (true) {
      try {
        await client.api("GET", "/me");
        consecutiveRecoverableFailures = 0;
        break;
      } catch (err) {
        if (err.code === "UNAUTHORIZED" || !isRecoverableMineError(err)) throw err;
        consecutiveRecoverableFailures += 1;
        const delay = mineRetryDelayMs(consecutiveRecoverableFailures, err);
        log("warn", `temporary /me failure; continuing in ${delay}ms`, {
          failures: consecutiveRecoverableFailures,
          status: err.status,
          code: errorCode(err),
          error: err.message,
        });
        await sleep(delay);
      }
    }
    while (minted < target) {
      let challenge = client.state.challenge;
      const challengeExpiresAt = challenge?.expires_at ? Date.parse(challenge.expires_at) : null;
      const challengeExpired = Number.isFinite(challengeExpiresAt) && Date.now() >= challengeExpiresAt - 5000;
      if (!challenge || challengeExpired || client.state.mining?.challenge_id !== challenge.challenge_id || args.fresh) {
        if (challengeExpired) log("warn", "saved challenge expired; requesting a fresh one", { challenge_id: challenge.challenge_id });
        try {
          challenge = await client.api("POST", "/challenge");
          consecutiveRecoverableFailures = 0;
        } catch (err) {
          if (err.code === "UNAUTHORIZED" || !isRecoverableMineError(err)) throw err;
          consecutiveRecoverableFailures += 1;
          const delay = mineRetryDelayMs(consecutiveRecoverableFailures, err);
          log("warn", `temporary challenge failure; continuing in ${delay}ms`, {
            failures: consecutiveRecoverableFailures,
            minted,
            target,
            remaining: Math.max(0, target - minted),
            status: err.status,
            code: errorCode(err),
            error: err.message,
          });
          await sleep(delay);
          continue;
        }
        client.state.challenge = challenge;
        client.state.mining = { challenge_id: challenge.challenge_id, nonce: "0", hashes: "0", difficulty_bits: challenge.difficulty_bits };
        client.save();
      }
      log("info", "challenge", {
        id: challenge.challenge_id,
        difficulty: `${challenge.difficulty_bits} bits`,
        expires: challenge.expires_at,
      });
      let solution;
      try {
        log("info", "miner config", { workers, engine });
        solution = engine === "native"
          ? await mineSolutionNative(challenge, client.state, client.stateFile, logEveryMs, workers)
          : engine === "gpu"
            ? await mineSolutionGpu(challenge, client.state, client.stateFile, logEveryMs, workers, args)
            : await mineSolutionParallel(challenge, client.state, client.stateFile, logEveryMs, workers);
      } catch (err) {
        if (err.code === "CHALLENGE_EXPIRED") {
          log("warn", "challenge expired during mining; requesting a fresh one");
          client.state.challenge = null;
          client.state.mining = null;
          client.save();
          continue;
        }
        throw err;
      }
      log("info", "solution found", {
        nonce: solution.solution_nonce,
        hashes: solution.hashes,
        speed: solution.speed,
        elapsed_ms: solution.elapsed_ms,
      });
      try {
        const result = await client.api("POST", "/mint", {
          challenge_id: challenge.challenge_id,
          solution_nonce: solution.solution_nonce,
        }, { noRetryStatuses: [504], timeoutMs: 5000 });
        minted += 1;
        consecutiveRecoverableFailures = 0;
        client.state.last_mint = result;
        client.state.challenge = null;
        client.state.mining = null;
        client.save();
        log("success", "mint/claim accepted", result);
        log("success", "mint progress", { minted, target, remaining: Math.max(0, target - minted) });
        if (minted < target) {
          const delay = postMintDelayMs();
          log("info", "post-mint cooldown", { delay_ms: delay });
          await sleep(delay);
        }
      } catch (err) {
        if (err.code === "UNAUTHORIZED") {
          log("warn", "session invalid; rerun login/complete-login, then rerun mine to resume");
          throw err;
        }
        // 504 on /mint means server received the request but timed out responding.
        // The mint likely processed server-side. Don't retry (avoids duplicate), just continue.
        if (err.status === 504 || err.name === "AbortError") {
          consecutiveRecoverableFailures = 0;
          log("warn", "mint request timed out (server may have processed it); starting next challenge immediately", {
            error: err.message,
            status: err.status,
          });
          client.state.challenge = null;
          client.state.mining = null;
          client.save();
          continue;
        }
        if (isRecoverableMineError(err)) {
          consecutiveRecoverableFailures += 1;
          const delay = mineRetryDelayMs(consecutiveRecoverableFailures, err);
          log("warn", `temporary mint failure; dropping challenge and continuing in ${delay}ms`, {
            failures: consecutiveRecoverableFailures,
            minted,
            target,
            remaining: Math.max(0, target - minted),
            error: err.message,
            code: errorCode(err),
            status: err.status,
          });
          client.state.challenge = null;
          client.state.mining = null;
          client.save();
          await sleep(delay);
          continue;
        }
        log("warn", "mint failed; dropping challenge and continuing with a fresh one", { error: err.message, code: err.code, status: err.status });
        client.state.challenge = null;
        client.state.mining = null;
        client.save();
      }
    }
    log("success", "pipeline complete", { minted, target, remaining: Math.max(0, target - minted) });
    return;
  }

  console.log(`Usage:
  node rpow-cli.js map
  node rpow-cli.js login --email you@example.com
  node rpow-cli.js complete-login --link "https://..."
  node rpow-cli.js me
  node rpow-cli.js mine --count 1
  node rpow-cli.js run --count 3
  node rpow-cli.js send --to user@example.com --amount 1
  node rpow-cli.js ledger
  node rpow-cli.js activity
  node rpow-cli.js logout

Options:
  --state .rpow-cli-state.json
  --timeout 20000
  --retries 5
  --log-every-ms 5000
  --workers ${defaultWorkerCount()}
  --engine native|gpu|node
  --gpu-batch 1048576
  --gpu-local-size 256
  --gpu-platform 0
  --gpu-device 0
  --verbose`);
}

main().catch((err) => {
  log("error", err.message, { code: err.code, status: err.status });
  process.exitCode = 1;
});
