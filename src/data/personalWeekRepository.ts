import { ref } from 'vue'
import { requireSession } from './access'
import type { PersonalPlan, SavedPersonalWeek } from '../domain/personalWeek'
export const personalOwner = ref<string | null>(null)
export async function getPersonalOwner(): Promise<string | null> {
  const { client } = await requireSession()
  const { data, error } = await client.rpc('personal_week_owner')
  if (error)
    throw new Error('Behörigheten till Min vecka kunde inte kontrolleras.')
  return typeof data === 'string' ? data : null
}
export async function loadPersonalWeek(
  year: number,
  week: number,
): Promise<SavedPersonalWeek | null> {
  const { client } = await requireSession()
  const { data, error } = await client.rpc('personal_week_snapshot', {
    target_year: year,
    target_week: week,
  })
  if (error) throw new Error(error.message)
  return data as SavedPersonalWeek | null
}
export async function savePersonalWeek(
  plan: PersonalPlan,
  version: number | null,
  requestId: string,
): Promise<SavedPersonalWeek> {
  const { client } = await requireSession()
  // Send only planning fields. The server derives and verifies the owner.
  const { year, week_number, week_type, focus, weekly_summary, days, tasks } =
    plan
  const { data, error } = await client.rpc('personal_week_save', {
    payload: {
      year,
      week_number,
      week_type,
      focus,
      weekly_summary,
      days,
      tasks,
    },
    expected_version: version,
    request_id: requestId,
  })
  if (error) throw new Error(error.message)
  return data as SavedPersonalWeek
}
