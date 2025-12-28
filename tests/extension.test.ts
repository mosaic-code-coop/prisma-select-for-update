import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { withForUpdate } from '../src/index.js'

const { Pool } = pg

const DATABASE_URL = process.env.DATABASE_URL!

// Create connection pool
const pool = new Pool({ connectionString: DATABASE_URL })

// Create adapter and client
const adapter = new PrismaPg(pool)
const basePrisma = new PrismaClient({ adapter })
const prisma = basePrisma.$extends(withForUpdate())

describe('prisma-lock-for-update extension', () => {
  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
    await pool.end()
  })

  beforeEach(async () => {
    // Clean up test data
    await prisma.task.deleteMany()
    await prisma.post.deleteMany()
    await prisma.user.deleteMany()
  })

  describe('findUniqueForUpdate', () => {
    it('locks and returns a single row by unique field', async () => {
      const user = await prisma.user.create({
        data: { email: 'test@example.com', name: 'Test User', balance: 100 },
      })

      const result = await prisma.$transaction(async (tx) => {
        const locked = await tx.user.findUniqueForUpdate({
          where: { id: user.id },
        })
        return locked
      })

      expect(result).not.toBeNull()
      expect(result?.id).toBe(user.id)
      expect(result?.email).toBe('test@example.com')
      expect(result?.balance).toBe(100)
    })

    it('returns null when no row matches', async () => {
      const result = await prisma.$transaction(async (tx) => {
        return tx.user.findUniqueForUpdate({
          where: { id: 99999 },
        })
      })

      expect(result).toBeNull()
    })

    it('supports select option', async () => {
      const user = await prisma.user.create({
        data: { email: 'select@example.com', name: 'Select User', balance: 50 },
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.user.findUniqueForUpdate({
          where: { id: user.id },
          select: { id: true, email: true },
        })
      })

      expect(result).not.toBeNull()
      expect(result?.id).toBe(user.id)
      expect(result?.email).toBe('select@example.com')
      // balance should not be selected
      expect((result as Record<string, unknown>)?.balance).toBeUndefined()
    })

    it('supports different lock modes', async () => {
      const user = await prisma.user.create({
        data: { email: 'lock@example.com', name: 'Lock User', balance: 200 },
      })

      // Test FOR SHARE
      const shareResult = await prisma.$transaction(async (tx) => {
        return tx.user.findUniqueForUpdate({
          where: { id: user.id },
          lock: { mode: 'ForShare' },
        })
      })
      expect(shareResult?.id).toBe(user.id)

      // Test FOR NO KEY UPDATE
      const noKeyResult = await prisma.$transaction(async (tx) => {
        return tx.user.findUniqueForUpdate({
          where: { id: user.id },
          lock: { mode: 'ForNoKeyUpdate' },
        })
      })
      expect(noKeyResult?.id).toBe(user.id)

      // Test FOR KEY SHARE
      const keyShareResult = await prisma.$transaction(async (tx) => {
        return tx.user.findUniqueForUpdate({
          where: { id: user.id },
          lock: { mode: 'ForKeyShare' },
        })
      })
      expect(keyShareResult?.id).toBe(user.id)
    })
  })

  describe('findFirstForUpdate', () => {
    it('locks and returns the first matching row', async () => {
      await prisma.task.createMany({
        data: [
          { title: 'Task 1', status: 'pending', priority: 1 },
          { title: 'Task 2', status: 'pending', priority: 2 },
          { title: 'Task 3', status: 'done', priority: 3 },
        ],
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.task.findFirstForUpdate({
          where: { status: 'pending' },
          orderBy: { priority: 'desc' },
        })
      })

      expect(result).not.toBeNull()
      expect(result?.title).toBe('Task 2')
      expect(result?.priority).toBe(2)
    })

    it('returns null when no rows match', async () => {
      await prisma.task.create({
        data: { title: 'Task', status: 'done' },
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.task.findFirstForUpdate({
          where: { status: 'pending' },
        })
      })

      expect(result).toBeNull()
    })

    it('works without where clause', async () => {
      await prisma.task.createMany({
        data: [
          { title: 'Task 1', priority: 1 },
          { title: 'Task 2', priority: 2 },
        ],
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.task.findFirstForUpdate({
          orderBy: { priority: 'asc' },
        })
      })

      expect(result).not.toBeNull()
      expect(result?.title).toBe('Task 1')
    })
  })

  describe('findManyForUpdate', () => {
    it('locks and returns multiple rows', async () => {
      await prisma.user.createMany({
        data: [
          { email: 'user1@example.com', name: 'User 1', balance: 100 },
          { email: 'user2@example.com', name: 'User 2', balance: 200 },
          { email: 'user3@example.com', name: 'User 3', balance: 300 },
        ],
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.user.findManyForUpdate({
          where: { balance: { gte: 150 } },
          orderBy: { balance: 'asc' },
        })
      })

      expect(result).toHaveLength(2)
      expect(result[0].balance).toBe(200)
      expect(result[1].balance).toBe(300)
    })

    it('returns empty array when no rows match', async () => {
      await prisma.user.create({
        data: { email: 'low@example.com', balance: 50 },
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.user.findManyForUpdate({
          where: { balance: { gte: 1000 } },
        })
      })

      expect(result).toHaveLength(0)
    })

    it('supports take and skip', async () => {
      await prisma.task.createMany({
        data: [
          { title: 'Task 1', priority: 1 },
          { title: 'Task 2', priority: 2 },
          { title: 'Task 3', priority: 3 },
          { title: 'Task 4', priority: 4 },
          { title: 'Task 5', priority: 5 },
        ],
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.task.findManyForUpdate({
          orderBy: { priority: 'asc' },
          take: 2,
          skip: 1,
        })
      })

      expect(result).toHaveLength(2)
      expect(result[0].title).toBe('Task 2')
      expect(result[1].title).toBe('Task 3')
    })

    it('supports SKIP LOCKED for queue-like behavior', async () => {
      await prisma.task.createMany({
        data: [
          { title: 'Job 1', status: 'pending' },
          { title: 'Job 2', status: 'pending' },
        ],
      })

      // This test verifies SKIP LOCKED syntax is generated correctly
      // Actual concurrent behavior would require parallel connections
      const result = await prisma.$transaction(async (tx) => {
        return tx.task.findManyForUpdate({
          where: { status: 'pending' },
          lock: { skipLocked: true },
        })
      })

      expect(result).toHaveLength(2)
    })
  })

  describe('transaction requirement', () => {
    it('throws error when findUniqueForUpdate is called outside transaction', async () => {
      const user = await prisma.user.create({
        data: { email: 'outside@example.com' },
      })

      await expect(prisma.user.findUniqueForUpdate({ where: { id: user.id } }))
        .rejects.toThrow(/must be called within a transaction/)
    })

    it('throws error when findFirstForUpdate is called outside transaction', async () => {
      await prisma.task.create({
        data: { title: 'Test Task' },
      })

      await expect(prisma.task.findFirstForUpdate({ where: { status: 'pending' } }))
        .rejects.toThrow(/must be called within a transaction/)
    })

    it('throws error when findManyForUpdate is called outside transaction', async () => {
      await prisma.task.create({
        data: { title: 'Test Task' },
      })

      await expect(prisma.task.findManyForUpdate({}))
        .rejects.toThrow(/must be called within a transaction/)
    })
  })

  describe('complex where clauses', () => {
    it('supports OR conditions', async () => {
      await prisma.user.createMany({
        data: [
          { email: 'a@example.com', balance: 100 },
          { email: 'b@example.com', balance: 200 },
          { email: 'c@example.com', balance: 300 },
        ],
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.user.findManyForUpdate({
          where: {
            OR: [{ balance: 100 }, { balance: 300 }],
          },
          orderBy: { balance: 'asc' },
        })
      })

      expect(result).toHaveLength(2)
      expect(result[0].balance).toBe(100)
      expect(result[1].balance).toBe(300)
    })

    it('supports AND conditions', async () => {
      await prisma.task.createMany({
        data: [
          { title: 'High Priority', status: 'pending', priority: 10 },
          { title: 'Low Priority', status: 'pending', priority: 1 },
          { title: 'High Done', status: 'done', priority: 10 },
        ],
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.task.findManyForUpdate({
          where: {
            AND: [{ status: 'pending' }, { priority: { gte: 5 } }],
          },
        })
      })

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('High Priority')
    })

    it('supports NOT conditions', async () => {
      await prisma.task.createMany({
        data: [
          { title: 'Pending', status: 'pending' },
          { title: 'Done', status: 'done' },
          { title: 'Cancelled', status: 'cancelled' },
        ],
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.task.findManyForUpdate({
          where: {
            NOT: { status: 'done' },
          },
          orderBy: { title: 'asc' },
        })
      })

      expect(result).toHaveLength(2)
      expect(result.map((t) => t.status)).not.toContain('done')
    })

    it('supports string operators', async () => {
      await prisma.user.createMany({
        data: [
          { email: 'admin@company.com' },
          { email: 'user@company.com' },
          { email: 'guest@other.com' },
        ],
      })

      const containsResult = await prisma.$transaction(async (tx) => {
        return tx.user.findManyForUpdate({
          where: { email: { contains: 'company' } },
        })
      })
      expect(containsResult).toHaveLength(2)

      const startsWithResult = await prisma.$transaction(async (tx) => {
        return tx.user.findManyForUpdate({
          where: { email: { startsWith: 'admin' } },
        })
      })
      expect(startsWithResult).toHaveLength(1)
      expect(startsWithResult[0].email).toBe('admin@company.com')

      const endsWithResult = await prisma.$transaction(async (tx) => {
        return tx.user.findManyForUpdate({
          where: { email: { endsWith: 'other.com' } },
        })
      })
      expect(endsWithResult).toHaveLength(1)
      expect(endsWithResult[0].email).toBe('guest@other.com')
    })

    it('supports in operator', async () => {
      await prisma.task.createMany({
        data: [
          { title: 'Task 1', status: 'pending' },
          { title: 'Task 2', status: 'in_progress' },
          { title: 'Task 3', status: 'done' },
          { title: 'Task 4', status: 'cancelled' },
        ],
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.task.findManyForUpdate({
          where: { status: { in: ['pending', 'in_progress'] } },
          orderBy: { title: 'asc' },
        })
      })

      expect(result).toHaveLength(2)
      expect(result[0].status).toBe('pending')
      expect(result[1].status).toBe('in_progress')
    })
  })

  describe('NOWAIT behavior', () => {
    it('throws error when row is locked and NOWAIT is used', async () => {
      const user = await prisma.user.create({
        data: { email: 'nowait@example.com', balance: 100 },
      })

      // Use a promise that we can resolve externally to coordinate timing
      let releaseLock: () => void
      const lockHeld = new Promise<void>((resolve) => {
        releaseLock = resolve
      })

      let lockAcquired: () => void
      const lockAcquiredPromise = new Promise<void>((resolve) => {
        lockAcquired = resolve
      })

      // Start a long transaction that locks the row
      const lockPromise = prisma.$transaction(async (tx) => {
        await tx.user.findUniqueForUpdate({
          where: { id: user.id },
        })
        // Signal that lock is acquired
        lockAcquired!()
        // Hold the lock until we're done
        await lockHeld
        return 'first'
      })

      // Wait for the lock to be acquired
      await lockAcquiredPromise

      // Try to lock the same row with NOWAIT - should fail immediately
      let nowaitError: Error | undefined
      try {
        await prisma.$transaction(async (tx) => {
          return tx.user.findUniqueForUpdate({
            where: { id: user.id },
            lock: { noWait: true },
          })
        })
      } catch (e) {
        nowaitError = e as Error
      }

      // Release the first transaction's lock
      releaseLock!()

      // The first transaction should succeed
      await expect(lockPromise).resolves.toBe('first')

      // The NOWAIT transaction should have failed with a lock error
      expect(nowaitError).toBeDefined()
      expect(nowaitError?.message).toMatch(/could not obtain lock|lock.*not.*available/i)
    })
  })

  describe('edge cases', () => {
    it('escapes LIKE wildcards in string operators', async () => {
      await prisma.user.createMany({
        data: [
          { email: 'user50@example.com', name: 'User 50' },
          { email: 'user100@example.com', name: 'User 100' },
          { email: 'user_underscore@example.com', name: 'User Underscore' },
        ],
      })

      // Test that % is treated as literal, not wildcard
      const percentResult = await prisma.$transaction(async (tx) => {
        return tx.user.findManyForUpdate({
          where: { email: { contains: '50%' } },
        })
      })
      // Should match emails containing literal "50%", not "50" followed by anything
      expect(percentResult).toHaveLength(0)

      // Test that _ is treated as literal, not wildcard
      const underscoreResult = await prisma.$transaction(async (tx) => {
        return tx.user.findManyForUpdate({
          where: { email: { contains: '_underscore' } },
        })
      })
      expect(underscoreResult).toHaveLength(1)
      expect(underscoreResult[0].email).toBe('user_underscore@example.com')
    })

    it('handles empty in array', async () => {
      await prisma.user.create({
        data: { email: 'test@example.com', balance: 100 },
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.user.findManyForUpdate({
          where: { id: { in: [] } },
        })
      })

      // Empty in array should return no results
      expect(result).toHaveLength(0)
    })

    it('handles empty notIn array', async () => {
      await prisma.user.createMany({
        data: [
          { email: 'user1@example.com', balance: 100 },
          { email: 'user2@example.com', balance: 200 },
        ],
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.user.findManyForUpdate({
          where: { id: { notIn: [] } },
        })
      })

      // Empty notIn array should return all rows
      expect(result).toHaveLength(2)
    })

    it('handles date values correctly', async () => {
      const testDate = new Date('2024-01-01T00:00:00Z')
      await prisma.user.create({
        data: { email: 'date@example.com', createdAt: testDate },
      })

      const result = await prisma.$transaction(async (tx) => {
        return tx.user.findUniqueForUpdate({
          where: { email: 'date@example.com' },
        })
      })

      expect(result).not.toBeNull()
      expect(result?.email).toBe('date@example.com')
      expect(result?.createdAt).toBeInstanceOf(Date)
    })

    it('throws error for unsupported mode: insensitive', async () => {
      await prisma.user.create({
        data: { email: 'test@example.com' },
      })

      await expect(
        prisma.$transaction(async (tx) => {
          return tx.user.findManyForUpdate({
            where: { email: { contains: 'test', mode: 'insensitive' } },
          })
        })
      ).rejects.toThrow(/Case-insensitive mode is not supported/)
    })
  })
})
