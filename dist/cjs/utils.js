'use strict';

const crypto = require('crypto');

/**
 * Generate a sortable unique ID: timestamp (ms) + random hex
 */
function gerarId() {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rand = crypto.randomBytes(6).toString('hex');
  return `${ts}${rand}`;
}

/**
 * Deep clone a plain object via JSON (sufficient for document storage)
 */
function clonar(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Sleep for ms milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Apply a WAL update operation ($set, $unset, $inc) to a document in place
 */
function aplicarUpdate(doc, update) {
  if (update.$set) {
    for (const [k, v] of Object.entries(update.$set)) {
      setNested(doc, k, v);
    }
  }
  if (update.$unset) {
    const keys = Array.isArray(update.$unset) ? update.$unset : Object.keys(update.$unset);
    for (const k of keys) {
      unsetNested(doc, k);
    }
  }
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) {
      const current = getNested(doc, k) || 0;
      setNested(doc, k, current + v);
    }
  }
  return doc;
}

function setNested(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetNested(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

function getNested(obj, path) {
  return path.split('.').reduce((cur, p) => (cur == null ? undefined : cur[p]), obj);
}

/**
 * Match a document against a filter object (supports dot-notation, $gt, $gte, $lt, $lte, $ne, $in, $nin, $regex)
 */
function corresponde(doc, filtro) {
  if (!filtro || Object.keys(filtro).length === 0) return true;
  for (const [key, val] of Object.entries(filtro)) {
    const docVal = getNested(doc, key);
    if (!testarValor(docVal, val)) return false;
  }
  return true;
}

function testarValor(docVal, expected) {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    // operator object
    for (const [op, operand] of Object.entries(expected)) {
      switch (op) {
        case '$gt':  if (!(docVal > operand)) return false; break;
        case '$gte': if (!(docVal >= operand)) return false; break;
        case '$lt':  if (!(docVal < operand)) return false; break;
        case '$lte': if (!(docVal <= operand)) return false; break;
        case '$ne':  if (docVal === operand) return false; break;
        case '$in':  if (!Array.isArray(operand) || !operand.includes(docVal)) return false; break;
        case '$nin': if (!Array.isArray(operand) || operand.includes(docVal)) return false; break;
        case '$regex': {
          const re = operand instanceof RegExp ? operand : new RegExp(operand);
          if (!re.test(docVal)) return false;
          break;
        }
        default: if (docVal !== operand) return false;
      }
    }
    return true;
  }
  // direct equality (including arrays via JSON)
  if (Array.isArray(expected)) return JSON.stringify(docVal) === JSON.stringify(expected);
  return docVal === expected;
}

module.exports = { gerarId, clonar, sleep, aplicarUpdate, corresponde, getNested };
