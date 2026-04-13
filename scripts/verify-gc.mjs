/**
 * 验证 QueryCache 在不同 cacheTime 下的 GC 行为
 * 直接用 @tanstack/query-core 模拟服务端 withTRPC 的行为
 */

import { QueryClient, QueryCache, hydrate, dehydrate } from '@tanstack/query-core'

// 模拟 isServer 环境（Node.js 下 typeof window === 'undefined'）

const registry = new FinalizationRegistry((id) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`  [${elapsed}s] ✅ QueryCache "${id}" 已被 GC 回收`)
})

let startTime

/**
 * 模拟一次 SSR 请求：
 * 1. 创建 QueryClient + QueryCache（withTRPC 的 config()）
 * 2. hydrate 300 个查询（Hydrate 组件的 useMemo）
 * 3. 创建 1 个带有指定 cacheTime 的查询（SeedQuery 的 useQuery）
 * 4. 丢弃所有引用，观察 GC 何时回收
 */
function simulateSSRRequest(id, cacheTime) {
  const queryCache = new QueryCache()
  registry.register(queryCache, id)

  const queryClient = new QueryClient({ queryCache })

  // 模拟 getServerSideProps 的 dehydrate 数据
  const prefetchClient = new QueryClient()
  for (let i = 0; i < 300; i++) {
    prefetchClient.getQueryCache().build(prefetchClient, {
      queryKey: ['hello', { name: `prefetched-${i}` }],
      queryHash: `["hello",{"name":"prefetched-${i}"}]`,
    }, {
      data: { greeting: `Hello, prefetched-${i}!` },
      dataUpdateCount: 1,
      dataUpdatedAt: Date.now(),
      error: null,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      fetchFailureCount: 0,
      fetchFailureReason: null,
      fetchMeta: null,
      isInvalidated: false,
      status: 'success',
      fetchStatus: 'idle',
    })
  }
  const dehydratedState = dehydrate(prefetchClient)
  prefetchClient.clear()

  // 模拟 <Hydrate> 的 useMemo：服务端同步 hydrate
  hydrate(queryClient, dehydratedState)

  // 模拟 SeedQuery 的 useQuery → queryCache.build() with cacheTime
  queryCache.build(queryClient, {
    queryKey: ['hello1', { name: 'seed' }],
    queryHash: '["hello1",{"name":"seed"}]',
    cacheTime: cacheTime,
    enabled: false,
  }, {
    data: undefined,
    dataUpdateCount: 0,
    dataUpdatedAt: 0,
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: false,
    status: 'loading',
    fetchStatus: 'idle',
  })

  const totalQueries = queryCache.getAll().length
  console.log(`  QueryCache "${id}": ${totalQueries} 个查询, cacheTime=${cacheTime}`)

  // SSR 结束后丢弃所有引用
  // queryClient 和 queryCache 不再被引用
}

async function main() {
  console.log('=== 验证 QueryCache GC 行为 ===\n')
  startTime = Date.now()

  console.log('场景 1: cacheTime = Infinity')
  simulateSSRRequest('infinity-cache', Infinity)

  console.log('\n场景 2: cacheTime = 5000 (5秒)')
  simulateSSRRequest('5s-cache', 5000)

  console.log('\n场景 3: cacheTime = 10000 (10秒)')
  simulateSSRRequest('10s-cache', 10000)

  console.log('\n--- 开始观察 GC 行为 (等待 15 秒) ---\n')

  // 定期触发 GC
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000))
    if (global.gc) {
      global.gc()
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    if (i % 3 === 2) {
      console.log(`  [${elapsed}s] 触发 GC...`)
    }
  }

  console.log('\n=== 测试结束 ===')
}

main()
