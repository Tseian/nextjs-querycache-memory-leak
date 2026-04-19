# Next.js + tRPC + React Query Server-Side QueryCache Memory Leak Analysis

## Problem Overview

In a Next.js Pages Router + tRPC (`ssr: false`) + React Query v4 setup, when `useQuery` explicitly passes a finite `cacheTime` (for example, 60 seconds), the `QueryCache` created per SSR request is pinned in server memory by a `setTimeout`, and cannot be collected by V8 GC until `cacheTime` expires.

Under high concurrency, many request-level `QueryCache` instances are retained at the same time, causing continuously increasing server memory usage.

### Symptoms

| `cacheTime` | QueryCache GC timing | High-concurrency behavior |
|---|---|---|
| `Infinity` | **< 1s** (almost immediate) | Stable memory |
| `60s` | **Exactly after 60s** | Memory keeps accumulating and only starts dropping after ~60s |

---

## Root Cause Analysis

### 1. `ssr: false` does not mean "React components do not run on the server"

In `createTRPCNext`, `ssr: false` only controls whether `getInitialProps` is injected for tRPC auto-prefetch (the prepass loop). **Next.js still SSR-renders the entire React tree** to produce initial HTML.

```tsx
// withTRPC.tsx:139 — this branch is skipped when ssr: false
if (AppOrPage.getInitialProps ?? opts.ssr) {
  WithTRPC.getInitialProps = async () => { /* prepass loop */ }
}

// But the WithTRPC component body (:92-136) still runs on every SSR request:
const WithTRPC = (props) => {
  const [prepassProps] = useState(() => {
    const config = getClientConfig({});         // <- config() is called per request
    const queryClient = getQueryClient(config); // <- new QueryClient per request
    ...
  });
  return (
    <QueryClientProvider client={queryClient}>
      <Hydrate state={hydratedState}>           {/* useMemo -> sync execution on server */}
        <AppOrPage {...props} />
      </Hydrate>
    </QueryClientProvider>
  );
};
```

### 2. The same data exists in three copies on the server

```
Data returned by tRPC procedure
       |
       v
  QueryClient-A (for createServerSideHelpers only)
  |- 300 query.state.data entries
  `- helpers.dehydrate() -> JSON serialize -> helpers.queryClient.clear()  ✅ cleared
       |
       v
  trpcState (serialized JSON passed via props)
       |
       |-------------------------.
       v                         v
  Server-side SSR render        Client hydrate
  <Hydrate useMemo>             <Hydrate useMemo>
       |                         |
       v                         v
  QueryCache-B (server)         QueryCache-C (client)
  301 Queries with data         301 Queries with data
  pinned by setTimeout          normal runtime behavior
```

**QueryCache-B is the leak source**: its lifecycle should end right after `renderToString`, and it should be reclaimable immediately by V8 GC.

### 3. The `setTimeout` reference chain blocks GC

`<Hydrate>` uses `useMemo` (not `useEffect`) and synchronously injects 300 queries on the server. If a component `useQuery` passes a finite `cacheTime`, `scheduleGc()` in the `Query` constructor creates a `setTimeout`:

```
// @tanstack/query-core — removable.ts
protected scheduleGc(): void {
  if (isValidTimeout(this.cacheTime)) {         // Infinity -> false -> no timer
    this.gcTimeout = setTimeout(() => {         // 60000   -> true  -> timer created
      this.optionalRemove()
    }, this.cacheTime)
  }
}

// utils.ts
function isValidTimeout(value) {
  return typeof value === 'number' && value >= 0 && value !== Infinity
}
```

This `setTimeout` creates the following retention chain:

```
Node.js timer list (GC Root)
  `- setTimeout callback closure
       `- this (= hello1 Query object)
            `- this.cache (= QueryCache-B)
                 `- this.queriesMap
                      |- Query: hello/prefetched-0   -> state.data: {...}
                      |- Query: hello/prefetched-1   -> state.data: {...}
                      |- ... (300 hydrated queries total)
                      `- Query: hello1/seed          -> (the Query that created setTimeout)
```

**A timer on one Query retains the entire QueryCache, which retains all 301 Queries and their data.**

