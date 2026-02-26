'use strict';

const { abrirBanco, Banco, Colecao } = require('./banco');
const { criarSerializerEncriptado } = require('./encriptacao');

module.exports = {
  abrirBanco,
  Banco,
  Colecao,
  criarSerializerEncriptado,
};
