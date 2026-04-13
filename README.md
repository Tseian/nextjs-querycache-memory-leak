# nextjs-querycache-leak

本仓库用于复现并解释一个 Next.js + tRPC + TanStack Query 的内存现象：
同一页面每次 SSR 都会 prefetch 一批相似数据；当 `QueryCache` 中存在 `cacheTime` 较长的 inactive query 时，prefetch 数据无法及时释放，堆内存会在一段时间内持续抬高。

## 当前代码（严格对应）

1. `pages/index.tsx` 的 `getServerSideProps` 中，每次请求都会：
- 创建新的 `createServerSideHelpers(...)`
- 并发 prefetch 300 次 `example.hello`（`name=prefetched-${i}`）
- 执行 `helpers.dehydrate()`
- 执行 `helpers.queryClient.clear()`

2. 同一页面客户端会挂载一个 `SeedQuery`（`example.hello1.useQuery`）：
- `enabled: false`
- `cacheTime: LONG_CACHE_TIME`
- 1.2 秒后组件卸载，使其进入 inactive

3. 堆快照通过 `server/api/root.ts` 顶层 `require("../../scripts/heap-snapshot.cjs")` 启用：
- 启动后立即抓一次
- 然后按 `HEAP_SNAPSHOT_INTERVAL_MS` 周期抓取

## 核心结论

- `LONG_CACHE_TIME = Infinity` 时，`QueryClient/QueryCache` 更快变为不可达，prefetch 相关对象更快回收。
- `LONG_CACHE_TIME = 60s` 时，通常要等约 60 秒窗口结束后，`QueryClient/QueryCache` 及其挂载的数据才明显下降。

## 核心原因（本仓库要点）

- prefetch 到的数据在注入 `QueryCache` 后，在堆中表现为依附于该 `QueryCache` 的生命周期（可在快照中观察到：`QueryCache` 未释放前，这批数据通常不会整体消失）。
- 只要 `QueryCache` 因为长 `cacheTime` 的 inactive query 仍被定时器链路保持可达，这批 prefetch 数据就不会及时释放。
- 同一页面每次 SSR 都会重复创建一份新的 helpers/query cache，并重复 prefetch 300 份相似数据。
- 在高请求量下，这些“上一批尚未释放 + 新一批持续进入”会叠加，表现为线上缓存体积快速膨胀。

> 这更接近“延迟回收导致的堆积”，而非永久不可回收的经典泄漏。

## 复现步骤

1. 安装依赖

```bash
pnpm install
```

2. 在 `pages/index.tsx` 切换：
- 快速回收场景：`const LONG_CACHE_TIME = Infinity`
- 延迟回收场景：`const LONG_CACHE_TIME = 1000 * 60`

3. 启动

```bash
pnpm dev
```

4. 访问页面并连续刷新

```text
http://localhost:3000/
```

5. 观察 `snapshots/` 与堆趋势
- `Infinity`：回落更快
- `60s`：存在明显滞留窗口，约 60 秒后才回落

## 线上意义

- 当服务端按请求创建 `QueryClient`，且存在较长 `cacheTime` 的 inactive query 时，prefetch 数据会随 `QueryCache` 生命周期一起滞留。
- 如果 QPS 较高，这种滞留会跨请求叠加，形成“缓存暴涨”的线上体感。

## 优化建议

建议按执行环境设置 `cacheTime`：server 端使用 `Infinity`，client 端使用业务可接受的有限值。

```ts
const cacheTime = typeof window === 'undefined' ? Infinity : TRPC_CACHE_TIME
trpc.xx.xx.useQuery(input, {
  cacheTime,
  ssr: false,
})
```
