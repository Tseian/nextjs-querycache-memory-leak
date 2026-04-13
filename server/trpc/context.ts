export type TRPCContext = {
  requestHeaders: Headers
}

export async function createTRPCContext(opts: { req: Request }): Promise<TRPCContext> {
  return {
    requestHeaders: opts.req.headers,
  }
}
