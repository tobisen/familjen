import { ref } from 'vue'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'
import { stopCalendar, startCalendar } from './calendar'
import { selectProfile, type ProfileId } from '../domain/profiles'
export interface FamilyIdentity {
  profile_id: string
  profile_key: ProfileId
  display_name: string
  family_id: string
}
export const authStatus = ref<
  'unconfigured' | 'loading' | 'signedOut' | 'unregistered' | 'ready' | 'error'
>(supabase ? 'loading' : 'unconfigured')
export const identity = ref<FamilyIdentity | null>(null)
export const authError = ref('')
export const authBusy = ref(false)
// Fragment never goes to GitHub Pages or a referrer. Scrub before Router starts.
function captureRegistration() {
  const fragment = window.location.hash
  if (!fragment.startsWith('#/registrera?')) return null
  const params = new URLSearchParams(fragment.split('?')[1])
  const token = params.get('token_hash')
  const type = params.get('type')
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search + '#/',
  )
  if (
    !token ||
    !/^[A-Za-z0-9_-]{20,512}$/.test(token) ||
    !['magiclink', 'invite'].includes(type ?? '')
  ) {
    authError.value = 'Registreringslänken är ogiltig.'
    return null
  }
  return { token_hash: token, type: type as 'magiclink' | 'invite' }
}
export const registration = ref(captureRegistration())
let generation = 0
let initialized = false
let unsubscribe: (() => void) | null = null
function clearIdentity() {
  generation++
  identity.value = null
  stopCalendar()
}
export async function restoreIdentity(session?: Session | null) {
  if (!supabase) return
  const attempt = ++generation
  authStatus.value = 'loading'
  authError.value = ''
  try {
    const current =
      session === undefined
        ? (await supabase.auth.getSession()).data.session
        : session
    if (!current) {
      if (attempt === generation) {
        clearIdentity()
        authStatus.value = 'signedOut'
      }
      return
    }
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (attempt !== generation) return
    if (userError || !userData.user)
      throw new Error(
        'Sessionen kunde inte verifieras. Återanslut eller registrera enheten igen.',
      )
    const { data, error } = await supabase.rpc('calendar_identity')
    if (attempt !== generation) return
    if (error)
      throw new Error(
        'Familjens behörigheter är inte konfigurerade. Kontakta administratören.',
      )
    if (!data) {
      clearIdentity()
      authStatus.value = 'unregistered'
      return
    }
    const resolved = data as FamilyIdentity
    if (
      !['tobias', 'neo', 'sally'].includes(resolved.profile_key) ||
      !resolved.family_id ||
      !resolved.profile_id
    )
      throw new Error('Ogiltig familjeidentitet från servern.')
    identity.value = resolved
    selectProfile(resolved.profile_key)
    await supabase.realtime.setAuth(current.access_token)
    if (attempt !== generation) return
    authStatus.value = 'ready'
    startCalendar()
  } catch (e) {
    if (attempt !== generation) return
    clearIdentity()
    authStatus.value = 'error'
    authError.value =
      e instanceof Error ? e.message : 'Inloggningen kunde inte återställas.'
  }
}
export function initializeAuth() {
  if (initialized || !supabase) return
  initialized = true
  const listener = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && identity.value))
      clearIdentity()
    // Avoid auth-js callback lock: run SDK work after callback returns.
    if (event === 'SIGNED_OUT') authStatus.value = 'signedOut'
    else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')
      setTimeout(() => {
        void restoreIdentity(session)
      }, 0)
  })
  unsubscribe = () => listener.data.subscription.unsubscribe()
  void restoreIdentity()
}
export async function registerDevice() {
  if (!supabase || !registration.value) return
  authBusy.value = true
  clearIdentity()
  authStatus.value = 'loading'
  authError.value = ''
  const token = registration.value
  registration.value = null
  try {
    const { data, error } = await supabase.auth.verifyOtp(token)
    if (error || !data.session)
      throw new Error(
        'Länken är förbrukad eller har gått ut. Be om en ny personlig registreringslänk.',
      )
    await restoreIdentity(data.session)
  } catch (e) {
    clearIdentity()
    authStatus.value = 'signedOut'
    authError.value =
      e instanceof Error ? e.message : 'Registreringen misslyckades.'
  } finally {
    authBusy.value = false
  }
}
export async function requestEmailLink(email: string) {
  if (!supabase) return
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      shouldCreateUser: false,
      emailRedirectTo: window.location.origin + import.meta.env.BASE_URL,
    },
  })
  if (error)
    throw new Error(
      'Länken kunde inte skickas. Kontrollera e-postadress eller försök senare.',
    )
}
export async function signOut() {
  clearIdentity()
  authStatus.value = supabase ? 'signedOut' : 'unconfigured'
  authError.value = ''
  if (!supabase) return
  // Local scope removes this device session. Admin revocation handles a lost device.
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) {
    // A failed network logout must not restore credentials after reload.
    try {
      for (const key of [
        'familjen.supabase.session',
        'familjen.supabase.session-user',
        'familjen.supabase.session-code-verifier',
      ])
        localStorage.removeItem(key)
    } catch {
      /* Browser storage may be unavailable. */
    }
    authError.value =
      'Enhetens session är rensad lokalt. Administratören kan återkalla en förlorad enhet.'
    window.location.replace(
      window.location.origin + import.meta.env.BASE_URL + '#/',
    )
  }
}
export function disposeAuth() {
  unsubscribe?.()
  unsubscribe = null
  initialized = false
  clearIdentity()
}
