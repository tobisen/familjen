import { supabase } from './supabase'
import config from '../../config/public-push.json'
export function pushSupport() {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const installed =
    matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  if (ios && !installed)
    return 'På iPhone: lägg först Familjen på hemskärmen via Safari → Dela → Lägg till på hemskärmen. Öppna sedan appen därifrån.'
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  )
    return 'Web Push stöds inte i den här webbläsaren.'
  if (!config.publicKey) return 'Push är ännu inte konfigurerat på servern.'
  return ''
}
function readyWorker() {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              'Appens service worker svarar inte. Uppdatera appen och försök igen.',
            ),
          ),
        8000,
      )
    }),
  ]).finally(() => clearTimeout(timer))
}
function applicationKey(value: string) {
  const raw = atob(
    value.replaceAll('-', '+').replaceAll('_', '/') +
      '='.repeat((4 - (value.length % 4)) % 4),
  )
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
export async function setPushOwner(
  reg: ServiceWorkerRegistration,
  profile: string | null,
) {
  const worker = reg.active
  if (!worker) throw new Error('Appens service worker är inte redo.')
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel(),
      timer = setTimeout(
        () =>
          reject(
            new Error(
              'Uppdatera Familjen till senaste versionen innan du aktiverar notiser.',
            ),
          ),
        3000,
      )
    channel.port1.onmessage = () => {
      clearTimeout(timer)
      channel.port1.close()
      resolve()
    }
    worker.postMessage({ type: 'FAMILJEN_PUSH_OWNER', profileId: profile }, [
      channel.port2,
    ])
  })
}
export async function enablePush(profile: string) {
  const unsupported = pushSupport()
  if (unsupported) throw new Error(unsupported)
  // Permission request starts in the user's click handler, before any await.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted')
    throw new Error(
      'Notiser är inte tillåtna. Ändra behörigheten i telefonens eller webbläsarens inställningar och försök igen.',
    )
  if (!supabase) throw new Error('Anslutning saknas.')
  const reg = await readyWorker()
  await setPushOwner(reg, profile)
  let sub = await reg.pushManager.getSubscription()
  // A changed VAPID public key requires a fresh browser subscription.
  if (
    sub?.options.applicationServerKey &&
    new Uint8Array(sub.options.applicationServerKey).join(',') !==
      applicationKey(config.publicKey).join(',')
  ) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationKey(config.publicKey),
  })
  let { error } = await supabase.rpc('push_register', { payload: sub.toJSON() })
  if (error?.message.includes('annan registrering')) {
    await sub.unsubscribe()
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationKey(config.publicKey),
    })
    error = (await supabase.rpc('push_register', { payload: sub.toJSON() }))
      .error
  }
  if (error) throw new Error(error.message)
  return true
}
export async function restorePush(profile: string) {
  if (pushSupport() || Notification.permission !== 'granted') return false
  const reg = await readyWorker()
  await setPushOwner(reg, profile)
  const sub = await reg.pushManager.getSubscription()
  if (!sub || !supabase) return false
  if (
    sub.options.applicationServerKey &&
    new Uint8Array(sub.options.applicationServerKey).join(',') !==
      applicationKey(config.publicKey).join(',')
  )
    return false
  const { error } = await supabase.rpc('push_register', {
    payload: sub.toJSON(),
  })
  if (error) throw new Error(error.message)
  return true
}
export async function detachPush() {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.getRegistration(
    import.meta.env.BASE_URL,
  )
  if (!reg) return
  await setPushOwner(reg, null).catch(() => {})
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await sub.unsubscribe()
    if (supabase)
      await supabase.rpc('push_forget', { push_endpoint: sub.endpoint })
  }
}
export async function testPush() {
  if (!supabase) throw new Error('Anslutning saknas.')
  const { error } = await supabase.rpc('push_test')
  if (error) throw new Error(error.message)
}
