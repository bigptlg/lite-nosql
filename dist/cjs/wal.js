'use strict';

const fs = require('fs');

/**
 * Append a WAL entry (one line) to the log file.
 * If serializar._encriptado is true, each line is encrypted individually.
 * If modoDuravel is true, syncs before resolving.
 */
async function walAppend(walPath, entrada, modoDuravel, serializar) {
  let linha;
  if (serializar && serializar._encriptado) {
    linha = serializar.serializar(entrada) + '\n';
  } else {
    linha = JSON.stringify(entrada) + '\n';
  }

  const fd = fs.openSync(walPath, 'a');
  try {
    fs.writeSync(fd, linha);
    if (modoDuravel) fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read and parse all WAL entries from the log file.
 * Handles both plain JSON lines and encrypted lines transparently.
 * Corrupt/partial lines are silently skipped (crash safety).
 */
function walLer(walPath, serializar) {
  if (!fs.existsSync(walPath)) return [];
  const conteudo = fs.readFileSync(walPath, 'utf8');
  const entradas = [];
  for (const linha of conteudo.split('\n')) {
    const l = linha.trim();
    if (!l) continue;
    try {
      if (serializar && serializar._encriptado) {
        entradas.push(serializar.deserializar(l));
      } else {
        entradas.push(JSON.parse(l));
      }
    } catch {
      // linha corrompida ou parcialmente escrita — ignorar
    }
  }
  return entradas;
}

/**
 * Truncate (zero out) the WAL file — called after snapshot compaction.
 */
function walZerar(walPath) {
  fs.writeFileSync(walPath, '', 'utf8');
}

/**
 * Return the current WAL file size in bytes, or 0 if it doesn't exist.
 */
function walTamanho(walPath) {
  try { return fs.statSync(walPath).size; } catch { return 0; }
}

module.exports = { walAppend, walLer, walZerar, walTamanho };
