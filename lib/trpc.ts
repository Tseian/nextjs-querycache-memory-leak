import { httpBatchLink } from '@trpc/client'
import { createTRPCNext } from '@trpc/next'
const { QueryCache } = require('@tanstack/react-query') as typeof import('@tanstack/react-query')
import type { AppRouter } from '@/server/api/root'

function getBaseUrl() {
  if (typeof window !== 'undefined') return ''
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return `http://localhost:${process.env.PORT ?? 3000}`
}
let index = 0
export const trpc = createTRPCNext<AppRouter>({
  config(opts) {
    const queryClientConfig: any = {
      defaultOptions: {
        queries: {
          // staleTime: 60_000,
          // cacheTime: 60_000,
          refetchOnMount: false,
          refetchOnReconnect: false,
          refetchOnWindowFocus: false,
        },
      },
    }
// 给 queryCache 打上 debug_id ，方便调试
    const queryCache = new QueryCache();
    (queryCache as any)["debug_id"] = `trpc-query-cache-${index++}`
    queryClientConfig.queryCache = queryCache

    return {
      queryClientConfig,
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          fetch: async (input, init) => {
            if (typeof window !== 'undefined') {
              ; (globalThis as any).__trpcFetchCount = ((globalThis as any).__trpcFetchCount ?? 0) + 1
            }
            return globalThis.fetch(input as any, init as any)
          },
        }),
      ],
    }
  },
  ssr: false,
})
