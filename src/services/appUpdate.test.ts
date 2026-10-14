import { afterEach, expect, it, vi } from 'vitest'
import { canApplyAppUpdate } from './appUpdate'
afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
it('allows a visible idle app to update without touching session storage', () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  localStorage.setItem('familjen.supabase.session', 'retained')
  expect(canApplyAppUpdate()).toBe(true)
  expect(localStorage.getItem('familjen.supabase.session')).toBe('retained')
})
it('protects open editors, focused fields and an unsent chat draft', () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  document.body.innerHTML = '<dialog open></dialog>'
  expect(canApplyAppUpdate()).toBe(false)
  document.body.innerHTML = '<textarea></textarea>'
  const field = document.querySelector('textarea')!
  field.value = 'Inte skickat'
  expect(canApplyAppUpdate()).toBe(false)
  field.value = ''
  field.focus()
  expect(canApplyAppUpdate()).toBe(false)
  field.blur()
  expect(canApplyAppUpdate()).toBe(true)
})
it('defers updates while the app is hidden', () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  expect(canApplyAppUpdate()).toBe(false)
})
