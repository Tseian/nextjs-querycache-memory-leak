# Next.js + tRPC + React Query 服务端 QueryCache 内存泄漏分析

## 问题概述

在 Next.js Pages Router + tRPC (`ssr: false`) + React Query v4 的架构下，当组件中 `useQuery` 显式传入有限的 `cacheTime`（如 60 秒）时，每个 SSR 请求创建的 `QueryCache` 会被一个 `setTimeout` 钉在服务端内存中，直到 `cacheTime` 到期才能被 V8 GC 回收。

在高并发场景下，大量请求的 QueryCache 同时滞留，表现为服务端内存持续上涨。

### 现象

| `cacheTime` | QueryCache 被 GC 回收时间 | 高并发表现 |
|---|---|---|
| `Infinity` | **< 1 秒**（几乎立即） | 内存平稳 |
| `60s` | **精确 60 秒后** | 内存持续累积，60 秒后才开始回落 |

---

## 根因分析

### 1. `ssr: false` 不等于"服务端不执行 React 组件"

`createTRPCNext` 的 `ssr: false` 仅控制是否注入 `getInitialProps` 做 tRPC 自动数据预取（prepass 循环）。**Next.js 仍然会 SSR 渲染整棵 React 组件树**来生成初始 HTML。

```tsx
// withTRPC.tsx:139 — ssr: false 时这个 if 不进入
if (AppOrPage.getInitialProps ?? opts.ssr) {
  WithTRPC.getInitialProps = async () => { /* prepass 循环 */ }
}

// 但 WithTRPC 组件体（:92-136）每次 SSR 都执行：
const WithTRPC = (props) => {
  const [prepassProps] = useState(() => {
    const config = getClientConfig({});      // ← 每次请求都调用 config()
    const queryClient = getQueryClient(config); // ← 每次创建新 QueryClient
    ...
  });
  return (
    <QueryClientProvider client={queryClient}>
      <Hydrate state={hydratedState}>         {/* useMemo → 服务端同步执行 */}
        <AppOrPage {...props} />
      </Hydrate>
    </QueryClientProvider>
  );
};
```

### 2. 同一份数据在服务端存在三份拷贝

```
tRPC procedure 返回数据
       │
       ▼
  QueryClient-A（createServerSideHelpers 专用）
  ├─ 300 个 query.state.data
  └─ helpers.dehydrate() → JSON 序列化 → helpers.queryClient.clear() ✅ 已清理
       │
       ▼
  trpcState（序列化的 JSON，随 props 传输）
       │
       ├─────────────────────────┐
       ▼                         ▼
  服务端 SSR 渲染              客户端 hydrate
  <Hydrate useMemo>            <Hydrate useMemo>
       │                         │
       ▼                         ▼
  QueryCache-B（服务端）       QueryCache-C（客户端）
  301 个 Query 带 data         301 个 Query 带 data
  ⚠️ 被 setTimeout 钉住       ✅ 正常使用
```

**QueryCache-B 就是泄漏源头**——它的使命在 `renderToString` 结束后就完成了，本应立即被 V8 GC 回收。

### 3. `setTimeout` 引用链阻止 GC

`<Hydrate>` 使用 `useMemo`（不是 `useEffect`）在服务端同步注入 300 个查询。当组件的 `useQuery` 传入有限 `cacheTime` 时，`Query` 构造函数中的 `scheduleGc()` 创建 `setTimeout`：

```
// @tanstack/query-core — removable.ts
protected scheduleGc(): void {
  if (isValidTimeout(this.cacheTime)) {         // Infinity → false → 不创建定时器
    this.gcTimeout = setTimeout(() => {          // 60000 → true → 创建定时器
      this.optionalRemove()
    }, this.cacheTime)
  }
}

// utils.ts
function isValidTimeout(value) {
  return typeof value === 'number' && value >= 0 && value !== Infinity
}
```

这个 `setTimeout` 形成的引用链：

```
Node.js 定时器列表（GC Root）
  └─ setTimeout 回调闭包
       └─ this（= hello1 Query 对象）
            └─ this.cache（= QueryCache-B）
                 └─ this.queriesMap
                      ├─ Query: hello/prefetched-0   → state.data: {...}
                      ├─ Query: hello/prefetched-1   → state.data: {...}
                      ├─ ...（共 300 个 hydrate 注入的查询）
                      └─ Query: hello1/seed          → （触发 setTimeout 的查询）
```

**一个 Query 的定时器 → 拖住整个 QueryCache → 拖住所有 301 个 Query 及其数据。**

### 4. React Query 的服务端保护被显式 `cacheTime` 绕过

React Query 在 `updateCacheTime` 中特意为服务端设了 `Infinity` 默认值来防止这个问题：

