import type { LockOptions, ModelMeta, SqlQuery } from './types.js'

/**
 * Quote a PostgreSQL identifier (table/column name)
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Get the SQL lock clause based on lock options
 */
export function buildLockClause(lock?: LockOptions): string {
  const mode = lock?.mode ?? 'ForUpdate'

  let lockSql: string
  switch (mode) {
    case 'ForUpdate':
      lockSql = 'FOR UPDATE'
      break
    case 'ForNoKeyUpdate':
      lockSql = 'FOR NO KEY UPDATE'
      break
    case 'ForShare':
      lockSql = 'FOR SHARE'
      break
    case 'ForKeyShare':
      lockSql = 'FOR KEY SHARE'
      break
    default:
      lockSql = 'FOR UPDATE'
  }

  if (lock?.noWait) {
    lockSql += ' NOWAIT'
  } else if (lock?.skipLocked) {
    lockSql += ' SKIP LOCKED'
  }

  return lockSql
}

/**
 * Build SELECT clause from select option or return *
 */
export function buildSelectClause(
  model: ModelMeta,
  select?: Record<string, boolean>
): string {
  if (!select) {
    return '*'
  }

  const selectedFields = Object.entries(select)
    .filter(([_, include]) => include)
    .map(([fieldName]) => {
      const field = model.fields.find((f) => f.name === fieldName)
      const dbName = field?.dbName ?? fieldName
      return quoteIdentifier(dbName)
    })

  if (selectedFields.length === 0) {
    return '*'
  }

  return selectedFields.join(', ')
}

/**
 * Build ORDER BY clause from orderBy option
 */
export function buildOrderByClause(
  model: ModelMeta,
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
): string {
  if (!orderBy) {
    return ''
  }

  const orderByList = Array.isArray(orderBy) ? orderBy : [orderBy]
  if (orderByList.length === 0) {
    return ''
  }

  const clauses = orderByList.flatMap((item) =>
    Object.entries(item).map(([fieldName, direction]) => {
      const field = model.fields.find((f) => f.name === fieldName)
      const dbName = field?.dbName ?? fieldName
      return `${quoteIdentifier(dbName)} ${direction.toUpperCase()}`
    })
  )

  if (clauses.length === 0) {
    return ''
  }

  return `ORDER BY ${clauses.join(', ')}`
}

/**
 * Convert a Prisma where clause to SQL WHERE clause with parameters
 * Supports common operators: equals, not, in, notIn, lt, lte, gt, gte, contains, startsWith, endsWith
 */
