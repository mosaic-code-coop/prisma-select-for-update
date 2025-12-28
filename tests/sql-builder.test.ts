import { describe, it, expect } from 'vitest'
import {
  quoteIdentifier,
  escapeLikePattern,
  buildLockClause,
  buildSelectClause,
  buildOrderByClause,
  buildWhereClause,
  buildSelectForUpdate,
} from '../src/sql-builder.js'
import type { ModelMeta } from '../src/types.js'

const userModel: ModelMeta = {
  name: 'User',
  dbName: null,
  fields: [
    { name: 'id', kind: 'scalar', type: 'Int', dbName: null },
    { name: 'email', kind: 'scalar', type: 'String', dbName: null },
    { name: 'name', kind: 'scalar', type: 'String', dbName: null },
    { name: 'balance', kind: 'scalar', type: 'Int', dbName: null },
    { name: 'createdAt', kind: 'scalar', type: 'DateTime', dbName: 'created_at' },
    { name: 'posts', kind: 'object', type: 'Post', dbName: null },
  ],
}

describe('quoteIdentifier', () => {
  it('quotes simple identifiers', () => {
    expect(quoteIdentifier('User')).toBe('"User"')
    expect(quoteIdentifier('email')).toBe('"email"')
  })

  it('escapes double quotes in identifiers', () => {
    expect(quoteIdentifier('table"name')).toBe('"table""name"')
  })
})

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcard characters', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%')
    expect(escapeLikePattern('_test')).toBe('\\_test')
    expect(escapeLikePattern('test\\backslash')).toBe('test\\\\backslash')
  })

  it('escapes multiple wildcards', () => {
    expect(escapeLikePattern('50%_test')).toBe('50\\%\\_test')
    expect(escapeLikePattern('%_%')).toBe('\\%\\_\\%')
  })

  it('handles strings without wildcards', () => {
    expect(escapeLikePattern('normal text')).toBe('normal text')
    expect(escapeLikePattern('')).toBe('')
  })
})

describe('buildLockClause', () => {
  it('defaults to FOR UPDATE', () => {
    expect(buildLockClause()).toBe('FOR UPDATE')
    expect(buildLockClause({})).toBe('FOR UPDATE')
  })

  it('builds FOR UPDATE with options', () => {
    expect(buildLockClause({ mode: 'ForUpdate' })).toBe('FOR UPDATE')
    expect(buildLockClause({ mode: 'ForUpdate', noWait: true })).toBe('FOR UPDATE NOWAIT')
    expect(buildLockClause({ mode: 'ForUpdate', skipLocked: true })).toBe('FOR UPDATE SKIP LOCKED')
  })

  it('builds FOR NO KEY UPDATE', () => {
    expect(buildLockClause({ mode: 'ForNoKeyUpdate' })).toBe('FOR NO KEY UPDATE')
    expect(buildLockClause({ mode: 'ForNoKeyUpdate', noWait: true })).toBe('FOR NO KEY UPDATE NOWAIT')
  })

  it('builds FOR SHARE', () => {
    expect(buildLockClause({ mode: 'ForShare' })).toBe('FOR SHARE')
    expect(buildLockClause({ mode: 'ForShare', skipLocked: true })).toBe('FOR SHARE SKIP LOCKED')
  })

  it('builds FOR KEY SHARE', () => {
    expect(buildLockClause({ mode: 'ForKeyShare' })).toBe('FOR KEY SHARE')
    expect(buildLockClause({ mode: 'ForKeyShare', noWait: true })).toBe('FOR KEY SHARE NOWAIT')
  })

  it('prefers noWait over skipLocked when both are set', () => {
    expect(buildLockClause({ noWait: true, skipLocked: true })).toBe('FOR UPDATE NOWAIT')
  })
})

describe('buildSelectClause', () => {
  it('returns * when no select specified', () => {
    expect(buildSelectClause(userModel)).toBe('*')
    expect(buildSelectClause(userModel, undefined)).toBe('*')
  })

  it('returns * when empty select', () => {
    expect(buildSelectClause(userModel, {})).toBe('*')
  })

  it('selects specific fields', () => {
    expect(buildSelectClause(userModel, { id: true, email: true })).toBe('"id", "email"')
  })

  it('uses dbName when available', () => {
    expect(buildSelectClause(userModel, { id: true, createdAt: true })).toBe('"id", "created_at"')
  })

  it('excludes fields set to false', () => {
    expect(buildSelectClause(userModel, { id: true, email: false, name: true })).toBe('"id", "name"')
  })
})

