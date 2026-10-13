import { createClient } from '@supabase/supabase-js'
import project from '../../config/public-supabase.json'
import { publicConfiguration } from './supabaseConfig'
const disabled = import.meta.env.VITE_SUPABASE_DISABLED === 'true'
const url = disabled ? '' : import.meta.env.VITE_SUPABASE_URL || project.url
const key = disabled
  ? ''
  : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || project.publishableKey
const valid = publicConfiguration(url, key)
export const configurationError =
  Boolean(url || key) && !valid
    ? 'Ogiltig Supabase-konfiguration. Använd projekt-URL och en publishable/anon-nyckel.'
    : ''
export const supabase = valid
  ? createClient(url, key, {
      auth: {
        storageKey: 'familjen.supabase.session',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null
export const backendConfigured = Boolean(supabase)
