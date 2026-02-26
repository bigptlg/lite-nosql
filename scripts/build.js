#!/usr/bin/env node
'use strict';

/**
 * Minimal build script — no bundler required.
 * Produces:
 *   dist/cjs/   — CommonJS (just copies src with require wrappers)
 *   dist/esm/   — ES Module wrappers
 *   dist/types/ — TypeScript declarations
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC  = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

// ── helpers ───────────────────────────────────────────────────────────────

function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function write(p, s) { fs.writeFileSync(p, s, 'utf8'); }
function copy(src, dst) { fs.copyFileSync(src, dst); }

// ── CJS build ─────────────────────────────────────────────────────────────
// For CJS we simply copy the src files (they already use require/module.exports)

mkdir(path.join(DIST, 'cjs'));
for (const file of fs.readdirSync(SRC)) {
  if (file.endsWith('.js')) {
    copy(path.join(SRC, file), path.join(DIST, 'cjs', file));
  }
}
write(path.join(DIST, 'cjs', 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));

// ── ESM build ─────────────────────────────────────────────────────────────
// Wrap each CJS module in an ES module re-export

mkdir(path.join(DIST, 'esm'));

// Only the public surface needs an ESM wrapper; internals are accessed via CJS loader
const esmIndex = `// Auto-generated ESM wrapper
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const _m = require('../cjs/index.js');
export const abrirBanco = _m.abrirBanco;
export const Banco = _m.Banco;
export const Colecao = _m.Colecao;
export default _m;
`;
write(path.join(DIST, 'esm', 'index.js'), esmIndex);
write(path.join(DIST, 'esm', 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

// ── TypeScript declarations ────────────────────────────────────────────────

mkdir(path.join(DIST, 'types'));

const dts = `// Type declarations for lite-nosql

export interface OpcoesBanco {
  /** Directory where collection files are stored */
  pasta: string;
  /** If true (default), fsync on every write for crash safety */
  modoDuravel?: boolean;
  /** WAL size threshold in bytes before compaction (default: 5242880 = 5 MB) */
  limiteWAL?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom serializer */
  serializar?: {
    serializar: (value: unknown) => string;
    deserializar: (raw: string) => unknown;
  };
}

export interface OpcoesColecao {
  /** Fields to create indexes on (besides _id) */
  indices?: string[];
}

export interface OpcoesBusca {
  /** Max documents to return */
  limite?: number;
  /** Number of documents to skip */
  saltar?: number;
  /** Field name to sort by */
  ordenarPor?: string;
  /** Sort direction (default: 'asc') */
  ordem?: 'asc' | 'desc';
}

export type Filtro = Record<string, unknown>;

export type Update = {
  $set?: Record<string, unknown>;
  $unset?: Record<string, unknown> | string[];
  $inc?: Record<string, number>;
};

export interface Documento {
  _id: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export declare class Colecao {
  readonly nome: string;
  inserir(doc: Record<string, unknown>): Promise<string>;
  buscar(filtro?: Filtro, opcoes?: OpcoesBusca): Promise<Documento[]>;
  buscarUm(filtro?: Filtro): Promise<Documento | null>;
  actualizarUm(filtro: Filtro, update: Update): Promise<boolean>;
  removerUm(filtro: Filtro): Promise<boolean>;
  contar(filtro?: Filtro): Promise<number>;
  compactar(): Promise<void>;
}

export declare class Banco {
  colecao(nome: string, opcoes?: OpcoesColecao): Colecao;
  fechar(): Promise<void>;
}

export declare function abrirBanco(opcoes: OpcoesBanco): Promise<Banco>;
`;

write(path.join(DIST, 'types', 'index.d.ts'), dts);

console.log('✅ Build concluído:');
console.log('   dist/cjs/   — CommonJS');
console.log('   dist/esm/   — ES Module');
console.log('   dist/types/ — TypeScript declarations');
