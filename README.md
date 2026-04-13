# nextjs-querycache-leak

这个仓库用于复现并解释一个在 Next.js 线上常见的现象：
当每个请求都会创建新的 `QueryClient`/`QueryCache` 时，`cacheTime` 的设置会显著影响它们被 GC 回收的时机，进而影响内存峰值。

## 结论先说

- 当 `LONG_CACHE_TIME = Infinity` 时，`QueryClient` 和 `QueryCache` 很快可被释放，内存回收更及时。
- 当 `LONG_CACHE_TIME = 60s` 时，需要大约 60 秒后，相关对象才明显可回收。
- 在高并发下，`60s` 这种延迟释放会让很多“已结束请求的缓存对象”同时驻留在堆中，形成线上“缓存暴涨”。

## 代码对应关系

- SSR 每次请求创建 tRPC helpers：`createServerSideHelpers(...)`
  - 位置：[trpc-example.tsx](file:///Users/tseian/Downloads/project/nextjs-querycache-leak/pages/trpc-example.tsx#L16-L25)
- 请求结束前执行 `helpers.queryClient.clear()`：
  - 位置：[trpc-example.tsx](file:///Users/tseian/Downloads/project/nextjs-querycache-leak/pages/trpc-example.tsx#L24-L26)
- 前端一次性 mount 300 个 disabled query，再在 1.2s 后 unmount：
  - 位置：[trpc-example.tsx](file:///Users/tseian/Downloads/project/nextjs-querycache-leak/pages/trpc-example.tsx#L34-L69)
- 每个 query 的 `cacheTime` 来自 `LONG_CACHE_TIME`：
  - 位置：[trpc-example.tsx](file:///Users/tseian/Downloads/project/nextjs-querycache-leak/pages/trpc-example.tsx#L12-L14), [trpc-example.tsx](file:///Users/tseian/Downloads/project/nextjs-querycache-leak/pages/trpc-example.tsx#L38-L41)
- 堆快照脚本（按间隔输出）：
  - 位置：[heap-snapshot.cjs](file:///Users/tseian/Downloads/project/nextjs-querycache-leak/scripts/heap-snapshot.cjs)

## 如何复现

1. 安装依赖

```bash
pnpm install
```

2. 在 `pages/trpc-example.tsx` 切换 `LONG_CACHE_TIME`

- 场景 A（快速回收）：`const LONG_CACHE_TIME = Infinity`
- 场景 B（延迟回收）：`const LONG_CACHE_TIME = 1000 * 60`

3. 启动应用并开启堆快照注入（推荐）

```bash
HEAP_SNAPSHOT_INTERVAL_MS=10000 NODE_OPTIONS="--require ./scripts/heap-snapshot.cjs" pnpm dev
```

4. 访问复现页面

- 打开 `http://localhost:3000/trpc-example`
- 多刷新几次，制造更多请求与 query 实例

5. 观察 `snapshots/` 与堆变化

- `Infinity`：请求结束后，对象更快消失
- `60s`：会保留一个明显的“滞留窗口”，约 60 秒后才下降

## 为什么会这样

核心不是“有没有 clear”，而是“是否还有活跃引用链”。

- `helpers.queryClient.clear()` 只是在逻辑上清空缓存内容，不等于立刻让整棵对象图可回收。
- 当 `cacheTime = 60s` 时，query 生命周期进入 inactive 状态后会关联定时器窗口；这些定时器/回调链会让 query 及其关联结构在窗口期内继续可达，其他 prefetch 的 query 也会保持可达。
- 当 `cacheTime = Infinity` 时，不会建立这类短期 GC 定时回收链路（没有 60s 的 timer 窗口），对象在请求结束后更容易整体变成不可达，从而更快被 V8 回收。

[refer](refer.jpg)


## 对 Next.js 线上现象的解释

在 Next.js（尤其 SSR/请求级创建客户端）里，如果每个请求都生成新的 `QueryClient`，且 `cacheTime` 是有限值（如 60s）：

- 每个请求留下的一批 query 对象会“再活 60s”
- 高 QPS 下，不同请求的 60s 窗口叠加
- 堆里同时存在大量本应短命的缓存对象
- 最终表现为内存持续上升、波峰明显、回落滞后（看起来像“缓存泄漏/暴涨”）

这通常不是传统意义上的永久泄漏，而是“有限缓存时间 + 高并发”导致的延迟回收堆积。

## 实践建议

- 在 server 端设置 cacheTime 为 `Infinity` 以快速回收。
- 排查时优先确认：对象是“最终会回收但滞后”，还是“始终可达的真正泄漏”。
