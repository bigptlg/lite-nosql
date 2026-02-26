# lite-nosql — Guia Completo de Referência

## Índice

1. [Instalação](#1-instalação)
2. [Abrir o banco — `abrirBanco()`](#2-abrir-o-banco--abrirbanco)
3. [Obter uma colecção — `banco.colecao()`](#3-obter-uma-colecção--bancocolecao)
4. [Inserir — `inserir()`](#4-inserir--inserir)
5. [Buscar — `buscar()`](#5-buscar--buscar)
6. [Buscar um — `buscarUm()`](#6-buscar-um--buscarum)
7. [Actualizar — `actualizarUm()`](#7-actualizar--actualizarum)
8. [Remover — `removerUm()`](#8-remover--removerum)
9. [Contar — `contar()`](#9-contar--contar)
10. [Compactar — `compactar()`](#10-compactar--compactar)
11. [Fechar o banco — `banco.fechar()`](#11-fechar-o-banco--bancofechar)
12. [Filtros — operadores disponíveis](#12-filtros--operadores-disponíveis)
13. [Operadores de update](#13-operadores-de-update)
14. [Opções de pesquisa](#14-opções-de-pesquisa)
15. [Índices](#15-índices)
16. [Encriptação](#16-encriptação)
17. [Ficheiros gerados em disco](#17-ficheiros-gerados-em-disco)
18. [Limitações](#18-limitações)
19. [Exemplos completos](#19-exemplos-completos)

---

## 1. Instalação

```bash
npm install lite-nosql
```

**Requisitos:**
- Node.js 18 ou superior
- Zero dependências externas

**CommonJS:**
```js
const { abrirBanco } = require('lite-nosql');
```

**ES Modules:**
```js
import { abrirBanco } from 'lite-nosql';
```

**TypeScript:**
```ts
import { abrirBanco, Banco, Colecao, Documento } from 'lite-nosql';
```

---

## 2. Abrir o banco — `abrirBanco()`

O ponto de entrada da biblioteca. Cria o directório se não existir e aplica permissões seguras (`chmod 700`).

```js
const db = await abrirBanco(opcoes);
```

### Opções

| Opção | Tipo | Padrão | Descrição |
|---|---|---|---|
| `pasta` | `string` | **obrigatório** | Directório onde os ficheiros de dados ficam guardados |
| `modoDuravel` | `boolean` | `true` | Se `true`, faz `fsync` em cada escrita — garante que os dados sobrevivem a um crash do servidor |
| `limiteWAL` | `number` | `5242880` | Tamanho em bytes do WAL antes de compactar automaticamente (padrão: 5 MB) |
| `debug` | `boolean` | `false` | Mostra logs internos no terminal — útil para desenvolvimento |
| `chaveEncriptacao` | `string` | `null` | Password para encriptação AES-256-GCM de todos os ficheiros em disco |
| `serializar` | `object` | `null` | Serializer personalizado (ver secção [Encriptação](#16-encriptação)) |

### Exemplos

```js
// Mínimo
const db = await abrirBanco({ pasta: './dados' });

// Desenvolvimento (sem fsync, com logs)
const db = await abrirBanco({
  pasta: './dados',
  modoDuravel: false,
  debug: true,
});

// Produção com encriptação
const db = await abrirBanco({
  pasta: './dados',
  modoDuravel: true,
  chaveEncriptacao: process.env.DB_CHAVE,
});

// Todas as opções
const db = await abrirBanco({
  pasta: './dados',
  modoDuravel: true,
  limiteWAL: 10_000_000,   // 10 MB antes de compactar
  debug: false,
  chaveEncriptacao: 'a-minha-senha-secreta',
});
```

### Erros possíveis

```js
// ❌ Sem pasta — lança erro imediato
await abrirBanco({});
// Error: lite-nosql: a opção "pasta" é obrigatória

// ❌ Chave muito curta
await abrirBanco({ pasta: './dados', chaveEncriptacao: 'abc' });
// Error: lite-nosql: chaveEncriptacao deve ser uma string com pelo menos 8 caracteres
```

---

## 3. Obter uma colecção — `banco.colecao()`

Uma colecção agrupa documentos do mesmo tipo. É criada automaticamente na primeira vez que é acedida — não precisas de a declarar antecipadamente.

```js
const col = banco.colecao(nome, opcoes);
```

### Parâmetros

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `nome` | `string` | Nome da colecção — define o nome dos ficheiros em disco |
| `opcoes.indices` | `string[]` | Campos a indexar para buscas eficientes |

### Exemplos

```js
// Sem índices
const users = db.colecao('users');

// Com índices em campos frequentemente filtrados
const users = db.colecao('users', {
  indices: ['email', 'papel', 'activo']
});

// Múltiplas colecções
const users    = db.colecao('users');
const produtos = db.colecao('produtos');
const pedidos  = db.colecao('pedidos');
const logs     = db.colecao('logs', { indices: ['nivel', 'createdAt'] });
```

### Notas importantes

- Chamar `banco.colecao('users')` várias vezes retorna sempre a **mesma instância**
- O `_id` é sempre indexado automaticamente — não precisas de o incluir em `indices`
- Os índices ficam em memória — são reconstruídos quando o banco abre
- Índices em campos com muitos valores distintos (email, slug) trazem mais benefício

---

## 4. Inserir — `inserir()`

Insere um documento na colecção. Retorna o `_id` do documento criado.

```js
const id = await col.inserir(documento);
```

### O que a biblioteca adiciona automaticamente

| Campo | Tipo | Descrição |
|---|---|---|
| `_id` | `string` | ID único gerado automaticamente (se não fornecido) |
| `createdAt` | `string` | Data de criação em ISO 8601 |
| `updatedAt` | `string` | Data da última actualização (igual a `createdAt` na inserção) |

### Exemplos

```js
// Básico
const id = await users.inserir({ nome: 'Ana', email: 'ana@x.com' });
console.log(id); // 'lf3k9x2abc12'

// O documento guardado fica:
// {
//   _id: 'lf3k9x2abc12',
//   nome: 'Ana',
//   email: 'ana@x.com',
//   createdAt: '2026-01-15T10:30:00.000Z',
//   updatedAt: '2026-01-15T10:30:00.000Z'
// }

// Com _id personalizado
await users.inserir({
  _id: 'admin',
  nome: 'Administrador',
  email: 'admin@exemplo.com'
});

// Documento com estrutura aninhada
await users.inserir({
  nome: 'Carlos',
  endereco: {
    cidade: 'Lisboa',
    pais: 'Portugal'
  },
  tags: ['cliente', 'premium'],
  activo: true,
  pontos: 0
});

// Inserções em paralelo (seguro — fila serializada internamente)
const ids = await Promise.all([
  users.inserir({ nome: 'Alice' }),
  users.inserir({ nome: 'Bob' }),
  users.inserir({ nome: 'Carlos' }),
]);
```

---

## 5. Buscar — `buscar()`

Retorna um array de documentos que correspondem ao filtro.

```js
const docs = await col.buscar(filtro, opcoes);
```

### Parâmetros

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `filtro` | `object` | `{}` | Critério de pesquisa (ver [Filtros](#12-filtros--operadores-disponíveis)) |
| `opcoes.limite` | `number` | sem limite | Número máximo de documentos a retornar |
| `opcoes.saltar` | `number` | `0` | Número de documentos a ignorar (para paginação) |
| `opcoes.ordenarPor` | `string` | sem ordenação | Campo pelo qual ordenar (suporta dot notation) |
| `opcoes.ordem` | `string` | `'asc'` | Direcção da ordenação: `'asc'` ou `'desc'` |

### Exemplos

```js
// Todos os documentos
const todos = await users.buscar();

// Por campo simples
const activos = await users.buscar({ activo: true });

// Por _id
const resultado = await users.buscar({ _id: 'abc123' });

// Com ordenação
const recentes = await users.buscar(
  {},
  { ordenarPor: 'createdAt', ordem: 'desc' }
);

// Com paginação
const pagina1 = await users.buscar({}, { limite: 10, saltar: 0  });
const pagina2 = await users.buscar({}, { limite: 10, saltar: 10 });
const pagina3 = await users.buscar({}, { limite: 10, saltar: 20 });

// Combinado
const resultado = await users.buscar(
  { activo: true, papel: 'editor' },
  { ordenarPor: 'nome', ordem: 'asc', limite: 20, saltar: 0 }
);

// Campo aninhado (dot notation)
const lisboetas = await users.buscar({ 'endereco.cidade': 'Lisboa' });

// Com operadores
const adultos = await users.buscar({ idade: { $gte: 18 } });
const vips    = await users.buscar({ papel: { $in: ['admin', 'editor'] } });
const novos   = await users.buscar({
  createdAt: { $gt: '2026-01-01T00:00:00.000Z' }
});
```

### Retorno

Retorna sempre um **array** — vazio `[]` se nenhum documento corresponder, nunca `null`.

---

## 6. Buscar um — `buscarUm()`

Retorna o **primeiro** documento que corresponde ao filtro, ou `null` se não encontrar.

```js
const doc = await col.buscarUm(filtro);
```

### Exemplos

```js
// Por _id (forma mais comum)
const user = await users.buscarUm({ _id: id });

// Por campo único
const admin = await users.buscarUm({ papel: 'admin' });
const ana   = await users.buscarUm({ email: 'ana@x.com' });

// Com campo aninhado
const user = await users.buscarUm({ 'endereco.cidade': 'Porto' });

// Verificar se existe
const existe = await users.buscarUm({ email: 'ana@x.com' });
if (!existe) {
  console.log('utilizador não encontrado');
}

// Diferença para buscar()
const um   = await users.buscarUm({ activo: true }); // object | null
const list = await users.buscar({ activo: true });    // array (sempre)
```

---

## 7. Actualizar — `actualizarUm()`

Actualiza o **primeiro** documento que corresponde ao filtro. Retorna `true` se encontrou e actualizou, `false` se não encontrou.

```js
const encontrado = await col.actualizarUm(filtro, update);
```

### Parâmetros

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `filtro` | `object` | Critério para encontrar o documento |
| `update` | `object` | Operadores de actualização (`$set`, `$unset`, `$inc`) |

### Operadores de update

#### `$set` — define ou substitui campos

```js
await users.actualizarUm(
  { _id: id },
  { $set: { nome: 'Ana Maria', cidade: 'Porto' } }
);

// Campo aninhado
await users.actualizarUm(
  { _id: id },
  { $set: { 'endereco.codigoPostal': '4000-001' } }
);
```

#### `$unset` — remove campos

```js
// Array de nomes de campos
await users.actualizarUm(
  { _id: id },
  { $unset: ['campoTemporario', 'dadosObsoletos'] }
);

// Também aceita objecto
await users.actualizarUm(
  { _id: id },
  { $unset: { campoTemporario: 1 } }
);
```

#### `$inc` — incrementa (ou decrementa) um número

```js
// Incrementar
await users.actualizarUm(
  { _id: id },
  { $inc: { pontos: 10, loginCount: 1 } }
);

// Decrementar (valor negativo)
await users.actualizarUm(
  { _id: id },
  { $inc: { stock: -1 } }
);
```

#### Combinar operadores

```js
await users.actualizarUm(
  { _id: id },
  {
    $set:   { activo: false, bloqueadoEm: new Date().toISOString() },
    $inc:   { bloqueios: 1 },
    $unset: ['sessaoActiva', 'tokenReset'],
  }
);
```

### Exemplos completos

```js
// Verificar se actualizou
const ok = await users.actualizarUm(
  { _id: 'id-inexistente' },
  { $set: { x: 1 } }
);
console.log(ok); // false

// Actualizar por campo (não por _id)
await users.actualizarUm(
  { email: 'ana@x.com' },
  { $set: { verificado: true } }
);

// O updatedAt é actualizado automaticamente
const antes  = await users.buscarUm({ _id: id });
await users.actualizarUm({ _id: id }, { $set: { nome: 'Novo' } });
const depois = await users.buscarUm({ _id: id });
console.log(antes.updatedAt === depois.updatedAt); // false
```

---

## 8. Remover — `removerUm()`

Remove o **primeiro** documento que corresponde ao filtro. Retorna `true` se removeu, `false` se não encontrou.

```js
const removido = await col.removerUm(filtro);
```

### Exemplos

```js
// Por _id
const ok = await users.removerUm({ _id: id });
console.log(ok); // true ou false

// Por campo
await users.removerUm({ email: 'spam@exemplo.com' });

// Verificar antes de remover
const existe = await users.buscarUm({ _id: id });
if (existe) {
  await users.removerUm({ _id: id });
}
```

---

## 9. Contar — `contar()`

Retorna o número de documentos que correspondem ao filtro. Sem filtro, retorna o total da colecção.

```js
const n = await col.contar(filtro);
```

### Exemplos

```js
// Total da colecção
const total = await users.contar();

// Com filtro
const activos   = await users.contar({ activo: true });
const admins    = await users.contar({ papel: 'admin' });
const recentes  = await users.contar({
  createdAt: { $gt: '2026-01-01T00:00:00.000Z' }
});

// Verificar se existe (alternativa a buscarUm)
const existe = await users.contar({ email: 'ana@x.com' }) > 0;
```

---

## 10. Compactar — `compactar()`

Força a compactação imediata: escreve o snapshot e zera o WAL. Normalmente não precisas de chamar isto — ocorre automaticamente quando o WAL ultrapassa `limiteWAL`.

```js
await col.compactar();
```

### Quando usar manualmente

```js
// Antes de um backup
await users.compactar();
await produtos.compactar();
// Agora podes copiar os ficheiros .snapshot.json com segurança

// Agendamento nocturno
setInterval(async () => {
  if (new Date().getHours() === 3) {
    await users.compactar();
    await produtos.compactar();
  }
}, 60 * 60 * 1000);
```

### O que acontece internamente

1. Escreve snapshot temporário (`.snapshot.json.tmp`)
2. `fsync` (se `modoDuravel: true`)
3. `rename` atómico para `.snapshot.json`
4. Zera o `.wal.log`

É seguro em multi-processo — se dois processos tentarem compactar ao mesmo tempo, apenas um compacta e o outro recarrega o estado fresco do disco.

---

## 11. Fechar o banco — `banco.fechar()`

Aguarda que todas as escritas pendentes terminem e liberta recursos. Deve ser chamado quando o processo termina.

```js
await db.fechar();
```

### Exemplo com graceful shutdown

```js
const db = await abrirBanco({ pasta: './dados' });

// Fechar correctamente quando o processo termina
process.on('SIGTERM', async () => {
  await db.fechar();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await db.fechar();
  process.exit(0);
});
```

---

## 12. Filtros — operadores disponíveis

Os filtros são usados em `buscar()`, `buscarUm()`, `actualizarUm()`, `removerUm()` e `contar()`.

### Igualdade simples

```js
// Igualdade directa (o tipo importa — número 1 ≠ string "1")
{ campo: 'valor' }
{ campo: 42 }
{ campo: true }
{ campo: null }
```

### Operadores de comparação

| Operador | Significado | Exemplo |
|---|---|---|
| `$gt` | maior que | `{ idade: { $gt: 18 } }` |
| `$gte` | maior ou igual | `{ preco: { $gte: 10 } }` |
| `$lt` | menor que | `{ stock: { $lt: 5 } }` |
| `$lte` | menor ou igual | `{ nota: { $lte: 9.5 } }` |
| `$ne` | diferente de | `{ papel: { $ne: 'admin' } }` |
| `$in` | valor está na lista | `{ cor: { $in: ['azul', 'verde'] } }` |
| `$nin` | valor não está na lista | `{ estado: { $nin: ['banido', 'inactivo'] } }` |
| `$regex` | expressão regular | `{ nome: { $regex: /^Ana/i } }` |

### Exemplos detalhados

```js
// Entre dois valores
await produtos.buscar({ preco: { $gte: 10, $lte: 50 } });

// Lista de valores aceites
await users.buscar({ papel: { $in: ['admin', 'editor', 'moderador'] } });

// Excluir valores
await users.buscar({ papel: { $nin: ['banido', 'inactivo'] } });

// Regex — nomes que começam por "Ana"
await users.buscar({ nome: { $regex: /^Ana/i } });

// Regex — emails de um domínio
await users.buscar({ email: { $regex: /@empresa\.pt$/ } });

// Datas (strings ISO 8601 comparam correctamente)
const ontem = new Date(Date.now() - 86_400_000).toISOString();
await users.buscar({ createdAt: { $gt: ontem } });

// Campos aninhados com dot notation
await users.buscar({ 'endereco.cidade': 'Lisboa' });
await users.buscar({ 'config.notificacoes': true });

// Múltiplos campos (AND implícito — todos têm de corresponder)
await users.buscar({
  activo: true,
  papel: 'editor',
  'endereco.pais': 'Portugal'
});
```

### Tipos e colisões

A biblioteca usa prefixos internos por tipo para evitar colisões no índice:

```js
// Estes dois filtros são DISTINTOS e retornam resultados diferentes
await col.buscar({ codigo: 1   }); // procura o número 1
await col.buscar({ codigo: '1' }); // procura a string "1"

// O mesmo para:
await col.buscar({ activo: false }); // boolean false
await col.buscar({ activo: 0 });     // número 0 — resultados diferentes
```

---

## 13. Operadores de update

Usados em `actualizarUm()`.

### `$set` — definir campos

```js
{ $set: { campo: valor, outrocampo: outroValor } }

// Exemplos
{ $set: { nome: 'Ana Maria' } }
{ $set: { activo: false, updatedBy: 'admin' } }
{ $set: { 'endereco.cidade': 'Porto' } }  // dot notation
```

### `$unset` — remover campos

```js
{ $unset: ['campo1', 'campo2'] }           // array
{ $unset: { campo1: 1, campo2: 1 } }       // objecto (valor ignorado)

// Exemplos
{ $unset: ['tokenReset'] }
{ $unset: ['sessao', 'tokenTemp', 'codigoVerificacao'] }
```

### `$inc` — incrementar números

```js
{ $inc: { campo: valor } }  // valor pode ser negativo

// Exemplos
{ $inc: { visitas: 1 } }           // incrementar
{ $inc: { stock: -1 } }            // decrementar
{ $inc: { pontos: 10, nivel: 1 } } // múltiplos campos
```

### Combinar

```js
await col.actualizarUm(
  { _id: id },
  {
    $set:   { activo: false },
    $inc:   { falhas: 1 },
    $unset: ['sessaoActiva'],
  }
);
```

---

## 14. Opções de pesquisa

Segundo argumento de `buscar()`.

| Opção | Tipo | Padrão | Descrição |
|---|---|---|---|
| `limite` | `number` | sem limite | Máximo de documentos a retornar |
| `saltar` | `number` | `0` | Documentos a ignorar (paginação) |
| `ordenarPor` | `string` | sem ordem | Campo para ordenar (suporta dot notation) |
| `ordem` | `string` | `'asc'` | `'asc'` (crescente) ou `'desc'` (decrescente) |

### Paginação

```js
function pagina(numero, porPagina = 20) {
  return { limite: porPagina, saltar: (numero - 1) * porPagina };
}

const pagina1 = await users.buscar({}, pagina(1)); // docs 1-20
const pagina2 = await users.buscar({}, pagina(2)); // docs 21-40
const pagina3 = await users.buscar({}, pagina(3)); // docs 41-60
```

### Ordenação

```js
// Mais recentes primeiro
await users.buscar({}, { ordenarPor: 'createdAt', ordem: 'desc' });

// Alfabético
await users.buscar({}, { ordenarPor: 'nome', ordem: 'asc' });

// Por campo numérico
await produtos.buscar({}, { ordenarPor: 'preco', ordem: 'asc' });

// Por campo aninhado
await users.buscar({}, { ordenarPor: 'config.nivel', ordem: 'desc' });
```

---

## 15. Índices

Os índices aceleram buscas por igualdade em campos específicos.

```js
const col = db.colecao('users', {
  indices: ['email', 'papel', 'createdAt']
});
```

### Como funcionam

- Cada índice é um `Map<valor, Set<_id>>` em memória
- Valores de tipos diferentes nunca colidem (`n:1` vs `s:1` vs `b:true`)
- São reconstruídos automaticamente ao abrir o banco
- São actualizados automaticamente em cada insert/update/remove

### Quando usar

```js
// ✅ Vale a pena indexar campos que:
//   - são usados frequentemente em filtros
//   - têm muitos valores distintos
//   - identificam unicamente um documento (email, slug, código)

const users = db.colecao('users', {
  indices: ['email', 'username']      // buscas frequentes por estes campos
});

const posts = db.colecao('posts', {
  indices: ['autorId', 'publicado', 'createdAt']
});

// ❌ Não vale muito a pena indexar:
//   - campos booleanos (só dois valores, pouco selectivo)
//   - campos raramente filtrados
//   - colecções com menos de ~500 documentos
```

### Comportamento com campos não indexados

Se filtras por um campo sem índice, a biblioteca faz uma varredura completa. Em modo `debug: true` aparece um aviso:

```
[lite-nosql:users] aviso: varredura completa (nenhum índice para o filtro) [ 'cidade' ]
```

---

## 16. Encriptação

Activa encriptação AES-256-GCM em todos os ficheiros em disco com uma única opção.

```js
const db = await abrirBanco({
  pasta: './dados',
  chaveEncriptacao: process.env.DB_CHAVE,
});
```

### O que fica encriptado

- `colecao.snapshot.json` — estado compacto
- `colecao.wal.log` — cada linha do journal individualmente

### Detalhes técnicos

| Componente | Valor |
|---|---|
| Algoritmo | AES-256-GCM (autenticado) |
| Derivação de chave | PBKDF2-SHA256, 100 000 iterações |
| Salt | 32 bytes aleatórios, guardado em `.db.salt`, criado uma vez |
| IV | 16 bytes aleatórios por operação |
| Auth tag | 16 bytes — detecta adulteração do ficheiro |

### Ficheiro `.db.salt`

Criado automaticamente na primeira abertura. Guarda o salt que permite derivar sempre a mesma chave a partir da mesma password. **Não apagues este ficheiro** — sem ele não consegues ler os dados mesmo com a password correcta.

### Boas práticas

```js
// ✅ Guardar a chave em variável de ambiente, nunca no código
const db = await abrirBanco({
  pasta: './dados',
  chaveEncriptacao: process.env.DB_CHAVE_ENCRIPTACAO,
});

// ❌ Nunca colocar a chave directamente no código
const db = await abrirBanco({
  pasta: './dados',
  chaveEncriptacao: 'minhasenha123',  // perigoso — fica no git
});
```

### Erros de encriptação

```js
// Chave errada → erro ao ler
// Error: lite-nosql: falha ao desencriptar — password incorrecta ou ficheiro adulterado

// Ficheiro adulterado → mesmo erro (GCM detecta adulteração)
```

---

## 17. Ficheiros gerados em disco

Para cada colecção são criados até três ficheiros:

```
dados/
  users.snapshot.json    ← estado compacto de todos os documentos
  users.wal.log          ← journal append-only de operações
  users.lock             ← lock temporário (só existe durante escritas)
  .db.salt               ← salt de encriptação (se chaveEncriptacao activo)
```

| Ficheiro | Descrição |
|---|---|
| `nome.snapshot.json` | Snapshot compacto. Recriado em cada compactação via rename atómico. |
| `nome.wal.log` | Journal de operações. Cada linha é um JSON (ou linha encriptada). Zerado após compactação. |
| `nome.lock` | Lock de ficheiro com `pid + timestamp + host`. Removido automaticamente. Se ficar preso (crash), é detectado como stale e removido na próxima operação. |
| `.db.salt` | Salt PBKDF2 de 32 bytes. Só existe se `chaveEncriptacao` estiver activo. **Nunca apagar.** |

### Fazer backup

```js
// Compactar primeiro garante que o snapshot está completo e o WAL vazio
await users.compactar();
await produtos.compactar();

// Agora podes copiar os ficheiros .snapshot.json com segurança
// cp dados/*.snapshot.json backup/
```

---

## 18. Limitações

| Limitação | Detalhe |
|---|---|
| **Tudo em memória** | Todos os documentos ficam em RAM. Com documentos de ~1 KB, 100 MB de RAM comporta ~100 000 documentos. |
| **Sem transações** | Não há atomicidade entre múltiplas colecções. |
| **Sem joins** | Relações entre colecções são resolvidas na aplicação. |
| **Sem query planner** | Índices só funcionam para igualdade exacta. Filtros compostos usam o melhor índice disponível + varredura do restante. |
| **Multi-processo** | Escritas simultâneas de múltiplos processos são seguras ao nível do WAL. Compactação usa file lock com TTL e detecção de processo morto. |
| **Node.js ≥ 18** | Usa APIs modernas do Node.js. |

---

## 19. Exemplos completos

### API REST com Express

```js
import express from 'express';
import { abrirBanco } from 'lite-nosql';

const app = express();
app.use(express.json());

const db = await abrirBanco({
  pasta: './dados',
  modoDuravel: true,
  chaveEncriptacao: process.env.DB_CHAVE,
});

const users = db.colecao('users', { indices: ['email'] });

// Listar com paginação
app.get('/users', async (req, res) => {
  const { pagina = 1, limite = 20 } = req.query;
  const docs = await users.buscar({}, {
    limite: Number(limite),
    saltar: (Number(pagina) - 1) * Number(limite),
    ordenarPor: 'createdAt',
    ordem: 'desc',
  });
  const total = await users.contar();
  res.json({ docs, total, pagina: Number(pagina) });
});

// Buscar um
app.get('/users/:id', async (req, res) => {
  const user = await users.buscarUm({ _id: req.params.id });
  if (!user) return res.status(404).json({ erro: 'Não encontrado' });
  res.json(user);
});

// Criar
app.post('/users', async (req, res) => {
  const existe = await users.buscarUm({ email: req.body.email });
  if (existe) return res.status(409).json({ erro: 'Email já existe' });
  const id = await users.inserir(req.body);
  res.status(201).json(await users.buscarUm({ _id: id }));
});

// Actualizar
app.patch('/users/:id', async (req, res) => {
  const ok = await users.actualizarUm(
    { _id: req.params.id },
    { $set: req.body }
  );
  if (!ok) return res.status(404).json({ erro: 'Não encontrado' });
  res.json(await users.buscarUm({ _id: req.params.id }));
});

// Remover
app.delete('/users/:id', async (req, res) => {
  const ok = await users.removerUm({ _id: req.params.id });
  if (!ok) return res.status(404).json({ erro: 'Não encontrado' });
  res.status(204).send();
});

// Graceful shutdown
process.on('SIGTERM', async () => { await db.fechar(); process.exit(0); });

app.listen(3000, () => console.log('API em http://localhost:3000'));
```

### Sistema de sessões

```js
const sessoes = db.colecao('sessoes', { indices: ['userId', 'token'] });

// Criar sessão
async function criarSessao(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await sessoes.inserir({
    userId,
    token,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  return token;
}

// Validar sessão
async function validarSessao(token) {
  const sessao = await sessoes.buscarUm({ token });
  if (!sessao) return null;
  if (sessao.expiresAt < new Date().toISOString()) {
    await sessoes.removerUm({ token });
    return null;
  }
  return sessao;
}

// Limpar sessões expiradas
async function limparSessoes() {
  const agora = new Date().toISOString();
  const expiradas = await sessoes.buscar({ expiresAt: { $lt: agora } });
  for (const s of expiradas) {
    await sessoes.removerUm({ _id: s._id });
  }
  console.log(`${expiradas.length} sessões removidas`);
}
```

### Contador com `$inc`

```js
const stats = db.colecao('stats');

// Garantir que o doc existe
async function incrementar(chave, campo, valor = 1) {
  const doc = await stats.buscarUm({ _id: chave });
  if (!doc) {
    await stats.inserir({ _id: chave, [campo]: valor });
  } else {
    await stats.actualizarUm({ _id: chave }, { $inc: { [campo]: valor } });
  }
}

await incrementar('global', 'visitas');
await incrementar('global', 'visitas');
await incrementar('global', 'erros', 1);

const global = await stats.buscarUm({ _id: 'global' });
console.log(global.visitas); // 2
```