describe('buildOrderByClause', () => {
  it('returns empty string when no orderBy', () => {
    expect(buildOrderByClause(userModel)).toBe('')
    expect(buildOrderByClause(userModel, undefined)).toBe('')
  })

  it('builds single field order', () => {
    expect(buildOrderByClause(userModel, { email: 'asc' })).toBe('ORDER BY "email" ASC')
    expect(buildOrderByClause(userModel, { balance: 'desc' })).toBe('ORDER BY "balance" DESC')
  })

  it('uses dbName when available', () => {
    expect(buildOrderByClause(userModel, { createdAt: 'desc' })).toBe('ORDER BY "created_at" DESC')
  })

  it('builds multiple field order from array', () => {
    expect(buildOrderByClause(userModel, [{ name: 'asc' }, { email: 'desc' }])).toBe(
      'ORDER BY "name" ASC, "email" DESC'
    )
  })

  it('builds multiple field order with dbName', () => {
    expect(
      buildOrderByClause(userModel, [
        { createdAt: 'desc' },
        { email: 'asc' },
        { balance: 'desc' },
      ])
    ).toBe('ORDER BY "created_at" DESC, "email" ASC, "balance" DESC')
  })
})

describe('buildWhereClause', () => {
  it('returns empty when no where', () => {
    expect(buildWhereClause(userModel)).toEqual({ sql: '', params: [] })
    expect(buildWhereClause(userModel, {})).toEqual({ sql: '', params: [] })
  })

  it('builds simple equality', () => {
    const result = buildWhereClause(userModel, { id: 1 })
    expect(result.sql).toBe('"id" = $1')
    expect(result.params).toEqual([1])
  })

  it('builds multiple conditions', () => {
    const result = buildWhereClause(userModel, { id: 1, email: 'test@example.com' })
    expect(result.sql).toBe('"id" = $1 AND "email" = $2')
    expect(result.params).toEqual([1, 'test@example.com'])
  })

  it('handles null values', () => {
    const result = buildWhereClause(userModel, { name: null })
    expect(result.sql).toBe('"name" IS NULL')
    expect(result.params).toEqual([])
  })

  it('handles equals operator', () => {
    const result = buildWhereClause(userModel, { id: { equals: 5 } })
    expect(result.sql).toBe('"id" = $1')
    expect(result.params).toEqual([5])
  })

  it('handles not operator', () => {
    const result = buildWhereClause(userModel, { id: { not: 5 } })
    expect(result.sql).toBe('"id" != $1')
    expect(result.params).toEqual([5])
  })

  it('handles not null', () => {
    const result = buildWhereClause(userModel, { name: { not: null } })
    expect(result.sql).toBe('"name" IS NOT NULL')
    expect(result.params).toEqual([])
  })

  it('handles in operator', () => {
    const result = buildWhereClause(userModel, { id: { in: [1, 2, 3] } })
    expect(result.sql).toBe('"id" IN ($1, $2, $3)')
    expect(result.params).toEqual([1, 2, 3])
  })

  it('handles notIn operator', () => {
    const result = buildWhereClause(userModel, { id: { notIn: [1, 2] } })
    expect(result.sql).toBe('"id" NOT IN ($1, $2)')
    expect(result.params).toEqual([1, 2])
  })

  it('handles comparison operators', () => {
    expect(buildWhereClause(userModel, { balance: { gt: 100 } })).toEqual({
      sql: '"balance" > $1',
      params: [100],
    })
    expect(buildWhereClause(userModel, { balance: { gte: 100 } })).toEqual({
      sql: '"balance" >= $1',
      params: [100],
    })
    expect(buildWhereClause(userModel, { balance: { lt: 100 } })).toEqual({
      sql: '"balance" < $1',
      params: [100],
    })
    expect(buildWhereClause(userModel, { balance: { lte: 100 } })).toEqual({
      sql: '"balance" <= $1',
      params: [100],
    })
  })

  it('handles string operators', () => {
    expect(buildWhereClause(userModel, { email: { contains: 'test' } })).toEqual({
      sql: '"email" LIKE $1',
      params: ['%test%'],
    })
    expect(buildWhereClause(userModel, { email: { startsWith: 'test' } })).toEqual({
      sql: '"email" LIKE $1',
      params: ['test%'],
    })
    expect(buildWhereClause(userModel, { email: { endsWith: 'test' } })).toEqual({
      sql: '"email" LIKE $1',
      params: ['%test'],
    })
  })

  it('escapes LIKE wildcards in string operators', () => {
    expect(buildWhereClause(userModel, { email: { contains: '50%' } })).toEqual({
      sql: '"email" LIKE $1',
      params: ['%50\\%%'],
    })
    expect(buildWhereClause(userModel, { email: { startsWith: '_test' } })).toEqual({
      sql: '"email" LIKE $1',
      params: ['\\_test%'],
    })
    expect(buildWhereClause(userModel, { email: { endsWith: 'test\\' } })).toEqual({
      sql: '"email" LIKE $1',
      params: ['%test\\\\'],
    })
  })

  it('handles empty in array', () => {
    const result = buildWhereClause(userModel, { id: { in: [] } })
    expect(result.sql).toBe('FALSE')
    expect(result.params).toEqual([])
  })

  it('handles empty notIn array', () => {
    const result = buildWhereClause(userModel, { id: { notIn: [] } })
    // Empty notIn matches all rows, so no condition is added
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })

  it('throws error for unsupported mode: insensitive', () => {
    expect(() => {
      buildWhereClause(userModel, { email: { contains: 'test', mode: 'insensitive' } })
    }).toThrow(/Case-insensitive mode is not supported/)
  })

  it('handles AND operator', () => {
    const result = buildWhereClause(userModel, {
      AND: [{ id: 1 }, { email: 'test@example.com' }],
    })
    expect(result.sql).toBe('(("id" = $1) AND ("email" = $2))')
    expect(result.params).toEqual([1, 'test@example.com'])
  })

  it('handles OR operator', () => {
    const result = buildWhereClause(userModel, {
      OR: [{ id: 1 }, { id: 2 }],
    })
    expect(result.sql).toBe('(("id" = $1) OR ("id" = $2))')
    expect(result.params).toEqual([1, 2])
  })

  it('handles NOT operator', () => {
    const result = buildWhereClause(userModel, {
      NOT: { id: 1 },
    })
    expect(result.sql).toBe('NOT ("id" = $1)')
    expect(result.params).toEqual([1])
  })

  it('handles nested NOT with equals', () => {
    const result = buildWhereClause(userModel, {
      id: { not: { equals: 5 } },
    })
    expect(result.sql).toBe('"id" != $1')
    expect(result.params).toEqual([5])
  })

  it('handles nested NOT with empty in array', () => {
    const result = buildWhereClause(userModel, {
      id: { not: { in: [] } },
    })
    // Empty array in NOT IN means match all rows, so no condition
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })

  it('uses dbName when available', () => {
    const result = buildWhereClause(userModel, { createdAt: new Date('2024-01-01') })
    expect(result.sql).toBe('"created_at" = $1')
  })

  it('skips relation fields', () => {
    const result = buildWhereClause(userModel, { posts: { some: { id: 1 } } })
    expect(result.sql).toBe('')
    expect(result.params).toEqual([])
  })
})

