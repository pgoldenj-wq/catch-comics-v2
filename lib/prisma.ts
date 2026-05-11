/**
 * Prisma client singleton — shared across all API routes and server components.
 *
 * Next.js hot-reload creates new module instances in development, which would
 * exhaust the Postgres connection pool. The globalThis pattern reuses the
 * existing client across hot reloads without leaking connections.
 *
 * Usage:
 *   import { prisma } from '@/lib/prisma'
 *   const product = await prisma.canonicalProduct.findUnique({ where: { id } })
 */

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
