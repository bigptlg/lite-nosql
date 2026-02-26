'use strict';

/**
 * Testes de encriptação — lite-nosql
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { abrirBanco } = require('../dist/cjs/index.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lite-nosql-enc-'));
}
function limpar(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── Encriptação activada via chaveEncriptacao ──────────────────────────────

describe('Encriptação AES-256-GCM', () => {

  test('ficheiros em disco são ilegíveis sem a chave', async () => {
    const pasta = tmpDir();
    try {
      const db = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'senha-super-secreta-123',
      });
      const col = db.colecao('segredo');
      await col.inserir({ dados: 'informação confidencial', cc: '1234-5678' });
      await col.compactar();
      await db.fechar();

      // Ler o snapshot directamente como texto
      const snapPath = path.join(pasta, 'segredo.snapshot.json');
      const conteudoBruto = fs.readFileSync(snapPath, 'utf8');

      // O texto "informação confidencial" NÃO deve aparecer em claro
      assert.ok(
        !conteudoBruto.includes('informação confidencial'),
        'dados sensíveis não devem aparecer em texto claro no snapshot'
      );
      assert.ok(
        !conteudoBruto.includes('1234-5678'),
        'número de cartão não deve aparecer em texto claro'
      );

      // O WAL também deve estar encriptado
      const walPath = path.join(pasta, 'segredo.wal.log');
      // Pode já estar vazio após compactar — testar com nova escrita
      await abrirBanco({ pasta, modoDuravel: false, chaveEncriptacao: 'senha-super-secreta-123' })
        .then(async db2 => {
          const col2 = db2.colecao('segredo');
          await col2.inserir({ novo: 'dado secreto' });
          await db2.fechar();
        });

      const walConteudo = fs.readFileSync(walPath, 'utf8');
      assert.ok(
        !walConteudo.includes('dado secreto'),
        'dados no WAL também não devem aparecer em texto claro'
      );
    } finally {
      limpar(pasta);
    }
  });

  test('dados são recuperáveis com a chave correcta', async () => {
    const pasta = tmpDir();
    try {
      // Sessão 1 — escrever
      const db1 = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'minha-chave-segura-abc',
      });
      const col1 = db1.colecao('users');
      const id = await col1.inserir({ nome: 'Ana', email: 'ana@x.com' });
      await db1.fechar();

      // Sessão 2 — ler com a mesma chave
      const db2 = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'minha-chave-segura-abc',
      });
      const col2 = db2.colecao('users');
      const doc = await col2.buscarUm({ _id: id });
      assert.ok(doc !== null, 'deve encontrar o documento');
      assert.equal(doc.nome, 'Ana');
      assert.equal(doc.email, 'ana@x.com');
      await db2.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('chave errada lança erro ao desencriptar', async () => {
    const pasta = tmpDir();
    try {
      // Escrever com chave A
      const db1 = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'chave-original-xyz',
      });
      const col1 = db1.colecao('dados');
      await col1.inserir({ x: 1 });
      await col1.compactar(); // forçar snapshot encriptado
      await db1.fechar();

      // Tentar abrir com chave B — deve falhar ao ler
      const db2 = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'chave-errada-000',
      });
      const col2 = db2.colecao('dados');

      await assert.rejects(
        () => col2.contar(), // força carregamento
        /desencriptar|adulterado|incorrecta/,
        'deve lançar erro com chave incorrecta'
      );
      await db2.fechar().catch(() => {});
    } finally {
      limpar(pasta);
    }
  });

  test('recovery do WAL encriptado após crash simulado', async () => {
    const pasta = tmpDir();
    try {
      const db1 = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'chave-recovery-test',
      });
      const col1 = db1.colecao('crash');
      await col1.inserir({ n: 1 });
      await col1.inserir({ n: 2 });
      await col1.inserir({ n: 3 });
      // Fechar sem compactar — dados só no WAL
      await db1.fechar();

      // Remover snapshot para simular crash antes de compactar
      const snapPath = path.join(pasta, 'crash.snapshot.json');
      if (fs.existsSync(snapPath)) fs.unlinkSync(snapPath);

      // Re-abrir — deve recuperar 3 docs do WAL encriptado
      const db2 = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'chave-recovery-test',
      });
      const col2 = db2.colecao('crash');
      assert.equal(await col2.contar(), 3, 'deve recuperar 3 docs do WAL encriptado');
      await db2.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('pasta de dados recebe permissão 700 automaticamente', async () => {
    const pasta = tmpDir();
    try {
      await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'qualquer-chave-ok',
      });
      const stat = fs.statSync(pasta);
      // Em sistemas POSIX, verificar que outros utilizadores não têm acesso
      // mode & 0o077 == 0 significa que grupo e outros não têm permissões
      const permissoesOutros = stat.mode & 0o077;
      assert.equal(
        permissoesOutros,
        0,
        `a pasta deve ter permissão 700 (sem acesso de grupo/outros), actual: ${(stat.mode & 0o777).toString(8)}`
      );
    } finally {
      limpar(pasta);
    }
  });

  test('chaveEncriptacao muito curta lança erro imediato', async () => {
    const pasta = tmpDir();
    try {
      await assert.rejects(
        () => abrirBanco({ pasta, chaveEncriptacao: 'curta' }),
        /pelo menos 8 caracteres/
      );
    } finally {
      limpar(pasta);
    }
  });

  test('operações CRUD completas funcionam com encriptação', async () => {
    const pasta = tmpDir();
    try {
      const db = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'crud-test-password-ok',
      });
      const col = db.colecao('crud_enc', { indices: ['status'] });

      // inserir
      const id1 = await col.inserir({ nome: 'Alpha', status: 'activo', pontos: 10 });
      const id2 = await col.inserir({ nome: 'Beta',  status: 'activo', pontos: 5  });
      const id3 = await col.inserir({ nome: 'Gamma', status: 'inactivo', pontos: 0 });

      // buscar
      assert.equal(await col.contar(), 3);
      const activos = await col.buscar({ status: 'activo' });
      assert.equal(activos.length, 2);

      // actualizar
      await col.actualizarUm({ _id: id1 }, { $inc: { pontos: 5 }, $set: { nivel: 'gold' } });
      const alpha = await col.buscarUm({ _id: id1 });
      assert.equal(alpha.pontos, 15);
      assert.equal(alpha.nivel, 'gold');

      // remover
      await col.removerUm({ _id: id3 });
      assert.equal(await col.contar(), 2);

      // compactar e verificar persistência
      await col.compactar();
      await db.fechar();

      // reabrir e verificar
      const db2 = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'crud-test-password-ok',
      });
      const col2 = db2.colecao('crud_enc', { indices: ['status'] });
      assert.equal(await col2.contar(), 2);
      const alphaRecuperado = await col2.buscarUm({ _id: id1 });
      assert.equal(alphaRecuperado.pontos, 15);
      await db2.fechar();
    } finally {
      limpar(pasta);
    }
  });

  test('salt é persistido e chave é consistente entre sessões', async () => {
    const pasta = tmpDir();
    try {
      // O salt deve ser criado na primeira abertura
      const db1 = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'teste-consistencia',
      });
      await db1.fechar();
      const saltPath = path.join(pasta, '.db.salt');
      assert.ok(fs.existsSync(saltPath), 'ficheiro .db.salt deve existir');
      const salt1 = fs.readFileSync(saltPath, 'utf8');

      // Segunda abertura — salt deve ser o mesmo
      const db2 = await abrirBanco({
        pasta,
        modoDuravel: false,
        chaveEncriptacao: 'teste-consistencia',
      });
      await db2.fechar();
      const salt2 = fs.readFileSync(saltPath, 'utf8');
      assert.equal(salt1, salt2, 'salt deve ser idêntico entre sessões');
    } finally {
      limpar(pasta);
    }
  });
});