```typescript
// removable.ts
protected updateCacheTime(newCacheTime: number | undefined): void {
  this.cacheTime = Math.max(
    this.cacheTime || 0,
    newCacheTime ?? (isServer ? Infinity : 5 * 60 * 1000),
    //               ^^^^^^^^ 服务端默认 Infinity，不会产生定时器
  )
}
```

但当组件 **显式传入** `cacheTime: 60000` 时，`newCacheTime` 不是 `undefined`，`??` 右侧不会触发，保护机制被绕过。

---

## 解决方案

### 推荐方案：ServerSafeQueryCache

子类化 `QueryCache`，在服务端的 `build()` 方法中强制 `cacheTime: Infinity`：

```typescript
// lib/trpc.ts
const isServer = typeof window === 'undefined'

class ServerSafeQueryCache extends QueryCache {
  build(client: any, options: any, state?: any) {
    return super.build(client, { ...options, cacheTime: Infinity }, state)
  }
}

export const trpc = createTRPCNext<AppRouter>({
  config(opts) {
    const queryClientConfig = { /* ... */ }

    if (isServer) {
      queryClientConfig.queryCache = new ServerSafeQueryCache()
    } else {
      queryClientConfig.queryCache = new QueryCache()
    }

    return { queryClientConfig, links: [/* ... */] }
  },
  ssr: false,
})
```

**为什么这是最优解：**

| 特性 | 说明 |
|---|---|
| 全局兜底 | 不管组件传什么 `cacheTime`，服务端一律 `Infinity`，从源头阻止 `setTimeout` |
| 不影响客户端 | `isServer` 判断确保客户端行为完全不变 |
| 不改业务代码 | 组件里的 `useQuery` 参数不用动 |
| 原理正确 | 利用 React Query 自身的 `isValidTimeout(Infinity) === false` 机制 |

### 其他可选方案

| 方案 | 做法 | 优点 | 局限 |
|---|---|---|---|
| 组件级防护 | `cacheTime: typeof window === 'undefined' ? Infinity : 60000` | 最小改动 | 每个 `useQuery` 都要加，易遗漏 |
| `next/dynamic ssr:false` | 用 `dynamic(() => ..., { ssr: false })` 包裹组件 | 彻底不在服务端执行 | 该组件 SSR 不产出 HTML |
| `defaultOptions` 设默认值 | `defaultOptions.queries.cacheTime = Infinity`（仅服务端） | 全局默认 | 无法拦截组件显式传入的 `cacheTime` |

---

## 验证方法

### 脚本验证

使用 `FinalizationRegistry` 追踪 `QueryCache` 对象的 GC 回收时机：

```bash
node --expose-gc scripts/verify-fix.cjs
```

预期输出：

```
❌ 原始 QueryCache（组件传 cacheTime: 60000）
  原始-QueryCache: 301 个查询, 实际 cacheTime=60000

✅ ServerSafeQueryCache（强制 cacheTime: Infinity）
  修复-ServerSafeQueryCache: 301 个查询, 实际 cacheTime=Infinity

--- 观察 GC ---

  [1.0s] ✅ 修复-ServerSafeQueryCache 已被 GC 回收
  （原始-QueryCache 需等待 60s 后才会被回收）
```

### Heap Snapshot 验证

```bash
HEAP_SNAPSHOT_INTERVAL_MS=10000 pnpm dev
```

访问页面多次后，对比 `snapshots/` 目录中的堆快照：
- 修复前：QueryCache 及其 301 个 Query 在快照中持续存在
- 修复后：QueryCache 在下一次快照前已被回收

---

## 涉及的关键源码

| 文件 | 关键逻辑 |
|---|---|
| `@trpc/next/src/withTRPC.tsx:92-136` | `WithTRPC` 组件体，每次 SSR 创建新 QueryClient |
| `@trpc/next/src/withTRPC.tsx:139` | `ssr: false` 仅控制是否注入 `getInitialProps` |
| `@tanstack/react-query/src/Hydrate.tsx:22` | `useMemo` 在服务端同步执行 `hydrate()` |
| `@tanstack/query-core/src/removable.ts:11-19` | `scheduleGc()` — 创建 GC 定时器 |
| `@tanstack/query-core/src/removable.ts:21-27` | `updateCacheTime()` — 服务端默认 `Infinity` |
| `@tanstack/query-core/src/utils.ts:86-88` | `isValidTimeout()` — `Infinity` 返回 `false` |
| `@tanstack/query-core/src/query.ts:176` | `Query` 构造函数调用 `scheduleGc()` |
| `@tanstack/query-core/src/hydration.ts:157` | `hydrate()` 调用 `queryCache.build()` 注入查询 |

## 适用版本

- `@tanstack/react-query` ^4.x（使用 `cacheTime`；v5 中已重命名为 `gcTime`，机制相同）
- `@trpc/next` ^10.x（Pages Router + `withTRPC` HOC）
- `next` ^13.x / ^14.x / ^15.x（Pages Router with `getServerSideProps`）
