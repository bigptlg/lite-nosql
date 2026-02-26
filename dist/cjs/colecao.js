'use strict';

const fs = require('fs');
const path = require('path');
const { gerarId, clonar, aplicarUpdate, corresponde, getNested } = require('./utils');
const { comLock } = require('./lock');
const { walAppend, walLer, walZerar, walTamanho } = require('./wal');
const { snapshotCarregar, snapshotSalvar } = require('./snapshot');
const { GerenciadorIndices } = require('./indices');

const LIMITE_WAL_PADRAO = 5 * 1024 * 1024; // 5 MB

class Colecao {
  constructor(nome, pasta, opcoes = {}) {
    this.nome = nome;
    this._pasta = pasta;
    this._modoDuravel = opcoes.modoDuravel !== false;
    this._limiteWAL = opcoes.limiteWAL || LIMITE_WAL_PADRAO;
    this._debug = opcoes.debug || false;
    this._serializar = opcoes.serializar || null;

    this._snapshotPath = path.join(pasta, `${nome}.snapshot.json`);
    this._walPath = path.join(pasta, `${nome}.wal.log`);
    this._lockPath = path.join(pasta, `${nome}.lock`);

    /** @type {Map<string, object>} */
    this._docs = new Map();
    this._version = 0;
    this._carregado = false;

    const indicesCampos = (opcoes.indices || []).filter(c => c !== '_id');
    this._indices = new GerenciadorIndices(indicesCampos);

    // Serialised write queue — ensures sequential writes
    this._filaEscrita = Promise.resolve();
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  _log(...args) {
    if (this._debug) console.log(`[lite-nosql:${this.nome}]`, ...args);
  }

  async _garantirCarregado() {
    if (!this._carregado) await this._carregar();
  }

  async _carregar() {
    const snap = snapshotCarregar(this._snapshotPath, this._serializar);
    if (snap) {
      this._docs = snap.docs;
      this._version = snap.version;
      this._log(`snapshot carregado — ${this._docs.size} docs, v${this._version}`);
    }

    const entradas = walLer(this._walPath, this._serializar);
    this._log(`reaplicando ${entradas.length} entradas WAL`);
    for (const entrada of entradas) {
      this._aplicarEntradaWAL(entrada);
    }

    this._indices.reconstruir(this._docs);
    this._carregado = true;
  }

  _aplicarEntradaWAL(entrada) {
    switch (entrada.op) {
      case 'insert': {
        this._docs.set(entrada.id, entrada.doc);
        this._version++;
        break;
      }
      case 'update': {
        const doc = this._docs.get(entrada.id);
        if (!doc) break;
        aplicarUpdate(doc, {
          $set: entrada.set,
          $unset: entrada.unset,
          $inc: entrada.inc
        });
        if (entrada.updatedAt) doc.updatedAt = entrada.updatedAt;
        this._version++;
        break;
      }
      case 'delete': {
        this._docs.delete(entrada.id);
        this._version++;
        break;
      }
    }
  }

  /** Enqueue a write operation so writes are always sequential */
  _enfileirarEscrita(fn) {
    this._filaEscrita = this._filaEscrita.then(() => fn()).catch(err => {
      // re-throw so the caller's promise rejects
      throw err;
    });
    return this._filaEscrita;
  }

  async _compactarSeNecessario() {
    const tamanho = walTamanho(this._walPath);
    if (tamanho < this._limiteWAL) return;
    this._log(`WAL atingiu ${tamanho} bytes — a tentar compactar`);

    // comLock garante exclusividade entre processos.
    // Dentro do lock re-verificamos: outro processo pode ter compactado
    // entretanto, tornando a nossa cópia em memória desactualizada.
    await comLock(this._lockPath, async () => {
      // ── Re-check: did another process already compact? ──────────────────
      const tamanhoAgora = walTamanho(this._walPath);
      if (tamanhoAgora < this._limiteWAL) {
        this._log('outro processo já compactou — a recarregar estado');
        // Reload: reset in-memory state and replay the fresh snapshot+WAL
        this._docs    = new Map();
        this._version = 0;
        this._carregado = false;
        await this._carregar();
        return;
      }

      // ── This process wins — do the compaction ───────────────────────────
      snapshotSalvar(
        this._snapshotPath,
        this._docs,
        this._version,
        this._modoDuravel,
        this._serializar
      );
      walZerar(this._walPath);
      this._log('compactação concluída');
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Insert a document. Adds _id, createdAt, updatedAt if missing.
   * @returns {Promise<string>} the _id of the inserted document
   */
  async inserir(doc) {
    await this._garantirCarregado();
    return this._enfileirarEscrita(async () => {
      const agora = new Date().toISOString();
      const novo = clonar(doc);
      if (!novo._id) novo._id = gerarId();
      if (!novo.createdAt) novo.createdAt = agora;
      novo.updatedAt = agora;

      const entrada = {
        op: 'insert',
        ts: Date.now(),
        id: novo._id,
        doc: novo
      };

      await walAppend(this._walPath, entrada, this._modoDuravel, this._serializar);
      this._docs.set(novo._id, novo);
      this._indices.aoInserir(novo._id, novo);
      this._version++;

      await this._compactarSeNecessario();
      return novo._id;
    });
  }

  /**
   * Find documents matching a filter.
   * @param {object} [filtro]
   * @param {object} [opcoes] - limite, saltar, ordenarPor, ordem ('asc'|'desc')
   * @returns {Promise<object[]>}
   */
  async buscar(filtro = {}, opcoes = {}) {
    await this._garantirCarregado();
    const { limite, saltar = 0, ordenarPor, ordem = 'asc' } = opcoes;

    let candidatoIds = null;

    // _id shortcut
    if (filtro._id) {
      const doc = this._docs.get(filtro._id);
      const resultado = doc && corresponde(doc, filtro) ? [clonar(doc)] : [];
      return resultado;
    }

    // index-assisted lookup
    const idxCandidatos = this._indices.candidatos(filtro);
    if (idxCandidatos !== null) {
      candidatoIds = idxCandidatos;
    } else if (Object.keys(filtro).length > 0) {
      this._log('aviso: varredura completa (nenhum índice para o filtro)', Object.keys(filtro));
    }

    let resultados = [];
    const fonte = candidatoIds
      ? Array.from(candidatoIds).map(id => this._docs.get(id)).filter(Boolean)
      : Array.from(this._docs.values());

    for (const doc of fonte) {
      if (corresponde(doc, filtro)) {
        resultados.push(clonar(doc));
      }
    }

    // sort
    if (ordenarPor) {
      const dir = ordem === 'desc' ? -1 : 1;
      resultados.sort((a, b) => {
        const va = getNested(a, ordenarPor);
        const vb = getNested(b, ordenarPor);
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }

    if (saltar) resultados = resultados.slice(saltar);
    if (limite) resultados = resultados.slice(0, limite);

    return resultados;
  }

  /**
   * Find the first document matching a filter, or null.
   * @param {object} filtro
   * @returns {Promise<object|null>}
   */
  async buscarUm(filtro = {}) {
    const res = await this.buscar(filtro, { limite: 1 });
    return res[0] || null;
  }

  /**
   * Update the first document matching the filter.
   * Supports $set, $unset, $inc.
   * @returns {Promise<boolean>} true if a document was found and updated
   */
  async actualizarUm(filtro, update) {
    await this._garantirCarregado();
    const doc = await this.buscarUm(filtro);
    if (!doc) return false;

    return this._enfileirarEscrita(async () => {
      // re-fetch to get latest in-memory state
      const docAtual = this._docs.get(doc._id);
      if (!docAtual) return false;

      const agora = new Date().toISOString();
      const entrada = {
        op: 'update',
        ts: Date.now(),
        id: docAtual._id,
        set: update.$set || {},
        unset: update.$unset
          ? (Array.isArray(update.$unset) ? update.$unset : Object.keys(update.$unset))
          : [],
        inc: update.$inc || {},
        updatedAt: agora
      };

      await walAppend(this._walPath, entrada, this._modoDuravel, this._serializar);

      const docAntigo = clonar(docAtual);
      aplicarUpdate(docAtual, update);
      docAtual.updatedAt = agora;
      this._indices.aoAtualizar(docAtual._id, docAntigo, docAtual);
      this._version++;

      await this._compactarSeNecessario();
      return true;
    });
  }

  /**
   * Remove the first document matching the filter.
   * @returns {Promise<boolean>} true if a document was removed
   */
  async removerUm(filtro) {
    await this._garantirCarregado();
    const doc = await this.buscarUm(filtro);
    if (!doc) return false;

    return this._enfileirarEscrita(async () => {
      const docAtual = this._docs.get(doc._id);
      if (!docAtual) return false;

      const entrada = {
        op: 'delete',
        ts: Date.now(),
        id: docAtual._id
      };

      await walAppend(this._walPath, entrada, this._modoDuravel, this._serializar);
      this._indices.aoRemover(docAtual._id, docAtual);
      this._docs.delete(docAtual._id);
      this._version++;

      await this._compactarSeNecessario();
      return true;
    });
  }

  /**
   * Count documents matching a filter.
   * @param {object} [filtro]
   * @returns {Promise<number>}
   */
  async contar(filtro = {}) {
    await this._garantirCarregado();
    if (Object.keys(filtro).length === 0) return this._docs.size;
    const res = await this.buscar(filtro);
    return res.length;
  }

  /**
   * Force compaction now (snapshot + WAL truncation).
   * Safe to call from multiple processes simultaneously — only one will
   * actually compact; the others reload from the freshly written snapshot.
   */
  async compactar() {
    await this._garantirCarregado();
    return this._enfileirarEscrita(async () => {
      await comLock(this._lockPath, async () => {
        // Another process might have already compacted — check WAL age
        const snapExistia = require('fs').existsSync(this._snapshotPath);
        const walAtual    = walTamanho(this._walPath);

        // If WAL is already empty and snapshot exists, someone beat us to it
        if (snapExistia && walAtual === 0) {
          this._log('compactação manual: outro processo já compactou — a recarregar');
          this._docs    = new Map();
          this._version = 0;
          this._carregado = false;
          await this._carregar();
          return;
        }

        snapshotSalvar(
          this._snapshotPath,
          this._docs,
          this._version,
          this._modoDuravel,
          this._serializar
        );
        walZerar(this._walPath);
        this._log('compactação manual concluída');
      });
    });
  }
}

module.exports = { Colecao };
