import { createECDH, randomBytes } from 'node:crypto'
import webpush from 'npm:web-push@3.6.7'
const vapid = webpush.generateVAPIDKeys()
Deno.env.set('SUPABASE_URL', 'https://backend.example.invalid')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service-only')
Deno.env.set('PUSH_WORKER_SECRET', 'fixture-worker-secret')
Deno.env.set('VAPID_PUBLIC_KEY', vapid.publicKey)
Deno.env.set('VAPID_PRIVATE_KEY', vapid.privateKey)
let handler: (req: Request) => Promise<Response>
Object.defineProperty(Deno, 'serve', {
  value: (fn: typeof handler) => {
    handler = fn
  },
})
let transport: typeof fetch = globalThis.fetch
const realFetch = globalThis.fetch
globalThis.fetch = (...args) => transport(...args)
await import('./index.ts')
const assert = (condition: unknown) => {
  if (!condition) throw new Error('Assertion failed')
}
Deno.test(
  'worker rejects unauthenticated and non-POST requests before reading queue',
  async () => {
    assert(
      (await handler(new Request('https://worker.invalid', { method: 'POST' })))
        .status === 401,
    )
    assert(
      (await handler(new Request('https://worker.invalid'))).status === 405,
    )
  },
)
Deno.test(
  'real VAPID encryption, provider status handling and sanitized counts',
  async () => {
    const original = globalThis.fetch
    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/fixture',
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    }
    const details = webpush.generateRequestDetails(subscription, 'fixture', {
      vapidDetails: {
        subject: 'https://tobisen.github.io/familjen/',
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    })
    assert(details.body)
    try {
      for (const status of [201, 429, 410]) {
        let finished = 0,
          providerCalled = false
        transport = async (url, init) => {
          const target = String(url)
          if (target.startsWith('https://backend.example.invalid')) {
            const fn = target.split('/').at(-1)
            let body: unknown = null
            if (fn === 'push_schedule_snapshot')
              body = { activities: [], lessons: [], tasks: [] }
            if (fn === 'push_claim')
              body = [
                {
                  id: crypto.randomUUID(),
                  lease: crypto.randomUUID(),
                  job: crypto.randomUUID(),
                  subscription,
                  payload: {
                    title: 'Fixture',
                    body: 'Private encrypted fixture',
                    recipient: 'p',
                    id: 'job',
                    kind: status === 201 ? 'help' : 'chat',
                  },
                  expires: new Date(Date.now() + 60000).toISOString(),
                },
              ]
            if (fn === 'push_finish')
              finished = JSON.parse(String(init?.body)).result
            return new Response(JSON.stringify(body), {
              headers: { 'content-type': 'application/json' },
            })
          }
          assert(target === subscription.endpoint)
          providerCalled = true
          const headers = new Headers(init?.headers)
          assert(headers.get('authorization')?.startsWith('vapid '))
          assert(headers.get('content-encoding') === 'aes128gcm')
          assert(
            headers.get('urgency') === (status === 201 ? 'high' : 'normal'),
          )
          assert(init?.body instanceof Uint8Array)
          assert(
            !new TextDecoder()
              .decode(init?.body as Uint8Array)
              .includes('Private encrypted fixture'),
          )
          assert(init?.redirect === 'error')
          return new Response('', { status })
        }
        const response = await handler(
          new Request('https://worker.invalid', {
            method: 'POST',
            headers: { 'x-push-worker-secret': 'fixture-worker-secret' },
          }),
        )
        if (response.status !== 200 || !providerCalled || finished !== status)
          throw new Error(
            `Worker result ${response.status}; provider=${providerCalled}; finish=${finished}`,
          )
        const result = await response.json()
        assert(result.sent === (status === 201 ? 1 : 0))
        assert(!JSON.stringify(result).includes('Private encrypted fixture'))
      }
    } finally {
      transport = realFetch
      globalThis.fetch = original
    }
  },
)
