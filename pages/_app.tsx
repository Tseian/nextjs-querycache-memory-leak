import type { AppType } from 'next/app'

import '@/app/globals.css'

import { trpc } from '@/lib/trpc'

const App: AppType = ({ Component, pageProps }) => {
  return <Component {...pageProps} />
}

export default trpc.withTRPC(App)
