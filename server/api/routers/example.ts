import { z } from 'zod'

import { publicProcedure, router } from '@/server/trpc/trpc'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
export const exampleRouter = router({
  hello: publicProcedure
    .input(
      z.object({
        name: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      await sleep(200)
      const name = input.name?.trim() || 'world'
      return {
        greeting: `Hello, ${name}!`,
        serverTimeISO: new Date().toISOString(),
      }
    }),
  hello1: publicProcedure
    .input(
      z.object({
        name: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      await sleep(200)
      const name = input.name?.trim() || 'world'
      return {
        greeting: `Hello, ${name}!`,
        serverTimeISO: new Date().toISOString(),
      }
    }),
})
