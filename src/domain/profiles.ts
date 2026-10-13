import { ref } from 'vue'
export const profiles = [
  { id: 'tobias', name: 'Tobias', color: 'sage' },
  { id: 'neo', name: 'Neo', color: 'blue' },
  { id: 'sally', name: 'Sally', color: 'peach' },
] as const
export type ProfileId = (typeof profiles)[number]['id']
export function readProfile(): ProfileId | null {
  try {
    const value = localStorage.getItem('familjen.profile')
    return profiles.find((p) => p.id === value)?.id ?? null
  } catch {
    return null
  }
}
export const selectedProfile = ref<ProfileId | null>(readProfile())
export const storageError = ref(false)
export function selectProfile(id: ProfileId) {
  selectedProfile.value = id
  try {
    localStorage.setItem('familjen.profile', id)
    storageError.value = false
  } catch {
    storageError.value = true
  }
}