export function buildWhereClause(
  model: ModelMeta,
  where?: Record<string, unknown>,
  startParamIndex = 1
): { sql: string; params: unknown[] } {
  if (!where || Object.keys(where).length === 0) {
    return { sql: '', params: [] }
  }

  const conditions: string[] = []
  const params: unknown[] = []
  let paramIndex = startParamIndex

  function processCondition(key: string, value: unknown): void {
    // Handle logical operators
    if (key === 'AND' && Array.isArray(value)) {
      const subConditions: string[] = []
      for (const v of value) {
        const sub = buildWhereClause(model, v as Record<string, unknown>, paramIndex)
        params.push(...sub.params)
        paramIndex += sub.params.length
        subConditions.push(`(${sub.sql})`)
      }
      if (subConditions.length > 0) {
        conditions.push(`(${subConditions.join(' AND ')})`)
      }
      return
    }

    if (key === 'OR' && Array.isArray(value)) {
      const subConditions: string[] = []
      for (const v of value) {
        const sub = buildWhereClause(model, v as Record<string, unknown>, paramIndex)
        params.push(...sub.params)
        paramIndex += sub.params.length
        subConditions.push(`(${sub.sql})`)
      }
      if (subConditions.length > 0) {
        conditions.push(`(${subConditions.join(' OR ')})`)
      }
      return
    }

    if (key === 'NOT') {
      const sub = buildWhereClause(model, value as Record<string, unknown>, paramIndex)
      params.push(...sub.params)
      paramIndex += sub.params.length
      conditions.push(`NOT (${sub.sql})`)
      return
    }

    // Regular field conditions
    const field = model.fields.find((f) => f.name === key)
    if (!field || field.kind !== 'scalar') {
      return // Skip non-scalar fields (relations)
    }

    const dbName = field.dbName ?? key
    const quotedName = quoteIdentifier(dbName)

    if (value === null) {
      conditions.push(`${quotedName} IS NULL`)
      return
    }

    if (typeof value !== 'object' || value instanceof Date) {
      // Simple equality
      conditions.push(`${quotedName} = $${paramIndex++}`)
      params.push(value)
      return
    }

    // Object with operators
    const ops = value as Record<string, unknown>
    for (const [op, opValue] of Object.entries(ops)) {
      switch (op) {
        case 'equals':
          if (opValue === null) {
            conditions.push(`${quotedName} IS NULL`)
          } else {
            conditions.push(`${quotedName} = $${paramIndex++}`)
            params.push(opValue)
          }
          break
        case 'not':
          if (opValue === null) {
            conditions.push(`${quotedName} IS NOT NULL`)
          } else if (typeof opValue === 'object' && opValue !== null) {
            // Nested not with operators
            for (const [nestedOp, nestedVal] of Object.entries(opValue as Record<string, unknown>)) {
              switch (nestedOp) {
                case 'equals':
                  conditions.push(`${quotedName} != $${paramIndex++}`)
                  params.push(nestedVal)
                  break
                case 'in':
                  if (Array.isArray(nestedVal) && nestedVal.length > 0) {
                    const placeholders = nestedVal.map(() => `$${paramIndex++}`).join(', ')
                    conditions.push(`${quotedName} NOT IN (${placeholders})`)
                    params.push(...nestedVal)
                  }
                  break
              }
            }
          } else {
            conditions.push(`${quotedName} != $${paramIndex++}`)
            params.push(opValue)
          }
          break
        case 'in':
          if (Array.isArray(opValue) && opValue.length > 0) {
            const placeholders = opValue.map(() => `$${paramIndex++}`).join(', ')
            conditions.push(`${quotedName} IN (${placeholders})`)
            params.push(...opValue)
          }
          break
        case 'notIn':
          if (Array.isArray(opValue) && opValue.length > 0) {
            const placeholders = opValue.map(() => `$${paramIndex++}`).join(', ')
            conditions.push(`${quotedName} NOT IN (${placeholders})`)
            params.push(...opValue)
          }
          break
        case 'lt':
          conditions.push(`${quotedName} < $${paramIndex++}`)
          params.push(opValue)
          break
        case 'lte':
          conditions.push(`${quotedName} <= $${paramIndex++}`)
          params.push(opValue)
          break
        case 'gt':
          conditions.push(`${quotedName} > $${paramIndex++}`)
          params.push(opValue)
          break
        case 'gte':
          conditions.push(`${quotedName} >= $${paramIndex++}`)
          params.push(opValue)
          break
        case 'contains':
          conditions.push(`${quotedName} LIKE $${paramIndex++}`)
          params.push(`%${opValue}%`)
          break
        case 'startsWith':
          conditions.push(`${quotedName} LIKE $${paramIndex++}`)
          params.push(`${opValue}%`)
          break
        case 'endsWith':
          conditions.push(`${quotedName} LIKE $${paramIndex++}`)
          params.push(`%${opValue}`)
          break
        case 'mode':
          // Ignore mode (case sensitivity) for now - would need ILIKE for insensitive
          break
      }
    }
  }

  for (const [key, value] of Object.entries(where)) {
    processCondition(key, value)
  }

  if (conditions.length === 0) {
    return { sql: '', params: [] }
  }

  return {
    sql: conditions.join(' AND '),
    params,
  }
}

/**
 * Build a complete SELECT ... FOR UPDATE query
 */
export function buildSelectForUpdate(
  model: ModelMeta,
  options: {
    where?: Record<string, unknown>
    select?: Record<string, boolean>
    orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
    take?: number
    skip?: number
    lock?: LockOptions
  }
): SqlQuery {
  const tableName = model.dbName ?? model.name
  const selectClause = buildSelectClause(model, options.select)
  const { sql: whereSql, params } = buildWhereClause(model, options.where)
  const orderByClause = buildOrderByClause(model, options.orderBy)
  const lockClause = buildLockClause(options.lock)

  let sql = `SELECT ${selectClause} FROM ${quoteIdentifier(tableName)}`

  if (whereSql) {
    sql += ` WHERE ${whereSql}`
  }

  if (orderByClause) {
    sql += ` ${orderByClause}`
  }

  // Handle LIMIT and OFFSET
  let paramIndex = params.length + 1
  if (options.take !== undefined) {
    sql += ` LIMIT $${paramIndex++}`
    params.push(options.take)
  }

  if (options.skip !== undefined) {
    sql += ` OFFSET $${paramIndex++}`
    params.push(options.skip)
  }

  sql += ` ${lockClause}`

  return { sql, params }
}
