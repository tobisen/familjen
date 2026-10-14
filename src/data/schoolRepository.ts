import { supabase } from '../services/supabase'
import { parseDraft, type SchoolDraft } from '../domain/publicSchoolImport'
export interface SchoolRecord {
  id: string
  student_id: string
  period_key: string
  draft: SchoolDraft
  version: number
  active_ids: string[]
  activated_at: string | null
}
async function rpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error('Supabase saknar konfiguration.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}
export async function loadSchoolRecords() {
  const records = await rpc<SchoolRecord[]>('school_snapshot')
  return records.map((r) => ({ ...r, draft: parseDraft(r.draft) }))
}
export function saveSchoolRecord(
  payload: SchoolDraft,
  version: number | null,
  activate: boolean,
  replace: boolean,
) {
  return rpc<{ record: SchoolRecord; count: number }>('school_save', {
    payload,
    expected_version: version,
    activate,
    replace_missing: replace,
  })
}
