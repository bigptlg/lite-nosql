'use strict';

/**
 * lite-nosql test suite — Node.js built-in test runner (node --test)
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { abrirBanco } = require('../dist/cjs/index.js');

// ── helpers ───────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lite-nosql-test-'));
}

function limpar(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── basic CRUD ─────────────────────────────────────────────────────────────

describe('CRUD básico', () => {
  let db, pasta;

  before(async () => {
    pasta = tmpDir();
    db = await abrirBanco({ pasta, modoDuravel: false });
  });

  after(async () => {
    await db.fechar();
    limpar(pasta);
  });

  test('inserir e buscarUm', async () => {
    const users = db.colecao('users');
    const id = await users.inserir({ nome: 'Ana', email: 'ana@x.com' });
    assert.ok(typeof id === 'string' && id.length > 0, 'deve retornar um id string');

    const doc = await users.buscarUm({ _id: id });
    assert.ok(doc !== null, 'deve encontrar o documento');
    assert.equal(doc.nome, 'Ana');
    assert.equal(doc._id, id);
    assert.ok(doc.createdAt, 'deve ter createdAt');
    assert.ok(doc.updatedAt, 'deve ter updatedAt');
  });

  test('buscar com filtro', async () => {
    const items = db.colecao('items');
    await items.inserir({ categoria: 'A', valor: 10 });
    await items.inserir({ categoria: 'B', valor: 20 });
    await items.inserir({ categoria: 'A', valor: 30 });

    const resultados = await items.buscar({ categoria: 'A' });
    assert.equal(resultados.length, 2);
  });

  test('buscar com ordenação e limite', async () => {
    const num = db.colecao('num');
    for (let i = 5; i >= 1; i--) await num.inserir({ n: i });

    const asc = await num.buscar({}, { ordenarPor: 'n', ordem: 'asc' });
    assert.deepEqual(asc.map(d => d.n), [1, 2, 3, 4, 5]);

    const top2 = await num.buscar({}, { ordenarPor: 'n', ordem: 'desc', limite: 2 });
    assert.deepEqual(top2.map(d => d.n), [5, 4]);
  });

  test('actualizarUm com $set', async () => {
    const col = db.colecao('upd');
    const id = await col.inserir({ nome: 'Bob', idade: 20 });
    const ok = await col.actualizarUm({ _id: id }, { $set: { nome: 'Bobby', cidade: 'Lisboa' } });
    assert.ok(ok);
    const doc = await col.buscarUm({ _id: id });
    assert.equal(doc.nome, 'Bobby');
    assert.equal(doc.cidade, 'Lisboa');
    assert.equal(doc.idade, 20);
  });

  test('actualizarUm com $inc', async () => {
    const col = db.colecao('inc');
    const id = await col.inserir({ contador: 0 });
    await col.actualizarUm({ _id: id }, { $inc: { contador: 5 } });
    await col.actualizarUm({ _id: id }, { $inc: { contador: 3 } });
    const doc = await col.buscarUm({ _id: id });
    assert.equal(doc.contador, 8);
  });

  test('actualizarUm com $unset', async () => {
    const col = db.colecao('unset');
    const id = await col.inserir({ a: 1, b: 2, c: 3 });
    await col.actualizarUm({ _id: id }, { $unset: ['b'] });
    const doc = await col.buscarUm({ _id: id });
    assert.equal(doc.a, 1);
    assert.equal(doc.b, undefined);
    assert.equal(doc.c, 3);
  });

  test('removerUm', async () => {
    const col = db.colecao('del');
    const id = await col.inserir({ x: 1 });
    const ok = await col.removerUm({ _id: id });
    assert.ok(ok);
    const doc = await col.buscarUm({ _id: id });
    assert.equal(doc, null);
  });

  test('contar', async () => {
    const col = db.colecao('cnt');
    assert.equal(await col.contar(), 0);
    await col.inserir({ t: 1 });
    await col.inserir({ t: 2 });
    await col.inserir({ t: 3 });
    assert.equal(await col.contar(), 3);
    assert.equal(await col.contar({ t: 2 }), 1);
  });

  test('actualizarUm retorna false quando não encontrado', async () => {
    const col = db.colecao('notfound');
    const ok = await col.actualizarUm({ _id: 'inexistente' }, { $set: { x: 1 } });
    assert.equal(ok, false);
  });

  test('removerUm retorna false quando não encontrado', async () => {
    const col = db.colecao('notfound2');
    const ok = await col.removerUm({ _id: 'inexistente' });
    assert.equal(ok, false);
  });

  test('operadores de comparação no filtro', async () => {
    const col = db.colecao('ops');
    await col.inserir({ n: 1 });
    await col.inserir({ n: 5 });
    await col.inserir({ n: 10 });

    const gt3 = await col.buscar({ n: { $gt: 3 } });
    assert.equal(gt3.length, 2);

    const lte5 = await col.buscar({ n: { $lte: 5 } });
    assert.equal(lte5.length, 2);

    const ne5 = await col.buscar({ n: { $ne: 5 } });
    assert.equal(ne5.length, 2);

    const inList = await col.buscar({ n: { $in: [1, 10] } });
    assert.equal(inList.length, 2);
  });
});

// ── durabilidade / recovery ────────────────────────────────────────────────

describe('Recovery após simulação de crash', () => {
  test('reaplicar WAL após fechar sem compactar', async () => {
    const pasta = tmpDir();
    try {
      // Session 1 — write some docs
      const db1 = await abrirBanco({ pasta, modoDuravel: false });
      const col1 = db1.colecao('crash');
      await col1.inserir({ nome: 'Doc1' });
      await col1.inserir({ nome: 'Doc2' });
      await col1.inserir({ nome: 'Doc3' });
      // Close without compaction
      await db1.fechar();

      // Simulate crash: keep WAL but remove snapshot
      const snapPath = path.join(pasta, 'crash.snapshot.json');
      if (fs.existsSync(snapPath)) fs.unlinkSync(snapPath);

      // Session 2 — must recover from WAL alone
      const db2 = await abrirBanco({ pasta, modoDuravel: false });
      const col2 = db2.colecao('crash');
      const total = await col2.contar();
      assert.equal(total, 3, 'deve recuperar 3 documentos do WAL');
      const doc = await col2.buscarUm({ nome: 'Doc2' });
      assert.ok(doc, 'deve encontrar Doc2');
      await db2.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('reaplicar snapshot + WAL parcial', async () => {
    const pasta = tmpDir();
    try {
      const db1 = await abrirBanco({ pasta, modoDuravel: false });
      const col1 = db1.colecao('partial');
      await col1.inserir({ n: 1 });
      await col1.inserir({ n: 2 });
      // Force compaction so snapshot has 2 docs
      await col1.compactar();
      // Write 2 more docs (only in WAL)
      await col1.inserir({ n: 3 });
      await col1.inserir({ n: 4 });
      await db1.fechar();

      // Re-open — must load snapshot (2 docs) + WAL (2 more)
      const db2 = await abrirBanco({ pasta, modoDuravel: false });
      const col2 = db2.colecao('partial');
      assert.equal(await col2.contar(), 4);
      await db2.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('WAL com linha corrompida é ignorada', async () => {
    const pasta = tmpDir();
    try {
      const db1 = await abrirBanco({ pasta, modoDuravel: false });
      const col1 = db1.colecao('corrupt');
      await col1.inserir({ ok: true });
      await db1.fechar();

      // Inject corrupt line in WAL
      const walPath = path.join(pasta, 'corrupt.wal.log');
      fs.appendFileSync(walPath, '{"op":"insert","ts":0,"id":"bad"CORRUPT\n');

      const db2 = await abrirBanco({ pasta, modoDuravel: false });
      const col2 = db2.colecao('corrupt');
      // Should still have the valid doc
      assert.equal(await col2.contar(), 1);
      await db2.fechar();
    } finally {
      limpar(pasta);
    }
  });
});

// ── compactação ────────────────────────────────────────────────────────────

describe('Compactação', () => {
  test('compactação manual cria snapshot e zera WAL', async () => {
    const pasta = tmpDir();
    try {
      const db = await abrirBanco({ pasta, modoDuravel: false });
      const col = db.colecao('comp');
      for (let i = 0; i < 10; i++) await col.inserir({ i });
      await col.compactar();

      const walPath = path.join(pasta, 'comp.wal.log');
      const snapPath = path.join(pasta, 'comp.snapshot.json');
      assert.ok(fs.existsSync(snapPath), 'snapshot deve existir');
      const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
      assert.equal(walSize, 0, 'WAL deve estar vazio após compactação');

      // Data must still be readable
      assert.equal(await col.contar(), 10);
      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('compactação automática quando WAL ultrapassa limite', async () => {
    const pasta = tmpDir();
    try {
      // Very small WAL limit (1 byte) to trigger compaction on every write
      const db = await abrirBanco({ pasta, modoDuravel: false, limiteWAL: 1 });
      const col = db.colecao('autocomp');
      for (let i = 0; i < 5; i++) await col.inserir({ i, dados: 'x'.repeat(100) });

      const walPath = path.join(pasta, 'autocomp.wal.log');
      const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
      // After last insert, WAL should have been compacted
      assert.ok(walSize < 500, 'WAL deve estar pequeno após compactação automática');
      assert.equal(await col.contar(), 5);
      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });
});

// ── concorrência ───────────────────────────────────────────────────────────

describe('Concorrência', () => {
  test('múltiplos inserts paralelos não corrompem dados', async () => {
    const pasta = tmpDir();
    try {
      const db = await abrirBanco({ pasta, modoDuravel: false });
      const col = db.colecao('para');
      const N = 50;
      const ids = await Promise.all(
        Array.from({ length: N }, (_, i) => col.inserir({ indice: i }))
      );
      assert.equal(ids.length, N);
      assert.equal(new Set(ids).size, N, 'todos os IDs devem ser únicos');
      assert.equal(await col.contar(), N);
      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('updates paralelos no mesmo documento preservam consistência', async () => {
    const pasta = tmpDir();
    try {
      const db = await abrirBanco({ pasta, modoDuravel: false });
      const col = db.colecao('upd_para');
      const id = await col.inserir({ contador: 0 });

      // 20 concurrent increments
      await Promise.all(
        Array.from({ length: 20 }, () =>
          col.actualizarUm({ _id: id }, { $inc: { contador: 1 } })
        )
      );

      const doc = await col.buscarUm({ _id: id });
      assert.equal(doc.contador, 20, 'contador deve ser 20');
      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });
});

// ── índices ────────────────────────────────────────────────────────────────

describe('Índices', () => {
  test('lookup por campo indexado', async () => {
    const pasta = tmpDir();
    try {
      const db = await abrirBanco({ pasta, modoDuravel: false });
      const col = db.colecao('idx', { indices: ['email'] });
      await col.inserir({ email: 'a@a.com', nome: 'Alice' });
      await col.inserir({ email: 'b@b.com', nome: 'Bob' });
      await col.inserir({ email: 'a@a.com', nome: 'Alice2' });

      const res = await col.buscar({ email: 'a@a.com' });
      assert.equal(res.length, 2);
      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('índice é actualizado após update e remove', async () => {
    const pasta = tmpDir();
    try {
      const db = await abrirBanco({ pasta, modoDuravel: false });
      const col = db.colecao('idx2', { indices: ['status'] });
      const id = await col.inserir({ status: 'activo' });
      await col.inserir({ status: 'activo' });

      let res = await col.buscar({ status: 'activo' });
      assert.equal(res.length, 2);

      await col.actualizarUm({ _id: id }, { $set: { status: 'inactivo' } });
      res = await col.buscar({ status: 'activo' });
      assert.equal(res.length, 1);

      await col.removerUm({ _id: id });
      res = await col.buscar({ status: 'inactivo' });
      assert.equal(res.length, 0);
      await db.fechar();
    } finally {
      limpar(pasta);
    }
  });
});

// ── custom serializer ──────────────────────────────────────────────────────

describe('Serializer personalizado', () => {
  test('custom serializer é usado para snapshot', async () => {
    const pasta = tmpDir();
    let serCalls = 0;
    let deserCalls = 0;
    const meuSerializer = {
      serializar: (v) => { serCalls++; return JSON.stringify(v); },
      deserializar: (s) => { deserCalls++; return JSON.parse(s); }
    };
    try {
      const db = await abrirBanco({ pasta, modoDuravel: false, serializar: meuSerializer });
      const col = db.colecao('ser');
      await col.inserir({ x: 1 });
      await col.compactar(); // triggers serializar
      assert.ok(serCalls > 0, 'serializar deve ter sido chamado');
      await db.fechar();

      // Re-open triggers deserializar
      const db2 = await abrirBanco({ pasta, modoDuravel: false, serializar: meuSerializer });
      const col2 = db2.colecao('ser');
      await col2.contar(); // force load
      assert.ok(deserCalls > 0, 'deserializar deve ter sido chamado');
      await db2.fechar();
    } finally {
      limpar(pasta);
    }
  });
});
