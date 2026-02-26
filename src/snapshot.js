'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load a snapshot file. Returns { docs: Map, version: number } or null if not found.
 */
function snapshotCarregar(snapshotPath, serializar) {
  if (!fs.existsSync(snapshotPath)) return null;
  try {
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    const data = serializar ? serializar.deserializar(raw) : JSON.parse(raw);
    // data.docs is an array of [id, doc] pairs
    const docs = new Map(data.docs || []);
    return { docs, version: data.version || 0 };
  } catch (err) {
    throw new Error(`lite-nosql: erro ao ler snapshot ${snapshotPath}: ${err.message}`);
  }
}

/**
 * Write a new snapshot atomically:
 * 1. Write to a temp file
 * 2. fsync the temp file
 * 3. Rename (atomic on POSIX)
 */
function snapshotSalvar(snapshotPath, docs, version, modoDuravel, serializar) {
  const data = {
    version,
    ts: Date.now(),
    docs: Array.from(docs.entries())
  };
  const raw = serializar ? serializar.serializar(data) : JSON.stringify(data);
  const tmpPath = snapshotPath + '.tmp';
  fs.writeFileSync(tmpPath, raw, 'utf8');
  if (modoDuravel) {
    const fd = fs.openSync(tmpPath, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  fs.renameSync(tmpPath, snapshotPath);
}

module.exports = { snapshotCarregar, snapshotSalvar };
