# @mosaic-code/prisma-select-for-update

A Prisma v7 extension that adds `SELECT ... FOR UPDATE` row locking functionality for PostgreSQL databases. This extension provides type-safe methods to lock rows during transactions, preventing concurrent modifications.

## Features

- **Type-safe row locking** - Three methods: `findUniqueForUpdate`, `findFirstForUpdate`, `findManyForUpdate`
- **Multiple lock modes** - Support for `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, and `FOR KEY SHARE`
- **NOWAIT and SKIP LOCKED** - Options for non-blocking lock acquisition
- **Prisma-compatible API** - Works seamlessly with existing Prisma queries
- **PostgreSQL-only** - Optimized for PostgreSQL's row-level locking

## Installation

```bash
npm install @mosaic-code/prisma-select-for-update
```

**Peer Dependencies:**
- `@prisma/client@^7.0.0`
- `@prisma/adapter-pg@^7.0.0` (for PostgreSQL adapter)

## Quick Start

```typescript
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { withForUpdate } from '@mosaic-code/prisma-select-for-update'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)

const basePrisma = new PrismaClient({ adapter })
const prisma = basePrisma.$extends(withForUpdate())

// Use within a transaction
await prisma.$transaction(async (tx) => {
  const user = await tx.user.findUniqueForUpdate({
    where: { id: 1 },
  })
  
  // User row is now locked - safe to modify
  if (user && user.balance >= 100) {
    await tx.user.update({
      where: { id: user.id },
      data: { balance: { decrement: 100 } },
    })
  }
})
```

## API Reference

### Methods

All methods **must** be called within a `$transaction` callback. Calling them outside a transaction will throw an error.

#### `findUniqueForUpdate`

Locks and returns a single row by unique field(s).

```typescript
const user = await prisma.$transaction(async (tx) => {
  return tx.user.findUniqueForUpdate({
    where: { id: 1 },
    select: { id: true, email: true }, // optional
    lock: { mode: 'ForUpdate' }, // optional, defaults to ForNoKeyUpdate
  })
})
```

#### `findFirstForUpdate`

Locks and returns the first matching row.

```typescript
const task = await prisma.$transaction(async (tx) => {
  return tx.task.findFirstForUpdate({
    where: { status: 'pending' },
    orderBy: { priority: 'desc' },
    lock: { skipLocked: true },
  })
})
```

#### `findManyForUpdate`

Locks and returns multiple matching rows.

```typescript
const users = await prisma.$transaction(async (tx) => {
  return tx.user.findManyForUpdate({
    where: { balance: { gte: 100 } },
    orderBy: { balance: 'asc' },
    take: 10,
    skip: 0,
    lock: { mode: 'ForShare' },
  })
})
```

### Lock Options

```typescript
interface LockOptions {
  /** Lock mode - defaults to 'ForNoKeyUpdate' */
  mode?: 'ForUpdate' | 'ForNoKeyUpdate' | 'ForShare' | 'ForKeyShare'
  /** Fail immediately if row is locked (NOWAIT) */
  noWait?: boolean
  /** Skip locked rows instead of waiting (SKIP LOCKED) */
  skipLocked?: boolean
}
```

#### Lock Modes

- **`ForNoKeyUpdate`** (default) - Exclusive lock for non-key columns, allows other transactions to acquire `FOR KEY SHARE` locks. Less restrictive than `ForUpdate` and common for updates that don't modify key columns.
- **`ForUpdate`** - Exclusive lock, prevents other transactions from modifying or locking the row
- **`ForShare`** - Shared lock, allows other transactions to read but not modify
- **`ForKeyShare`** - Weakest lock, allows other transactions to read and acquire `FOR KEY SHARE` locks

#### NOWAIT and SKIP LOCKED

```typescript
// Fail immediately if row is locked
const user = await prisma.$transaction(async (tx) => {
  return tx.user.findUniqueForUpdate({
    where: { id: 1 },
    lock: { noWait: true }, // Throws error if row is locked
  })
})

