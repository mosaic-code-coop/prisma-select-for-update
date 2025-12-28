import { Prisma } from '@prisma/client'
import { buildSelectForUpdate } from './sql-builder.js'
import type {
  ExtensionContext,
  FindFirstForUpdateArgs,
  FindManyForUpdateArgs,
  FindUniqueForUpdateArgs,
  ModelMeta,
  TransactionClient,
} from './types.js'

/**
 * Get model metadata from DMMF
 */
function getModelMeta(modelName: string): ModelMeta {
  const dmmf = Prisma.dmmf
  const model = dmmf.datamodel.models.find(
    (m) => m.name.toLowerCase() === modelName.toLowerCase()
  )

  if (!model) {
    throw new Error(`Model "${modelName}" not found in Prisma schema`)
  }

  return {
    name: model.name,
    dbName: model.dbName ?? null,
    fields: model.fields.map((f) => ({
      name: f.name,
      kind: f.kind as 'scalar' | 'object' | 'enum' | 'unsupported',
      type: f.type,
      dbName: f.dbName ?? null,
      isId: f.isId ?? false,
      isUnique: f.isUnique ?? false,
    })),
  }
}

/**
 * Transform raw query result to match Prisma's camelCase field naming
 */
function transformResult<T>(
  result: Record<string, unknown>,
  model: ModelMeta
): T {
  const transformed: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(result)) {
    // Find field by dbName or name (case-insensitive for PostgreSQL)
    const field = model.fields.find(
      (f) =>
        (f.dbName ?? f.name).toLowerCase() === key.toLowerCase() ||
        f.name.toLowerCase() === key.toLowerCase()
    )

    if (field) {
      transformed[field.name] = value
    } else {
      transformed[key] = value
    }
  }

  return transformed as T
}

/**
 * Check if we're in a transaction context
 * Transaction clients do NOT have $transaction method (can't nest transactions)
 */
function isTransactionClient(client: unknown): boolean {
  // Transaction clients don't have $transaction method
  // Base client has $transaction, transaction client doesn't
  return !((client as Record<string, unknown>)?.$transaction)
}

/**
 * Get and validate execution context from Prisma extension
 * Extracts model name, validates transaction context, and returns model metadata
 */
function getExecutionContext(thisArg: unknown): {
  client: TransactionClient
  model: ModelMeta
  modelName: string
} {
  const context = Prisma.getExtensionContext(thisArg) as ExtensionContext

  const modelName = context.$name
  if (!modelName) {
    throw new Error('Could not determine model name from context')
  }

  const client = context.$parent

  // Check if we're in a transaction
  if (!isTransactionClient(client)) {
    throw new Error(
      'forUpdate methods must be called within a transaction. ' +
        'Use prisma.$transaction(async (tx) => { await tx.model.findUniqueForUpdate(...) })'
    )
  }

  if (!client?.$queryRawUnsafe) {
    throw new Error('$queryRawUnsafe not available on client')
  }

  const model = getModelMeta(modelName)

  return { client, model, modelName }
}

/**
 * Create the Prisma extension with forUpdate methods
 */
export function withForUpdate() {
  return Prisma.defineExtension({
    name: 'prisma-lock-for-update',
    model: {
      $allModels: {
        async findUniqueForUpdate<T, Args extends FindUniqueForUpdateArgs<T>>(
          this: T,
          args: Args
        ): Promise<Prisma.Result<T, Args, 'findUnique'> | null> {
          const { client, model } = getExecutionContext(this)

          const { sql, params } = buildSelectForUpdate(model, {
            where: args.where as Record<string, unknown>,
            select: args.select as Record<string, boolean> | undefined,
            lock: args.lock,
            take: 1, // findUnique should return at most 1 row
          })

          const results = await client.$queryRawUnsafe<Record<string, unknown>>(
            sql,
            ...params
          )

          if (results.length === 0) {
            return null
          }

          return transformResult(results[0], model) as Prisma.Result<T, Args, 'findUnique'>
        },

        async findFirstForUpdate<T, Args extends FindFirstForUpdateArgs<T>>(
          this: T,
          args: Args = {} as Args
        ): Promise<Prisma.Result<T, Args, 'findFirst'> | null> {
          const { client, model } = getExecutionContext(this)

          const { sql, params } = buildSelectForUpdate(model, {
            where: args.where as Record<string, unknown> | undefined,
            select: args.select as Record<string, boolean> | undefined,
            orderBy: args.orderBy as Record<string, 'asc' | 'desc'> | undefined,
            lock: args.lock,
            take: 1, // findFirst returns at most 1 row
          })

          const results = await client.$queryRawUnsafe<Record<string, unknown>>(
            sql,
            ...params
          )

          if (results.length === 0) {
            return null
          }

          return transformResult(results[0], model) as Prisma.Result<T, Args, 'findFirst'>
        },

        async findManyForUpdate<T, Args extends FindManyForUpdateArgs<T>>(
          this: T,
          args: Args = {} as Args
        ): Promise<Prisma.Result<T, Args, 'findMany'>> {
          const { client, model } = getExecutionContext(this)

          const { sql, params } = buildSelectForUpdate(model, {
            where: args.where as Record<string, unknown> | undefined,
            select: args.select as Record<string, boolean> | undefined,
            orderBy: args.orderBy as Record<string, 'asc' | 'desc'> | undefined,
            take: args.take,
            skip: args.skip,
            lock: args.lock,
          })

          const results = await client.$queryRawUnsafe<Record<string, unknown>>(
            sql,
            ...params
          )

          return results.map((r) =>
            transformResult(r, model)
          ) as Prisma.Result<T, Args, 'findMany'>
        },
      },
    },
  })
}
