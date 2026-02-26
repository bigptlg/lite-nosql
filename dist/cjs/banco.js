'use strict';

const fs = require('fs');
const path = require('path');
const { Colecao } = require('./colecao');
const { criarSerializerEncriptado } = require('./encriptacao');

/**
 * @typedef {object} OpcoesBanco
 * @property {string}  pasta               - Directory where collection files are stored
 * @property {boolean} [modoDuravel=true]  - If true, fsync on every write
 * @property {number}  [limiteWAL]         - WAL size in bytes before compaction (default 5 MB)
 * @property {boolean} [debug=false]
 * @property {string}  [chaveEncriptacao]  - Password for AES-256-GCM encryption (recommended)
 * @property {{ serializar: (v:any)=>string, deserializar: (s:string)=>any }} [serializar]
 */

class Banco {
  /**
   * @param {OpcoesBanco} opcoes
   */
  constructor(opcoes) {
    this._opcoes = opcoes;
    this._pasta = opcoes.pasta;
    /** @type {Map<string, Colecao>} */
    this._colecoes = new Map();
  }

  /**
   * Get (or create) a collection by name.
   * @param {string} nome
   * @param {{ indices?: string[] }} [opcoes]
   * @returns {Colecao}
   */
  colecao(nome, opcoes = {}) {
    if (!this._colecoes.has(nome)) {
      const col = new Colecao(nome, this._pasta, {
        ...this._opcoes,
        ...opcoes
      });
      this._colecoes.set(nome, col);
    }
    return this._colecoes.get(nome);
  }

  /**
   * Close the database. Flushes pending writes.
   */
  async fechar() {
    for (const col of this._colecoes.values()) {
      // Wait for any pending writes to drain
      await col._filaEscrita;
    }
    this._colecoes.clear();
  }
}

/**
 * Open a lite-nosql database.
 * @param {OpcoesBanco} opcoes
 * @returns {Promise<Banco>}
 */
async function abrirBanco(opcoes) {
  if (!opcoes || !opcoes.pasta) {
    throw new Error('lite-nosql: a opção "pasta" é obrigatória');
  }

  // Ensure the directory exists
  fs.mkdirSync(opcoes.pasta, { recursive: true });

  // Apply restrictive permissions to the data folder (owner read/write/execute only)
  // This protects against other users on the same shared hosting server
  try {
    fs.chmodSync(opcoes.pasta, 0o700);
  } catch {
    // Some environments don't support chmod — not fatal
  }

  // Build the final options, resolving encryption
  const opcoesFinais = {
    modoDuravel: true,
    debug: false,
    ...opcoes,
  };

  // chaveEncriptacao takes priority over a manually provided serializar
  if (opcoes.chaveEncriptacao) {
    if (typeof opcoes.chaveEncriptacao !== 'string' || opcoes.chaveEncriptacao.length < 8) {
      throw new Error(
        'lite-nosql: chaveEncriptacao deve ser uma string com pelo menos 8 caracteres'
      );
    }
    opcoesFinais.serializar = criarSerializerEncriptado(
      opcoes.chaveEncriptacao,
      opcoes.pasta
    );
    if (opcoesFinais.debug) {
      console.log('[lite-nosql] encriptação AES-256-GCM activada');
    }
  }

  const banco = new Banco(opcoesFinais);
  return banco;
}

module.exports = { abrirBanco, Banco, Colecao };
