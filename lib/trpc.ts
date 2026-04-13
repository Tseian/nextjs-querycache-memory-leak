import { httpBatchLink } from '@trpc/client'
import { createTRPCNext } from '@trpc/next'
const { QueryCache } = require('@tanstack/react-query') as typeof import('@tanstack/react-query')
import type { AppRouter } from '@/server/api/root'

const isServer = typeof window === 'undefined'

// 服务端子类：强制所有 Query 的 cacheTime 为 Infinity，
// 阻止 scheduleGc() 创建 setTimeout，避免 GC 定时器钉住整个 QueryCache。
class ServerSafeQueryCache extends QueryCache {
  build(client: any, options: any, state?: any) {
    return super.build(client, { ...options, cacheTime: Infinity }, state)
  }
}

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
          refetchOnMount: false,
          refetchOnReconnect: false,
          refetchOnWindowFocus: false,
        },
      },
    }

    if (isServer) {
      queryClientConfig.queryCache = new ServerSafeQueryCache()
    } else {
      // 客户端：给 queryCache 打上 debug_id，方便调试
      const queryCache = new QueryCache()
      ;(queryCache as any)['debug_id'] = `trpc-query-cache-${index++}`
      queryClientConfig.queryCache = queryCache
    }

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
