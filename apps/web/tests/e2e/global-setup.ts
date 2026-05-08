import { request } from '@playwright/test'

/**
 * Pre-flight: assert the live Apptainer stack is reachable. We hit the API
 * healthz and the web index. If either is down, we abort the run so the
 * suite doesn't generate misleading red results.
 */
export default async function globalSetup() {
  const ctx = await request.newContext()
  const checks: Array<{ url: string; expectedStatuses: number[] }> = [
    { url: 'http://localhost:8800/api/v1/healthz', expectedStatuses: [200] },
    { url: 'http://localhost:5173/', expectedStatuses: [200] },
  ]
  for (const c of checks) {
    let lastStatus = -1
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await ctx.get(c.url, { timeout: 5_000 })
        lastStatus = res.status()
        if (c.expectedStatuses.includes(lastStatus)) break
      } catch (err) {
        lastErr = err
      }
      await new Promise((r) => setTimeout(r, 1_000))
    }
    if (!c.expectedStatuses.includes(lastStatus)) {
      throw new Error(
        `[globalSetup] precondition failed: ${c.url} -> ${lastStatus} (err: ${String(lastErr)})`,
      )
    }
  }
  await ctx.dispose()
}
