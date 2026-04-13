import type { GetServerSideProps, NextPage } from 'next'
import React from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { createServerSideHelpers } from '@trpc/react-query/server'

import { trpc } from '@/lib/trpc'
import { appRouter } from '@/server/api/root'
import { createTRPCContext } from '@/server/trpc/context'

const LONG_CACHE_TIME = 1000 * 60
// const LONG_CACHE_TIME = Infinity
const SSR_PREFETCH_COUNT = 300

export const getServerSideProps: GetServerSideProps = async () => {
  const ctx = await createTRPCContext({ req: new Request('http://localhost') })
  const helpers = createServerSideHelpers({
    router: appRouter,
    ctx,
  })

  await Promise.all(
    Array.from({ length: SSR_PREFETCH_COUNT }, (_, i) =>
      helpers.example.hello.prefetch({ name: `prefetched-${i}` }),
    ),
  )
  const trpcState = helpers.dehydrate()
  helpers.queryClient.clear()

  return {
    props: {
      trpcState,
    },
  }
}

function SeedQuery({ name }: { name: string }) {
  trpc.example.hello1.useQuery(
    { name },
    {
      enabled: false,
      staleTime: 0,
      cacheTime: LONG_CACHE_TIME,
    },
  )
  return null
}

const TrpcExamplePage: NextPage = () => {
  const [seedMounted, setSeedMounted] = React.useState(true)
  const batchId = React.useMemo(() => `seed-${Date.now()}`, [])
  const queryClient = useQueryClient()

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSeedMounted(false)
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [])

  const cacheKeys = queryClient.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey))
  const seededCount = cacheKeys.filter((k) => k.includes(batchId)).length

  return (
    <main className="px-4 py-10">
      {seedMounted ? (
        <div className="hidden">
          <SeedQuery key={batchId} name={batchId} />
        </div>
      ) : null}

      <div className="mx-auto max-w-2xl rounded-xl border border-neutral-200 bg-white/70 p-4 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Minimal Repro</h1>
        <p className="text-sm text-neutral-700">
          Prefetch 300 queries in getServerSideProps, mount 1 disabled query on client, then unmount after 1.2s.
        </p>
        <div className="text-sm">seed mounted: {seedMounted ? 'yes' : 'no'}</div>
        <div className="text-sm">seed query count in cache: {seededCount}</div>
      </div>
    </main>
  )
}

export default TrpcExamplePage
