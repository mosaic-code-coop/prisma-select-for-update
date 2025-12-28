import type { Prisma } from '@prisma/client'

/**
 * Lock modes supported by PostgreSQL
 */
export type LockMode =
  | 'ForUpdate'
  | 'ForNoKeyUpdate'
  | 'ForShare'
  | 'ForKeyShare'

/**
 * Lock options for FOR UPDATE queries
 */
export interface LockOptions {
  /** Lock mode - defaults to ForNoKeyUpdate */
  mode?: LockMode
  /** Fail immediately if row is locked (NOWAIT) */
  noWait?: boolean
  /** Skip locked rows instead of waiting (SKIP LOCKED) */
  skipLocked?: boolean
}

/**
 * Arguments for findUniqueForUpdate
 */
export interface FindUniqueForUpdateArgs<T> {
  where: Prisma.Args<T, 'findUnique'>['where']
  select?: Prisma.Args<T, 'findUnique'>['select']
  lock?: LockOptions
}

/**
 * Arguments for findFirstForUpdate
 */
export interface FindFirstForUpdateArgs<T> {
  where?: Prisma.Args<T, 'findFirst'>['where']
  select?: Prisma.Args<T, 'findFirst'>['select']
  orderBy?: Prisma.Args<T, 'findFirst'>['orderBy']
  lock?: LockOptions
}

/**
 * Arguments for findManyForUpdate
 */
export interface FindManyForUpdateArgs<T> {
  where?: Prisma.Args<T, 'findMany'>['where']
  select?: Prisma.Args<T, 'findMany'>['select']
  orderBy?: Prisma.Args<T, 'findMany'>['orderBy']
  take?: number
  skip?: number
  lock?: LockOptions
}

/**
 * SQL query result with parameterized values
 */
export interface SqlQuery {
  sql: string
  params: unknown[]
}

/**
 * Model metadata from DMMF
 */
export interface ModelField {
  name: string
  kind: 'scalar' | 'object' | 'enum' | 'unsupported'
  type: string
  dbName?: string | null
  isId?: boolean
  isUnique?: boolean
}

export interface ModelMeta {
  name: string
  dbName: string | null
  fields: ModelField[]
}

/**
 * Transaction client interface for Prisma extensions
 * Transaction clients don't have $transaction method (can't nest transactions)
 */
export interface TransactionClient {
  $queryRawUnsafe: <R>(sql: string, ...params: unknown[]) => Promise<R[]>
}

/**
 * Extension context from Prisma.getExtensionContext
 */
export interface ExtensionContext {
  $name: string
  $parent: TransactionClient
}
