'use strict';

/**
 * lite-nosql — camada de encriptação
 *
 * Algoritmo : AES-256-GCM (autenticado — detecta adulteração)
 * KDF       : PBKDF2-SHA256 (deriva uma chave de 256 bits a partir de uma password)
 * IV        : 16 bytes aleatórios por operação (nunca reutilizado)
 * Auth tag  : 16 bytes GCM (garante integridade — ficheiro adulterado → erro)
 *
 * Formato do envelope (tudo em Base64, separado por ':'):
 *   <salt_hex>:<iv_hex>:<tag_hex>:<ciphertext_base64>
 *
 * O salt é fixo por banco (guardado em <pasta>/.db.salt) para que a mesma
 * password derive sempre a mesma chave. O IV é aleatório por operação.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITMO    = 'aes-256-gcm';
const COMPRIMENTO_CHAVE = 32;   // 256 bits
const COMPRIMENTO_IV    = 16;   // 128 bits
const COMPRIMENTO_TAG   = 16;   // 128 bits GCM auth tag
const PBKDF2_ITER  = 100_000;
const PBKDF2_HASH  = 'sha256';
const SALT_FICHEIRO = '.db.salt';

/**
 * Carrega ou cria o salt do banco.
 * O salt é persistido em disco para que a chave derivada seja sempre a mesma
 * para a mesma password.
 */
function obterOuCriarSalt(pasta) {
  const saltPath = path.join(pasta, SALT_FICHEIRO);
  if (fs.existsSync(saltPath)) {
    return Buffer.from(fs.readFileSync(saltPath, 'utf8').trim(), 'hex');
  }
  const salt = crypto.randomBytes(32);
  fs.writeFileSync(saltPath, salt.toString('hex'), 'utf8');
  // Permissões restritivas — só o dono lê
  try { fs.chmodSync(saltPath, 0o600); } catch { /* shared hosting pode não suportar */ }
  return salt;
}

/**
 * Deriva uma chave AES-256 a partir de uma password e um salt usando PBKDF2.
 */
function derivarChave(password, salt) {
  return crypto.pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITER,
    COMPRIMENTO_CHAVE,
    PBKDF2_HASH
  );
}

/**
 * Encripta uma string e retorna o envelope como string.
 */
function encriptar(texto, chave) {
  const iv = crypto.randomBytes(COMPRIMENTO_IV);
  const cipher = crypto.createCipheriv(ALGORITMO, chave, iv, {
    authTagLength: COMPRIMENTO_TAG
  });

  const encriptado = Buffer.concat([
    cipher.update(texto, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  // envelope: iv:tag:dados (tudo hex/base64 para ser texto puro)
  return [
    iv.toString('hex'),
    tag.toString('hex'),
    encriptado.toString('base64')
  ].join(':');
}

/**
 * Desencripta um envelope e retorna o texto original.
 * Lança erro se o ficheiro foi adulterado (GCM auth tag inválida).
 */
function desencriptar(envelope, chave) {
  const partes = envelope.split(':');
  if (partes.length !== 3) {
    throw new Error('lite-nosql: formato de ficheiro encriptado inválido');
  }
  const [ivHex, tagHex, dadosB64] = partes;
  const iv   = Buffer.from(ivHex, 'hex');
  const tag  = Buffer.from(tagHex, 'hex');
  const dados = Buffer.from(dadosB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITMO, chave, iv, {
    authTagLength: COMPRIMENTO_TAG
  });
  decipher.setAuthTag(tag);

  try {
    const desencriptado = Buffer.concat([
      decipher.update(dados),
      decipher.final()
    ]);
    return desencriptado.toString('utf8');
  } catch {
    throw new Error(
      'lite-nosql: falha ao desencriptar — password incorrecta ou ficheiro adulterado'
    );
  }
}

/**
 * Cria um serializer compatível com a API da biblioteca.
 * Passa este objecto como opção `serializar` ao abrir o banco.
 *
 * @param {string} password  - Password escolhida pelo utilizador
 * @param {string} pasta     - Pasta do banco (para localizar/criar o salt)
 */
function criarSerializerEncriptado(password, pasta) {
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new Error(
      'lite-nosql: a chaveEncriptacao deve ser uma string com pelo menos 8 caracteres'
    );
  }

  // Derivar chave uma única vez — operação cara (100k iterações PBKDF2)
  const salt  = obterOuCriarSalt(pasta);
  const chave = derivarChave(password, salt);

  return {
    serializar:   (valor) => encriptar(JSON.stringify(valor), chave),
    deserializar: (raw)   => JSON.parse(desencriptar(raw, chave)),
    _encriptado: true  // flag interna usada pelo WAL
  };
}

module.exports = { criarSerializerEncriptado, encriptar, desencriptar, derivarChave, obterOuCriarSalt };