// Skip locked rows (useful for queue processing)
const tasks = await prisma.$transaction(async (tx) => {
  return tx.task.findManyForUpdate({
    where: { status: 'pending' },
    lock: { skipLocked: true }, // Returns only unlocked rows
  })
})
```

## Examples

### Bank Account Transfer

```typescript
await prisma.$transaction(async (tx) => {
  // Lock both accounts
  const fromAccount = await tx.account.findUniqueForUpdate({
    where: { id: fromAccountId },
  })
  const toAccount = await tx.account.findUniqueForUpdate({
    where: { id: toAccountId },
  })

  if (!fromAccount || fromAccount.balance < amount) {
    throw new Error('Insufficient funds')
  }

  // Update balances
  await tx.account.update({
    where: { id: fromAccountId },
    data: { balance: { decrement: amount } },
  })
  await tx.account.update({
    where: { id: toAccountId },
    data: { balance: { increment: amount } },
  })
})
```

### Queue Processing with SKIP LOCKED

```typescript
// Worker 1
const jobs1 = await prisma.$transaction(async (tx) => {
  return tx.job.findManyForUpdate({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 10,
    lock: { skipLocked: true }, // Skip rows locked by other workers
  })
})

// Worker 2 (runs concurrently)
const jobs2 = await prisma.$transaction(async (tx) => {
  return tx.job.findManyForUpdate({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 10,
    lock: { skipLocked: true }, // Gets different rows
  })
})
```

### Complex WHERE Clauses

All standard Prisma where operators are supported:

```typescript
const users = await prisma.$transaction(async (tx) => {
  return tx.user.findManyForUpdate({
    where: {
      OR: [
        { balance: { gte: 1000 } },
        { email: { contains: '@company.com' } },
      ],
      AND: [
        { status: 'active' },
        { createdAt: { gte: new Date('2024-01-01') } },
      ],
      NOT: {
        role: 'admin',
      },
    },
    orderBy: [{ balance: 'desc' }, { createdAt: 'asc' }],
  })
})
```

## Supported WHERE Operators

- Equality: `equals`, `not`
- Comparison: `lt`, `lte`, `gt`, `gte`
- Arrays: `in`, `notIn`
- Strings: `contains`, `startsWith`, `endsWith`
- Logical: `AND`, `OR`, `NOT`
- Null: `null`, `not: null`

**Note:** String operators (`contains`, `startsWith`, `endsWith`) escape LIKE wildcards (`%`, `_`) to match Prisma's behavior. For custom LIKE patterns, use `$queryRaw` within your transaction.

## Known Limitations

1. **PostgreSQL-only** - This extension is designed specifically for PostgreSQL's row-level locking. MySQL and SQLite are not supported.

2. **Case-insensitive matching** - The `mode: 'insensitive'` option is not supported. Use `$queryRaw` with `ILIKE` for case-insensitive matching:

```typescript
await prisma.$transaction(async (tx) => {
  const users = await tx.$queryRaw`
    SELECT * FROM "User" 
    WHERE email ILIKE ${'%test%'} 
    FOR UPDATE
  `
})
```

3. **Transaction required** - All `forUpdate` methods must be called within a transaction. This is enforced at runtime.

4. **Relation filters** - Relation filters (e.g., `posts: { some: {...} }`) are not supported. Use joins or separate queries instead.

## Type Safety

The extension maintains full TypeScript type safety:

```typescript
const user = await prisma.$transaction(async (tx) => {
  return tx.user.findUniqueForUpdate({
    where: { id: 1 },
    select: { id: true, email: true },
  })
})

// Type: { id: number; email: string } | null
```

## Error Handling

```typescript
try {
  await prisma.$transaction(async (tx) => {
    return tx.user.findUniqueForUpdate({
      where: { id: 1 },
      lock: { noWait: true },
    })
  })
} catch (error) {
  if (error.message.includes('could not obtain lock')) {
    // Row is locked by another transaction
  }
}
```

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Publishing

To publish this package to npm:

```bash
# Build the package (runs automatically before publish)
npm run build

# Publish to npm
npm publish
```

The `prepublishOnly` script ensures a clean build before publishing. Only the `dist` folder, `README.md`, and `LICENSE` are included in the published package.

## License

[Do No Harm](https://github.com/raisely/NoHarm)

## Related

- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL Row-Level Locking](https://www.postgresql.org/docs/current/explicit-locking.html)

