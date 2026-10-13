// No imports/dependencies. Only this Edge runtime sees the built-in service-role secret.
declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Promise<Response>): void
}
const env = Deno.env
const allowed = new Set([
  'https://tobisen.github.io',
  'http://127.0.0.1:4175',
  'http://127.0.0.1:4174',
  'http://localhost:5173',
])
const url = env.get('SUPABASE_URL')!
const admin = env.get('SUPABASE_SERVICE_ROLE_KEY')!
const publicKey = env.get('SUPABASE_ANON_KEY')!
const hash = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
async function json(path: string, body: unknown, key = admin) {
  const response = await fetch(url + path, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('Upstream operation failed')
  return response.json()
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'Access-Control-Allow-Headers':
      'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin
  const reply = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers })
  if (!allowed.has(origin))
    return reply(403, { error: 'Registrering tillåts endast från Familjen.' })
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return reply(405, { error: 'Metoden stöds inte.' })
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 2048)
      return reply(413, { error: 'Ogiltig begäran.' })
    const text = await req.text()
    if (text.length > 2048) return reply(413, { error: 'Ogiltig begäran.' })
    const body = JSON.parse(text)
    const profile = String(body.profile ?? '')
    const code = String(body.code ?? '')
      .toUpperCase()
      .replace(/[\s-]/g, '')
    // Malformed codes are still counted, using a fixed-length hash. All failure reasons look identical.
    const valid =
      ['tobias', 'neo', 'sally'].includes(profile) &&
      /^[0-9A-HJKMNP-TV-Z]{16}$/.test(code)
    if (!['tobias', 'neo', 'sally'].includes(profile))
      return reply(400, {
        error: 'Välj profil och ange din personliga engångskod.',
      })
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const decision = await json('/rest/v1/rpc/redeem_device_registration', {
      code_hash: await hash(profile + ':' + (valid ? code : 'invalid')),
      selected_profile: profile,
      client_ip_hash: await hash('familjen-registration:' + ip),
    })
    if (decision.status === 'limited')
      return reply(429, {
        error: 'För många försök. Vänta 15 minuter innan du försöker igen.',
      })
    if (decision.status !== 'accepted')
      return reply(400, {
        error:
          'Koden är felaktig, förbrukad eller har gått ut. Be om en ny personlig kod.',
      })
    const userResponse = await fetch(
      url + '/auth/v1/admin/users/' + decision.user_id,
      {
        headers: { apikey: admin, Authorization: `Bearer ${admin}` },
        signal: AbortSignal.timeout(10000),
      },
    )
    if (!userResponse.ok) throw new Error('User unavailable')
    const user = await userResponse.json()
    const link = await json('/auth/v1/admin/generate_link', {
      type: 'magiclink',
      email: user.email,
    })
    // GoTrue consumes its own one-time token and issues the signed persistent session.
    const session = await json(
      '/auth/v1/verify',
      { type: 'magiclink', token_hash: link.hashed_token },
      publicKey,
    )
    return reply(200, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })
  } catch {
    // A code already redeemed stays consumed if upstream Auth fails (fail closed).
    return reply(503, {
      error:
        'Registreringen kunde inte slutföras. Försök senare eller be om en ny kod.',
    })
  }
})
