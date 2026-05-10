"use strict";

const crypto = require("crypto");
const { parentPort, workerData } = require("worker_threads");

function hexToBytes(hex) {
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

const prefix = hexToBytes(workerData.noncePrefix);
const difficulty = Number(workerData.difficultyBits);
const stride = BigInt(workerData.stride);
const cutoffAt = workerData.cutoffAt || null;
let nonce = BigInt(workerData.startNonce);
let hashes = 0n;
let lastProgress = Date.now();

while (true) {
  if (cutoffAt && Date.now() >= cutoffAt) {
    parentPort.postMessage({ type: "expired", hashes: hashes.toString(), nonce: nonce.toString() });
    process.exit(0);
  }

  const digest = crypto.createHash("sha256").update(prefix).update(nonceLe64(nonce)).digest();
  if (trailingZeroBits(digest) >= difficulty) {
    parentPort.postMessage({
      type: "found",
      solution_nonce: nonce.toString(),
      hashes: hashes.toString(),
      digest: digest.toString("hex"),
    });
    process.exit(0);
  }

  nonce += stride;
  hashes += 1n;

  const now = Date.now();
  if (now - lastProgress >= workerData.progressEveryMs) {
    parentPort.postMessage({ type: "progress", hashes: hashes.toString(), nonce: nonce.toString() });
    lastProgress = now;
  }
}
