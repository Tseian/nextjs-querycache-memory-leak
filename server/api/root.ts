import { exampleRouter } from './routers/example'
import { router } from '@/server/trpc/trpc'
require("../../scripts/heap-snapshot.cjs")
export const appRouter = router({
  example: exampleRouter,
})

export type AppRouter = typeof appRouter
