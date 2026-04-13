/**
 * 验证修复后的 GC 行为：服务端强制 cacheTime = Infinity
 */

const corePath = require.resolve('@tanstack/react-query')
const { QueryClient, QueryCache, hydrate, dehydrate } = require(
  require.resolve('@tanstack/query-core', { paths: [corePath] })
)

const registry = new FinalizationRegistry((id) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`  [${elapsed}s] ✅ QueryCache "${id}" 已被 GC 回收`)
})

let startTime

function simulateSSRRequest(id, componentCacheTime, useServerGuard) {
  const queryCache = new QueryCache()
  registry.register(queryCache, id)

  const isServer = typeof window === 'undefined'
  // 修复：服务端强制 cacheTime = Infinity
  const effectiveCacheTime = (useServerGuard && isServer) ? Infinity : componentCacheTime

  const queryClient = new QueryClient({ queryCache })

  // hydrate 300 个查询
  const prefetchClient = new QueryClient()
  for (let i = 0; i < 300; i++) {
    prefetchClient.getQueryCache().build(prefetchClient, {
      queryKey: ['hello', { name: `prefetched-${i}` }],
      queryHash: `["hello",{"name":"prefetched-${i}"}]`,
    }, {
      data: { greeting: `Hello, prefetched-${i}!` },
      dataUpdateCount: 1, dataUpdatedAt: Date.now(),
      error: null, errorUpdateCount: 0, errorUpdatedAt: 0,
      fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null,
      isInvalidated: false, status: 'success', fetchStatus: 'idle',
    })
  }
  hydrate(queryClient, dehydrate(prefetchClient))
  prefetchClient.clear()

  // SeedQuery 的查询
  queryCache.build(queryClient, {
    queryKey: ['hello1', { name: 'seed' }],
    queryHash: '["hello1",{"name":"seed"}]',
    cacheTime: effectiveCacheTime,
    enabled: false,
  }, {
    data: undefined, dataUpdateCount: 0, dataUpdatedAt: 0,
    error: null, errorUpdateCount: 0, errorUpdatedAt: 0,
    fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null,
    isInvalidated: false, status: 'loading', fetchStatus: 'idle',
  })

  const label = useServerGuard ? '(已修复)' : '(未修复)'
  console.log(`  QueryCache "${id}" ${label}: 301 查询, 组件传入 cacheTime=${componentCacheTime}, 实际使用=${effectiveCacheTime}`)
}

async function main() {
  console.log('=== 修复前后对比 ===\n')
  startTime = Date.now()

  console.log('❌ 未修复: cacheTime = 60000 直接传入')
  simulateSSRRequest('broken-60s', 60000, false)

  console.log('\n✅ 修复后: 服务端强制 cacheTime = Infinity')
  simulateSSRRequest('fixed-60s', 60000, true)

  console.log('\n--- 开始观察 GC (等待 8 秒) ---\n')

  for (let i = 1; i <= 8; i++) {
    await new Promise(r => setTimeout(r, 1000))
    if (global.gc) global.gc()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    if (i % 2 === 0) console.log(`  [${elapsed}s] 手动触发 GC...`)
  }

  console.log('\n  (broken-60s 需要等到 60s 后才会被回收，这里不等了)')
  console.log('\n=== 对比结束 ===')
}

main()
