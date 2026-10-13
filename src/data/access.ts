import { supabase } from '../services/supabase'
// All future repositories must pass this gate; RLS remains the authority.
export async function requireSession() {
  if (!supabase) throw new Error('Supabase är inte konfigurerat.')
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user)
    throw new Error('Säker inloggning krävs för familjens data.')
  return { client: supabase, user: data.user }
}
