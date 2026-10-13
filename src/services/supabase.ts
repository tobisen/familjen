import { createClient } from '@supabase/supabase-js'
import { publicConfiguration } from './supabaseConfig'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const valid = publicConfiguration(url, key)
export const configurationError =
  Boolean(url || key) && !valid
    ? 'Ogiltig Supabase-konfiguration. Använd projekt-URL och en publishable/anon-nyckel.'
    : ''
export const supabase = valid
  ? createClient(url, key, {
      auth: { storageKey: 'familjen.supabase.session' },
    })
  : null
export const backendConfigured = Boolean(supabase)