### 4. React Query's server-side safeguard is bypassed by explicit `cacheTime`

React Query intentionally defaults server-side cache time to `Infinity` in `updateCacheTime` to avoid this:

```typescript
// removable.ts
protected updateCacheTime(newCacheTime: number | undefined): void {
  this.cacheTime = Math.max(
    this.cacheTime || 0,
    newCacheTime ?? (isServer ? Infinity : 5 * 60 * 1000),
    //               ^^^^^^^^ server default is Infinity, so no timer
  )
}
```

However, when a component **explicitly passes** `cacheTime: 60000`, `newCacheTime` is no longer `undefined`, so the right side of `??` is never used, and the safeguard is bypassed.

---

## Solution

### Recommended: `ServerSafeQueryCache`

Subclass `QueryCache` and force `cacheTime: Infinity` in server-side `build()`:

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

**Why this is the best option:**

| Feature | Explanation |
|---|---|
| Global guardrail | No matter what components pass as `cacheTime`, server-side is forced to `Infinity`, blocking `setTimeout` at the source |
| No client impact | `isServer` gating keeps client behavior unchanged |
| No business-code churn | No need to edit every `useQuery` call |
| Mechanically correct | Uses React Query's built-in `isValidTimeout(Infinity) === false` behavior |

### Other options

| Option | How | Pros | Limits |
|---|---|---|---|
| Component-level guard | `cacheTime: typeof window === 'undefined' ? Infinity : 60000` | Minimal local change | Must be added to every `useQuery`, easy to miss |
| `next/dynamic ssr:false` | Wrap component via `dynamic(() => ..., { ssr: false })` | Completely avoids server execution for that component | No SSR HTML output for that component |
| `defaultOptions` fallback | `defaultOptions.queries.cacheTime = Infinity` (server only) | Global default | Cannot override explicit component-level `cacheTime` |

---

## Validation

### Script validation

Use `FinalizationRegistry` to track when `QueryCache` is GC-collected:

```bash
node --expose-gc scripts/verify-fix.cjs
```

Expected output:

```
❌ Original QueryCache (component uses cacheTime: 60000)
  Original-QueryCache: 301 queries, effective cacheTime=60000

✅ ServerSafeQueryCache (forced cacheTime: Infinity)
  Fixed-ServerSafeQueryCache: 301 queries, effective cacheTime=Infinity

--- Observe GC ---

  [1.0s] ✅ Fixed-ServerSafeQueryCache has been GC-collected
  (Original-QueryCache is only collected after ~60s)
```

### Heap snapshot validation

```bash
HEAP_SNAPSHOT_INTERVAL_MS=10000 pnpm dev
```

After visiting the page multiple times, compare heap snapshots in `snapshots/`:
- Before fix: QueryCache and its 301 Queries persist across snapshots
- After fix: QueryCache is collected before the next snapshot

---

## Key Source Locations

| File | Key logic |
|---|---|
| `@trpc/next/src/withTRPC.tsx:92-136` | `WithTRPC` component body creates a new QueryClient per SSR request |
| `@trpc/next/src/withTRPC.tsx:139` | `ssr: false` only controls `getInitialProps` injection |
| `@tanstack/react-query/src/Hydrate.tsx:22` | `useMemo` executes `hydrate()` synchronously on the server |
| `@tanstack/query-core/src/removable.ts:11-19` | `scheduleGc()` creates the GC timer |
| `@tanstack/query-core/src/removable.ts:21-27` | `updateCacheTime()` defaults to `Infinity` on server |
| `@tanstack/query-core/src/utils.ts:86-88` | `isValidTimeout()` returns false for `Infinity` |
| `@tanstack/query-core/src/query.ts:176` | `Query` constructor calls `scheduleGc()` |
| `@tanstack/query-core/src/hydration.ts:157` | `hydrate()` injects queries via `queryCache.build()` |

## Applicable Versions

- `@tanstack/react-query` ^4.x (uses `cacheTime`; renamed to `gcTime` in v5, same mechanism)
- `@trpc/next` ^10.x (Pages Router + `withTRPC` HOC)
- `next` ^13.x / ^14.x / ^15.x (Pages Router with `getServerSideProps`)