describe('buildSelectForUpdate', () => {
  it('builds basic select for update', () => {
    const result = buildSelectForUpdate(userModel, {
      where: { id: 1 },
    })
    expect(result.sql).toBe('SELECT * FROM "User" WHERE "id" = $1 FOR UPDATE')
    expect(result.params).toEqual([1])
  })

  it('builds with select fields', () => {
    const result = buildSelectForUpdate(userModel, {
      where: { id: 1 },
      select: { id: true, email: true },
    })
    expect(result.sql).toBe('SELECT "id", "email" FROM "User" WHERE "id" = $1 FOR UPDATE')
    expect(result.params).toEqual([1])
  })

  it('builds with orderBy', () => {
    const result = buildSelectForUpdate(userModel, {
      where: { balance: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
    })
    expect(result.sql).toBe(
      'SELECT * FROM "User" WHERE "balance" > $1 ORDER BY "created_at" DESC FOR UPDATE'
    )
    expect(result.params).toEqual([0])
  })

  it('builds with take and skip', () => {
    const result = buildSelectForUpdate(userModel, {
      take: 10,
      skip: 5,
    })
    expect(result.sql).toBe('SELECT * FROM "User" LIMIT $1 OFFSET $2 FOR UPDATE')
    expect(result.params).toEqual([10, 5])
  })

  it('builds with lock options', () => {
    const result = buildSelectForUpdate(userModel, {
      where: { id: 1 },
      lock: { mode: 'ForShare', skipLocked: true },
    })
    expect(result.sql).toBe('SELECT * FROM "User" WHERE "id" = $1 FOR SHARE SKIP LOCKED')
    expect(result.params).toEqual([1])
  })

  it('builds full query with all options', () => {
    const result = buildSelectForUpdate(userModel, {
      where: { balance: { gte: 100 } },
      select: { id: true, email: true, balance: true },
      orderBy: { balance: 'desc' },
      take: 5,
      lock: { mode: 'ForNoKeyUpdate', noWait: true },
    })
    expect(result.sql).toBe(
      'SELECT "id", "email", "balance" FROM "User" WHERE "balance" >= $1 ORDER BY "balance" DESC LIMIT $2 FOR NO KEY UPDATE NOWAIT'
    )
    expect(result.params).toEqual([100, 5])
  })

  it('uses dbName for table when available', () => {
    const modelWithDbName: ModelMeta = {
      ...userModel,
      dbName: 'users',
    }
    const result = buildSelectForUpdate(modelWithDbName, {
      where: { id: 1 },
    })
    expect(result.sql).toBe('SELECT * FROM "users" WHERE "id" = $1 FOR UPDATE')
  })
})
