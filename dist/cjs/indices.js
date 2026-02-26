'use strict';

const { getNested } = require('./utils');

/**
 * Encode a value into a type-prefixed string key so that values of different
 * types never collide in the index map.
 *
 * Prefixes:
 *   n: — number   (e.g. n:1, n:-3.14)
 *   s: — string   (e.g. s:1, s:hello)
 *   b: — boolean  (e.g. b:true)
 *   N: — null
 *   _: — everything else (serialised as JSON, unlikely but safe)
 *
 * This means the number 1 → "n:1" and the string "1" → "s:1",
 * so they never share the same bucket.
 */
function chaveIndice(val) {
  switch (typeof val) {
    case 'number':  return `n:${val}`;
    case 'string':  return `s:${val}`;
    case 'boolean': return `b:${val}`;
    default:
      if (val === null) return 'N:';
      return `_:${JSON.stringify(val)}`;
  }
}

/**
 * In-memory index manager.
 * Each index is a Map<chaveIndice(value), Set<docId>>.
 */
class GerenciadorIndices {
  constructor(campos) {
    /** @type {string[]} */
    this.campos = campos || [];
    /** @type {Map<string, Map<string, Set<string>>>} */
    this._indices = new Map();
    for (const campo of this.campos) {
      this._indices.set(campo, new Map());
    }
  }

  /** Rebuild all indices from scratch given a docs Map */
  reconstruir(docs) {
    for (const campo of this.campos) {
      this._indices.set(campo, new Map());
    }
    for (const [id, doc] of docs) {
      this._indexarDoc(id, doc);
    }
  }

  /** Index a single document */
  _indexarDoc(id, doc) {
    for (const campo of this.campos) {
      const val = getNested(doc, campo);
      if (val === undefined) continue;
      const chave = chaveIndice(val);
      const idx = this._indices.get(campo);
      if (!idx.has(chave)) idx.set(chave, new Set());
      idx.get(chave).add(id);
    }
  }

  /** Remove a document from all indices */
  _desindexarDoc(id, doc) {
    for (const campo of this.campos) {
      const val = getNested(doc, campo);
      if (val === undefined) continue;
      const chave = chaveIndice(val);
      const idx = this._indices.get(campo);
      if (idx && idx.has(chave)) {
        idx.get(chave).delete(id);
        if (idx.get(chave).size === 0) idx.delete(chave);
      }
    }
  }

  /** Called when a document is inserted */
  aoInserir(id, doc) {
    this._indexarDoc(id, doc);
  }

  /** Called when a document is updated (old doc → new doc) */
  aoAtualizar(id, docAntigo, docNovo) {
    this._desindexarDoc(id, docAntigo);
    this._indexarDoc(id, docNovo);
  }

  /** Called when a document is removed */
  aoRemover(id, doc) {
    this._desindexarDoc(id, doc);
  }

  /**
   * Given a filter, return a Set of candidate IDs if an index is usable,
   * or null if full scan is needed.
   * Uses chaveIndice() for the lookup so type-prefix matches exactly.
   */
  candidatos(filtro) {
    if (!filtro || Object.keys(filtro).length === 0) return null;
    for (const [campo, val] of Object.entries(filtro)) {
      if (campo === '_id') continue;
      if (!this._indices.has(campo)) continue;
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        const idx = this._indices.get(campo);
        const chave = chaveIndice(val);
        return idx.has(chave) ? new Set(idx.get(chave)) : new Set();
      }
    }
    return null;
  }
}

module.exports = { GerenciadorIndices, chaveIndice };
