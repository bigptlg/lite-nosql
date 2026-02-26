# lite-nosql

> **Embedded NoSQL document database for Node.js**  
> Sem binários nativos · apenas filesystem · funciona em shared hosting

[![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

---

## Características

| Característica | Detalhe |
|---|---|
| **Zero binários nativos** | Usa apenas `fs`, `path`, `crypto` |
| **Durabilidade WAL + Snapshot** | Inspirado em SQLite; crash-safe |
| **CJS + ESM** | Funciona com `require()` e `import` |
| **TypeScript** | Declarações `.d.ts` incluídas |
| **Índices em memória** | Lookups rápidos em campos indexados |
| **Concorrência** | Fila de escrita serializada + file lock |
| **Filtros ricos** | `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in`, `$nin`, `$regex` |
| **Sem dependências** | `dependencies: {}` — zero pacotes externos |

---

## Instalação

```bash
npm install lite-nosql
```

---

## Exemplo Completo

```js
import { abrirBanco } from "lite-nosql";   // ESM
// const { abrirBanco } = require("lite-nosql"); // CommonJS

const db = await abrirBanco({
  pasta: "./dados",
  modoDuravel: true,   // fsync em cada escrita (recomendado em produção)
  debug: false,
});

const users = db.colecao("users", { indices: ["email", "createdAt"] });

// Inserir
const id = await users.inserir({ nome: "Ana", email: "ana@x.com" });

// Buscar por _id
const ana = await users.buscarUm({ _id: id });
console.log(ana); // { _id: "...", nome: "Ana", email: "ana@x.com", createdAt: "...", updatedAt: "..." }

// Actualizar
await users.actualizarUm({ _id: id }, { $set: { nome: "Ana Maria" } });
await users.actualizarUm({ _id: id }, { $inc: { loginCount: 1 } });
await users.actualizarUm({ _id: id }, { $unset: ["campoObsoleto"] });

// Buscar com filtro, ordenação e paginação
const lista = await users.buscar(
  { email: "ana@x.com" },
  { limite: 50, saltar: 0, ordenarPor: "createdAt", ordem: "desc" }
);

// Buscar com operadores
const recentes = await users.buscar({ createdAt: { $gt: "2024-01-01T00:00:00.000Z" } });
const especificos = await users.buscar({ email: { $in: ["a@a.com", "b@b.com"] } });

// Contar
const total = await users.contar();
const activos = await users.contar({ status: "activo" });

// Remover
await users.removerUm({ _id: id });

// Compactar manualmente (opcional — ocorre automaticamente)
await users.compactar();

// Fechar o banco (aguarda escritas pendentes)
await db.fechar();
```

---

## API

### `abrirBanco(opcoes)` → `Promise<Banco>`

Abre (ou cria) um banco de dados no directório especificado.

| Opção | Tipo | Padrão | Descrição |
|---|---|---|---|
| `pasta` | `string` | **obrigatório** | Directório de armazenamento |
| `modoDuravel` | `boolean` | `true` | Se `true`, faz `fsync` em cada escrita |
| `limiteWAL` | `number` | `5242880` (5 MB) | Bytes de WAL antes de compactar |
| `debug` | `boolean` | `false` | Activar logs detalhados |
| `serializar` | `object` | `null` | Serializer personalizado (ver abaixo) |

---

### `Banco`

#### `banco.colecao(nome, opcoes?)` → `Colecao`

Obtém ou cria uma colecção. Múltiplas chamadas com o mesmo `nome` retornam a mesma instância.

| Opção | Tipo | Descrição |
|---|---|---|
| `indices` | `string[]` | Campos a indexar para lookups eficientes |

#### `banco.fechar()` → `Promise<void>`

Aguarda escritas pendentes e liberta recursos.

---

### `Colecao`

#### `inserir(doc)` → `Promise<string>`

Insere um documento. Gera `_id` automaticamente se ausente. Adiciona `createdAt` e `updatedAt`.

```js
const id = await col.inserir({ nome: "Alice", idade: 30 });
```

#### `buscar(filtro?, opcoes?)` → `Promise<Documento[]>`

Retorna documentos que correspondem ao filtro.

```js
// Sem filtro — todos os documentos
await col.buscar();

// Igualdade simples
await col.buscar({ status: "activo" });

// Operadores
await col.buscar({ idade: { $gte: 18, $lt: 65 } });
await col.buscar({ nome: { $regex: /^Ana/i } });
await col.buscar({ role: { $in: ["admin", "editor"] } });

// Com opções
await col.buscar({}, { limite: 20, saltar: 40, ordenarPor: "nome", ordem: "asc" });
```

**Operadores de filtro suportados:**

| Operador | Significado |
|---|---|
| `$gt` | maior que |
| `$gte` | maior ou igual |
| `$lt` | menor que |
| `$lte` | menor ou igual |
| `$ne` | diferente de |
| `$in` | valor está na lista |
| `$nin` | valor não está na lista |
| `$regex` | correspondência de regex |

#### `buscarUm(filtro?)` → `Promise<Documento \| null>`

Retorna o primeiro documento correspondente, ou `null`.

#### `actualizarUm(filtro, update)` → `Promise<boolean>`

Actualiza o primeiro documento correspondente. Retorna `true` se encontrado.

**Operadores de update:**

| Operador | Exemplo | Efeito |
|---|---|---|
| `$set` | `{ $set: { nome: "Bob" } }` | Define campos |
| `$unset` | `{ $unset: ["campo"] }` | Remove campos |
| `$inc` | `{ $inc: { visitas: 1 } }` | Incrementa campo numérico |

#### `removerUm(filtro)` → `Promise<boolean>`

Remove o primeiro documento correspondente. Retorna `true` se encontrado.

#### `contar(filtro?)` → `Promise<number>`

Conta documentos. Sem filtro, retorna o total da colecção.

#### `compactar()` → `Promise<void>`

Força a compactação imediata: escreve snapshot e zera o WAL.

---

## Armazenamento e Durabilidade

### Ficheiros por colecção

```
dados/
  users.snapshot.json   ← estado compacto (JSON)
  users.wal.log         ← journal append-only
  users.lock            ← lock temporário de escrita
```

### Formato do WAL

Cada linha é um objecto JSON:

```jsonl
{"op":"insert","ts":1700000000000,"id":"abc123","doc":{"_id":"abc123","nome":"Ana",...}}
{"op":"update","ts":1700000001000,"id":"abc123","set":{"nome":"Ana Maria"},"unset":[],"inc":{}}
{"op":"delete","ts":1700000002000,"id":"abc123"}
```

### Ciclo de vida

```
Escrita → append WAL → [fsync] → actualizar memória
Leitura → sempre da memória (cache quente)
Startup → carregar snapshot → reaplicar WAL
Compactação → snapshot atómico (rename) → zerar WAL
```

### Compactação

Ocorre automaticamente quando o WAL excede `limiteWAL`. Processo seguro:

1. Escrever snapshot temporário (`.tmp`)
2. `fsync`
3. `rename` atómico
4. Zerar WAL

---

## Concorrência

### Dentro do mesmo processo

A fila de escrita serializada (`_filaEscrita`) garante que inserts/updates/deletes paralelos são processados em sequência. Leituras são sempre servidas da memória.

### Entre múltiplos processos

O lock de ficheiro (`colecao.lock`) usa `O_EXCL` para exclusividade. Cada processo tenta adquirir o lock com backoff exponencial antes de compactar.

> **Atenção:** Para múltiplos processos simultâneos a fazer escritas normais (não compactação), a arquitectura WAL append-only já é segura no mesmo filesystem POSIX — escritas ao nível de `write()` syscall são atómicas para blocos pequenos. Para workloads multi-processo intensivos, considere uma arquitectura cliente-servidor.

---

## Índices

- `_id` é sempre indexado (via `Map` directa, O(1))
- Índices opcionais por campo são `Map<valor, Set<_id>>` em memória
- Filtros em campos indexados usam o índice automaticamente
- Filtros em campos não indexados fazem varredura completa (com aviso em modo `debug`)
- Os índices são reconstruídos na abertura do banco

```js
const col = db.colecao("posts", { indices: ["autorId", "createdAt", "status"] });
```

---

## Serializer Personalizado

```js
const db = await abrirBanco({
  pasta: "./dados",
  serializar: {
    serializar: (valor) => JSON.stringify(valor),          // snapshot → string
    deserializar: (raw) => JSON.parse(raw),               // string → snapshot
  }
});
```

Útil para compressão, encriptação, ou substituição de JSON por MessagePack.

---

## Limitações

| Limitação | Notas |
|---|---|
| **Tudo em memória** | Todos os documentos são mantidos em RAM. Não adequado para colecções com centenas de MB de dados |
| **Sem transações** | Não há atomicidade entre múltiplas colecções |
| **Sem joins/agregações** | Processamento ad-hoc deve ser feito na aplicação |
| **Concorrência multi-processo** | Escrita simultânea de múltiplos processos Node.js é segura ao nível do WAL; compactação usa file lock |
| **Sem query planner** | Apenas índices de igualdade; filtros compostos fazem varredura parcial |
| **Node.js ≥18** | Usa `node:test`, `crypto.randomBytes` |

---

## Sugestões de Nomes npm (alternativas)

Caso `lite-nosql` esteja ocupado:

- `filenosql`
- `nodefiledb`
- `waldb`
- `snapdb-node`
- `embeddedoc`

---

## Licença

MIT
