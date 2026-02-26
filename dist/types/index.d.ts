// Type declarations for lite-nosql

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
