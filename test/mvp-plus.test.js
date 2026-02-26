'use strict';

/**
 * Testes MVP+ — os três pontos melhorados:
 *   1. Colisão de tipos no índice
 *   2. Lock stale (processo morto)
 *   3. Compactação multi-processo limpa
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

const { abrirBanco }              = require('../dist/cjs/index.js');
const { chaveIndice }             = require('../dist/cjs/indices.js');
const { lockEstaStale, pidVivo }  = require('../dist/cjs/lock.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lite-nosql-mvp-')); }
function limpar(d) { fs.rmSync(d, { recursive: true, force: true }); }

// ═══════════════════════════════════════════════════════════════════════════
// 1. ÍNDICE — colisão de tipos
// ═══════════════════════════════════════════════════════════════════════════

describe('Índice — sem colisão de tipos', () => {

  test('chaveIndice gera prefixos distintos por tipo', () => {
    // O número 1 e a string "1" devem produzir chaves diferentes
    assert.notEqual(chaveIndice(1),    chaveIndice('1'),    'number vs string');
    assert.notEqual(chaveIndice(0),    chaveIndice(false),  'number 0 vs boolean false');
    assert.notEqual(chaveIndice(''),   chaveIndice(null),   'empty string vs null');
    assert.notEqual(chaveIndice(true), chaveIndice('true'), 'boolean vs string');
    assert.notEqual(chaveIndice(null), chaveIndice(0),      'null vs 0');

    // Mesmos valores, mesmo tipo → mesma chave
    assert.equal(chaveIndice(42),    chaveIndice(42));
    assert.equal(chaveIndice('abc'), chaveIndice('abc'));
    assert.equal(chaveIndice(true),  chaveIndice(true));
    assert.equal(chaveIndice(null),  chaveIndice(null));
  });

  test('filtrar por número não devolve documentos com valor string igual', async () => {
    const pasta = tmpDir();
    try {
      const db = await abrirBanco({ pasta, modoDuravel: false });
      const col = db.colecao('tipos', { indices: ['codigo'] });

      await col.inserir({ codigo: 1,   tipo: 'number' });   // número 1
      await col.inserir({ codigo: '1', tipo: 'string' });   // string "1"
      await col.inserir({ codigo: 1,   tipo: 'number2' });  // outro número 1

      // Filtrar pelo número 1 — deve devolver apenas os dois numéricos
      const numeros = await col.buscar({ codigo: 1 });
      assert.equal(numeros.length, 2, 'deve devolver 2 documentos com código numérico 1');
      assert.ok(numeros.every(d => typeof d.codigo === 'number'), 'todos devem ser do tipo number');

      // Filtrar pela string "1" — deve devolver apenas o string
      const strings = await col.buscar({ codigo: '1' });
      assert.equal(strings.length, 1, 'deve devolver 1 documento com código string "1"');
      assert.equal(typeof strings[0].codigo, 'string');

      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('boolean false não colide com número 0', async () => {
    const pasta = tmpDir();
    try {
      const db  = await abrirBanco({ pasta, modoDuravel: false });
      const col = db.colecao('bools', { indices: ['val'] });

      await col.inserir({ val: false, tipo: 'boolean' });
      await col.inserir({ val: 0,     tipo: 'number'  });
      await col.inserir({ val: '',    tipo: 'string'  });

      const falsy = await col.buscar({ val: false });
      assert.equal(falsy.length, 1);
      assert.equal(falsy[0].tipo, 'boolean');

      const zero = await col.buscar({ val: 0 });
      assert.equal(zero.length, 1);
      assert.equal(zero[0].tipo, 'number');

      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('índice é consistente após update que muda o tipo do campo', async () => {
    const pasta = tmpDir();
    try {
      const db  = await abrirBanco({ pasta, modoDuravel: false });
      const col = db.colecao('tipoUpdate', { indices: ['v'] });

      const id = await col.inserir({ v: 10 });           // número
      await col.actualizarUm({ _id: id }, { $set: { v: '10' } }); // muda para string

      const nums = await col.buscar({ v: 10 });
      assert.equal(nums.length, 0, 'não deve encontrar mais pelo número 10');

      const strs = await col.buscar({ v: '10' });
      assert.equal(strs.length, 1, 'deve encontrar pela string "10"');

      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LOCK — stale detection
// ═══════════════════════════════════════════════════════════════════════════

describe('Lock — detecção de stale', () => {

  test('lock sem conteúdo JSON é considerado stale', () => {
    const pasta = tmpDir();
    const lockPath = path.join(pasta, 'test.lock');
    try {
      fs.writeFileSync(lockPath, '', 'utf8');
      assert.ok(lockEstaStale(lockPath), 'lock vazio deve ser stale');
    } finally {
      limpar(pasta);
    }
  });

  test('lock com JSON inválido é considerado stale', () => {
    const pasta = tmpDir();
    const lockPath = path.join(pasta, 'test.lock');
    try {
      fs.writeFileSync(lockPath, 'INVALID{JSON', 'utf8');
      assert.ok(lockEstaStale(lockPath), 'lock com JSON inválido deve ser stale');
    } finally {
      limpar(pasta);
    }
  });

  test('lock mais antigo que TTL é considerado stale', () => {
    const pasta = tmpDir();
    const lockPath = path.join(pasta, 'test.lock');
    try {
      const conteudo = JSON.stringify({
        pid:  process.pid,
        ts:   Date.now() - 30_000,  // 30 segundos atrás (> TTL de 10 s)
        host: os.hostname(),
      });
      fs.writeFileSync(lockPath, conteudo, 'utf8');
      assert.ok(lockEstaStale(lockPath), 'lock antigo deve ser stale');
    } finally {
      limpar(pasta);
    }
  });

  test('lock com PID inexistente no mesmo host é considerado stale', () => {
    const pasta = tmpDir();
    const lockPath = path.join(pasta, 'test.lock');
    try {
      // PID 999999999 quase certamente não existe
      const conteudo = JSON.stringify({
        pid:  999_999_999,
        ts:   Date.now(),
        host: os.hostname(),
      });
      fs.writeFileSync(lockPath, conteudo, 'utf8');
      assert.ok(lockEstaStale(lockPath), 'lock de PID morto deve ser stale');
    } finally {
      limpar(pasta);
    }
  });

  test('lock do próprio processo activo NÃO é considerado stale', () => {
    const pasta = tmpDir();
    const lockPath = path.join(pasta, 'test.lock');
    try {
      const conteudo = JSON.stringify({
        pid:  process.pid,  // este processo está vivo
        ts:   Date.now(),
        host: os.hostname(),
      });
      fs.writeFileSync(lockPath, conteudo, 'utf8');
      assert.ok(!lockEstaStale(lockPath), 'lock do próprio processo não deve ser stale');
    } finally {
      limpar(pasta);
    }
  });

  test('pidVivo detecta processo vivo e morto', () => {
    // Este processo está vivo
    assert.ok(pidVivo(process.pid), 'o processo actual deve estar vivo');
    // PID 0 não é válido
    assert.ok(!pidVivo(0), 'PID 0 não deve estar vivo');
    // PID absurdamente grande provavelmente não existe
    assert.ok(!pidVivo(999_999_999), 'PID inexistente não deve estar vivo');
  });

  test('lock stale é removido e substituído automaticamente ao adquirir', async () => {
    const pasta = tmpDir();
    const lockPath = path.join(pasta, 'col.lock');
    try {
      // Criar um lock stale manualmente (PID morto, timestamp recente)
      fs.writeFileSync(lockPath, JSON.stringify({
        pid:  999_999_999,
        ts:   Date.now(),
        host: os.hostname(),
      }), 'utf8');

      // Abrir banco e forçar uma operação que use o lock (compactar)
      const db = await abrirBanco({ pasta, modoDuravel: false });
      const col = db.colecao('col');
      await col.inserir({ x: 1 });
      // compactar usa comLock — deve remover o lock stale e prosseguir
      await col.compactar();
      assert.equal(await col.contar(), 1, 'dados devem estar intactos após limpar lock stale');
      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. COMPACTAÇÃO — multi-processo (simulado)
// ═══════════════════════════════════════════════════════════════════════════

describe('Compactação — segurança multi-processo', () => {

  test('compactar() paralelo dentro do mesmo processo não corrompe dados', async () => {
    const pasta = tmpDir();
    try {
      const db  = await abrirBanco({ pasta, modoDuravel: false, limiteWAL: 1 });
      const col = db.colecao('multi');

      // Inserir docs com limite WAL mínimo para forçar compactações automáticas,
      // ao mesmo tempo que chamamos compactar() manualmente em paralelo
      await Promise.all([
        ...Array.from({ length: 10 }, (_, i) => col.inserir({ i })),
        col.compactar(),
        col.compactar(),
      ]);

      const total = await col.contar();
      assert.equal(total, 10, 'todos os 10 documentos devem existir após compactações paralelas');
      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('segunda instância do banco recarrega estado após compactação da primeira', async () => {
    const pasta = tmpDir();
    try {
      // Instância A — escreve e compacta
      const dbA  = await abrirBanco({ pasta, modoDuravel: false });
      const colA = dbA.colecao('shared');
      await colA.inserir({ fonte: 'A', n: 1 });
      await colA.inserir({ fonte: 'A', n: 2 });
      await colA.compactar(); // escreve snapshot, zera WAL
      await dbA.fechar();

      // Instância B — abre depois, deve ver os dados da instância A
      const dbB  = await abrirBanco({ pasta, modoDuravel: false });
      const colB = dbB.colecao('shared');
      assert.equal(await colB.contar(), 2, 'instância B deve ver 2 documentos da instância A');

      // Instância B escreve mais e compacta
      await colB.inserir({ fonte: 'B', n: 3 });
      await colB.compactar();
      await dbB.fechar();

      // Instância C — deve ver os 3 documentos
      const dbC  = await abrirBanco({ pasta, modoDuravel: false });
      const colC = dbC.colecao('shared');
      assert.equal(await colC.contar(), 3, 'instância C deve ver 3 documentos');
      await dbC.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('WAL é zerado correctamente após compactação — não duplica documentos', async () => {
    const pasta = tmpDir();
    try {
      const db  = await abrirBanco({ pasta, modoDuravel: false });
      const col = db.colecao('nodup');

      for (let i = 0; i < 5; i++) await col.inserir({ i });
      await col.compactar();     // snapshot tem 5 docs, WAL zerado

      for (let i = 5; i < 8; i++) await col.inserir({ i });
      // Reabrir — deve carregar snapshot (5) + WAL (3) = 8, sem duplicados
      await db.fechar();

      const db2  = await abrirBanco({ pasta, modoDuravel: false });
      const col2 = db2.colecao('nodup');
      assert.equal(await col2.contar(), 8, 'deve haver exactamente 8 documentos, sem duplicados');
      await db2.fechar();
    } finally {
      limpar(pasta);
    }
  });
});
