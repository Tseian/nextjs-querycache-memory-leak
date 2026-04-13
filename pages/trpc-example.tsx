import type { GetServerSideProps, NextPage } from 'next'
import React from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { createServerSideHelpers } from '@trpc/react-query/server'

import { trpc } from '@/lib/trpc'
import { appRouter } from '@/server/api/root'
import { createTRPCContext } from '@/server/trpc/context'

const prefetchInput = { name: 'prefetched' }
const LONG_CACHE_TIME = 1000 * 60 * 60 * 6
const SEED_QUERY_COUNT = 300

export const getServerSideProps: GetServerSideProps = async () => {
  const ctx = await createTRPCContext({ req: new Request('http://localhost') })
  const helpers = createServerSideHelpers({
    router: appRouter,
    ctx,
  })

  await helpers.example.hello.prefetch(prefetchInput)
  const trpcState = helpers.dehydrate()
  helpers.queryClient.clear()

  return {
    props: {
      trpcState,
    },
  }
}

function SeedQuery({ name }: { name: string }) {
  trpc.example.hello.useQuery(
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
          {Array.from({ length: SEED_QUERY_COUNT }, (_, i) => (
            <SeedQuery key={`${batchId}-${i}`} name={`${batchId}-${i}`} />
          ))}
        </div>
      ) : null}

      <div className="mx-auto max-w-2xl rounded-xl border border-neutral-200 bg-white/70 p-4 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Minimal Repro</h1>
        <p className="text-sm text-neutral-700">
          Mount 300 disabled queries with cacheTime=6h, then unmount after 1.2s.
        </p>
        <div className="text-sm">seed mounted: {seedMounted ? 'yes' : 'no'}</div>
        <div className="text-sm">seed query count in cache: {seededCount}</div>
      </div>
    </main>
  )
}

export default TrpcExamplePage
