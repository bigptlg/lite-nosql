'use strict';

const fs = require('fs');
const { sleep } = require('./utils');

// ── Configuração ──────────────────────────────────────────────────────────
const DEFAULT_TENTATIVAS  = 80;
const DEFAULT_BACKOFF_MIN = 10;   // ms
const DEFAULT_BACKOFF_MAX = 60;   // ms
const TTL_LOCK_MS         = 10_000; // lock considerado stale após 10 s

// ── Helpers de PID ────────────────────────────────────────────────────────

/**
 * Check whether a PID is currently alive on this machine.
 * Uses kill(pid, 0) which sends no signal but validates existence.
 * Returns false for PIDs from other machines (always considered dead).
 */
function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM → process exists but we can't signal it (still alive)
    // ESRCH → process does not exist
    return err.code === 'EPERM';
  }
}

// ── Formato do ficheiro de lock ───────────────────────────────────────────
// Uma única linha JSON:  {"pid":1234,"ts":1700000000000,"host":"hostname"}

function lerConteudoLock(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function escreverConteudoLock(lockPath) {
  const conteudo = JSON.stringify({
    pid:  process.pid,
    ts:   Date.now(),
    host: (process.env.HOSTNAME || require('os').hostname()).slice(0, 64),
  });
  fs.writeFileSync(lockPath, conteudo, 'utf8');
}

// ── Detecção de lock stale ────────────────────────────────────────────────

/**
 * Returns true if the existing lock file should be forcibly removed because:
 *   1. It has no parseable content (corrupt), OR
 *   2. It is older than TTL_LOCK_MS, OR
 *   3. The PID recorded belongs to this host AND the process is no longer alive.
 */
function lockEstaStale(lockPath) {
  const conteudo = lerConteudoLock(lockPath);

  // Corrupt or empty lock → stale
  if (!conteudo || !conteudo.pid || !conteudo.ts) return true;

  // Too old regardless of PID → stale
  if (Date.now() - conteudo.ts > TTL_LOCK_MS) return true;

  // Same host: check if the PID is still alive
  const hostnameAtual = (process.env.HOSTNAME || require('os').hostname()).slice(0, 64);
  if (conteudo.host === hostnameAtual && !pidVivo(conteudo.pid)) return true;

  return false;
}

// ── Núcleo do lock ────────────────────────────────────────────────────────

/**
 * Acquire a file lock.
 *
 * Strategy:
 *   1. Try O_EXCL open (atomic, fails if file exists).
 *   2. If EEXIST, check if the existing lock is stale — remove it and retry.
 *   3. Otherwise wait with random jitter and retry up to `tentativas` times.
 *
 * @param {string} lockPath
 * @param {object} [opcoes]
 * @param {number} [opcoes.tentativas]
 * @param {number} [opcoes.backoffMin]
 * @param {number} [opcoes.backoffMax]
 */
async function adquirirLock(lockPath, opcoes = {}) {
  const tentativas  = opcoes.tentativas  || DEFAULT_TENTATIVAS;
  const backoffMin  = opcoes.backoffMin  || DEFAULT_BACKOFF_MIN;
  const backoffMax  = opcoes.backoffMax  || DEFAULT_BACKOFF_MAX;

  for (let i = 0; i < tentativas; i++) {
    // ── attempt exclusive create ──────────────────────────────────────────
    try {
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
      );
      // Write PID + timestamp immediately so other processes can inspect it
      try {
        fs.writeSync(fd, JSON.stringify({
          pid:  process.pid,
          ts:   Date.now(),
          host: (process.env.HOSTNAME || require('os').hostname()).slice(0, 64),
        }));
      } finally {
        fs.closeSync(fd);
      }
      return; // lock acquired ✓
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }

    // ── lock file exists — inspect it ────────────────────────────────────
    if (lockEstaStale(lockPath)) {
      try {
        fs.unlinkSync(lockPath);
        // Loop back immediately to try creating the lock again
        continue;
      } catch (unlinkErr) {
        // Another process removed it first — that's fine, loop and retry
        if (unlinkErr.code !== 'ENOENT') throw unlinkErr;
      }
    }

    // ── healthy lock held by another process — back off ───────────────────
    const wait = backoffMin + Math.random() * (backoffMax - backoffMin);
    await sleep(Math.floor(wait));
  }

  throw new Error(
    `lite-nosql: não foi possível adquirir lock após ${tentativas} tentativas: ${lockPath}`
  );
}

/**
 * Release a file lock — only removes it if it still belongs to this process.
 */
function liberarLock(lockPath) {
  try {
    const conteudo = lerConteudoLock(lockPath);
    // Only remove if this is our own lock (guard against stale removal race)
    if (conteudo && conteudo.pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Run fn while holding the file lock; always releases in a finally block.
 * Safe for multi-process use: stale locks are detected and recycled.
 */
async function comLock(lockPath, fn, opcoes) {
  await adquirirLock(lockPath, opcoes);
  try {
    return await fn();
  } finally {
    liberarLock(lockPath);
  }
}

module.exports = { adquirirLock, liberarLock, comLock, lockEstaStale, pidVivo };
