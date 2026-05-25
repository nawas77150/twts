import { PrismaClient } from '@prisma/client'
import { debug } from '@/lib/debug'

const DEBUG_DB = !!process.env.DEBUG_DB

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: DEBUG_DB
      ? [{ emit: 'event', level: 'query' }]
      : process.env.NODE_ENV === 'development'
        ? ['query']
        : ['error'],
  })

if (DEBUG_DB && !globalForPrisma.prisma) {
  // Type assertion: $on('query') is only typed when log includes { emit: 'event', level: 'query' }.
  // The guard above guarantees this configuration, but TS can't infer it through the conditional.
  ;(db as unknown as { $on: (event: 'query', handler: (e: { query: string; duration: number; params: string }) => void) => void }).$on('query', (e) => {
    debug('db', `${e.query} — ${e.duration}ms`)
  })
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
