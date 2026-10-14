import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import webpush from 'npm:web-push@3.6.7'
import { planReminders, safePushEndpoint } from '../_shared/pushPlanner.ts'
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)
async function rpc(name: string, args?: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw Error('Database operation failed')
  return data
}
Deno.serve(async (req: Request) => {
  if (req.method === 'GET' && new URL(req.url).pathname.endsWith('/config'))
    return Response.json({ publicKey: Deno.env.get('VAPID_PUBLIC_KEY') || '' })
  if (req.method !== 'POST')
    return new Response('Method not allowed', { status: 405 })
  const expected = Deno.env.get('PUSH_WORKER_SECRET')
  const received = req.headers.get('x-push-worker-secret') || ''
  // Constant-time compare using SHA-256 digests; token is never logged.
  if (
    !expected ||
    !Deno.env.get('VAPID_PRIVATE_KEY') ||
    !Deno.env.get('VAPID_PUBLIC_KEY')
  )
    return new Response('Not configured', { status: 503 })
  const digest = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    )
  const [a, b] = await Promise.all([digest(expected), digest(received)])
  if (a.reduce((diff, x, i) => diff | (x ^ b[i]), 0) !== 0)
    return new Response('Unauthorized', { status: 401 })
  try {
    await rpc('push_cleanup')
    const snapshot = await rpc('push_schedule_snapshot')
    const reminders = planReminders(snapshot)
    if (reminders.length) await rpc('push_reminders', { items: reminders })
    await rpc('push_expire_leases')
    const jobs = await rpc('push_claim', { batch_limit: 30 })
    let sent = 0,
      failed = 0
    await Promise.all(
      jobs.map(
        async (job: {
          id: string
          lease: string
          job: string
          subscription: { endpoint: string }
          payload: { kind: string; count?: number; title: string }
          expires: string
        }) => {
          let code = 0
          try {
            if (!safePushEndpoint(job.subscription.endpoint)) code = 410
            else {
              const ttl = Math.min(
                3600,
                Math.floor((Date.parse(job.expires) - Date.now()) / 1000),
              )
              if (ttl <= 0) code = 422
              else {
                const payload = {
                  ...job.payload,
                  title:
                    job.payload.kind === 'shopping' && job.payload.count! > 1
                      ? `${job.payload.count} nya varor på inköpslistan`
                      : job.payload.title,
                }
                const details = webpush.generateRequestDetails(
                  job.subscription,
                  JSON.stringify(payload),
                  {
                    vapidDetails: {
                      subject: 'https://tobisen.github.io/familjen/',
                      publicKey: Deno.env.get('VAPID_PUBLIC_KEY')!,
                      privateKey: Deno.env.get('VAPID_PRIVATE_KEY')!,
                    },
                    TTL: ttl,
                    topic: job.job.replaceAll('-', ''),
                    urgency: job.payload.kind === 'help' ? 'high' : 'normal',
                  },
                )
                const response = await fetch(details.endpoint, {
                  method: 'POST',
                  headers: details.headers,
                  body: new Uint8Array(details.body),
                  redirect: 'error',
                  signal: AbortSignal.timeout(8000),
                })
                code = response.status
                await response.body?.cancel()
              }
            }
          } catch {
            code = 0
          }
          await rpc('push_finish', {
            delivery_id: job.id,
            lease: job.lease,
            result: code,
          })
          if (code >= 200 && code < 300) sent++
          else failed++
        },
      ),
    )
    // Counts only. No bodies, endpoints, auth headers or VAPID keys in logs.
    return Response.json({
      claimed: jobs.length,
      sent,
      failed,
      reminders: reminders.length,
    })
  } catch {
    return Response.json({ error: 'Push processing failed' }, { status: 500 })
  }
})
