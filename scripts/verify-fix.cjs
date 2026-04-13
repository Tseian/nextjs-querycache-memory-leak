/**
 * 验证 ServerSafeQueryCache 修复效果
 * 模拟组件显式传入 cacheTime: 60000 的场景
 */

const corePath = require.resolve('@tanstack/react-query')
const { QueryClient, QueryCache, hydrate, dehydrate } = require(
  require.resolve('@tanstack/query-core', { paths: [corePath] })
)

// 复现修复方案：子类化 QueryCache
class ServerSafeQueryCache extends QueryCache {
  build(client, options, state) {
    return super.build(client, { ...options, cacheTime: Infinity }, state)
  }
}

const registry = new FinalizationRegistry((id) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`  [${elapsed}s] ✅ ${id} 已被 GC 回收`)
})

let startTime

function simulateSSR(id, CacheClass) {
  const queryCache = new CacheClass()
  registry.register(queryCache, id)
  const queryClient = new QueryClient({ queryCache })

  // hydrate 300 个 prefetch 查询
  const prefetchClient = new QueryClient()
  for (let i = 0; i < 300; i++) {
    prefetchClient.getQueryCache().build(prefetchClient, {
      queryKey: ['hello', { name: `p-${i}` }],
      queryHash: `["hello",{"name":"p-${i}"}]`,
    }, {
      data: { greeting: `Hello, p-${i}!` },
      dataUpdateCount: 1, dataUpdatedAt: Date.now(),
      error: null, errorUpdateCount: 0, errorUpdatedAt: 0,
      fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null,
      isInvalidated: false, status: 'success', fetchStatus: 'idle',
    })
  }
  hydrate(queryClient, dehydrate(prefetchClient))
  prefetchClient.clear()

  // 组件显式传入 cacheTime: 60000（这是触发泄漏的关键）
  queryCache.build(queryClient, {
    queryKey: ['hello1', { name: 'seed' }],
    queryHash: '["hello1",{"name":"seed"}]',
    cacheTime: 60000,  // ← 组件传入的值
    enabled: false,
  }, {
    data: undefined, dataUpdateCount: 0, dataUpdatedAt: 0,
    error: null, errorUpdateCount: 0, errorUpdatedAt: 0,
    fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null,
    isInvalidated: false, status: 'loading', fetchStatus: 'idle',
  })

  // 验证 cacheTime 是否被正确覆盖
  const seedQuery = queryCache.getAll().find(q => q.queryHash.includes('hello1'))
  console.log(`  ${id}: ${queryCache.getAll().length} 个查询, 实际 cacheTime=${seedQuery.cacheTime}`)
}

async function main() {
  console.log('=== ServerSafeQueryCache 修复验证 ===\n')
  startTime = Date.now()

  console.log('❌ 原始 QueryCache（组件传 cacheTime: 60000）')
  simulateSSR('原始-QueryCache', QueryCache)

  console.log('\n✅ ServerSafeQueryCache（强制 cacheTime: Infinity）')
  simulateSSR('修复-ServerSafeQueryCache', ServerSafeQueryCache)

  console.log('\n--- 观察 GC (8 秒) ---\n')

  for (let i = 1; i <= 8; i++) {
    await new Promise(r => setTimeout(r, 1000))
    if (global.gc) global.gc()
    if (i % 2 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`  [${elapsed}s] 手动触发 GC...`)
    }
  }

  console.log('\n=== 验证结束 ===')
}

main()
