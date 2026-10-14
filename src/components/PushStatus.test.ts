import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
const mocks = vi.hoisted(() => ({ restore: vi.fn(), enable: vi.fn() }))
vi.mock('../stores/auth', () => ({
  identity: ref({ profile_id: 'test-profile' }),
}))
vi.mock('../services/push', () => ({
  pushSupport: () => null,
  restorePush: mocks.restore,
  enablePush: mocks.enable,
  testPush: vi.fn(),
}))
import PushStatus from './PushStatus.vue'
let permission: NotificationPermission
beforeEach(() => {
  permission = 'granted'
  vi.stubGlobal('Notification', {
    get permission() {
      return permission
    },
  })
  mocks.restore.mockResolvedValue(true)
  mocks.enable.mockImplementation(async () => {
    permission = 'granted'
    return true
  })
})
afterEach(() => vi.unstubAllGlobals())
it('hides the home prompt after permission and connection, but keeps Settings status', async () => {
  const home = mount(PushStatus, { props: { compact: true } })
  const settings = mount(PushStatus)
  await flushPromises()
  expect(home.find('section').exists()).toBe(false)
  expect(settings.text()).toContain('Tillåten')
  expect(settings.text()).toContain('Skicka testnotis')
  home.unmount()
  settings.unmount()
})
it('hides immediately after enabling from the home prompt', async () => {
  permission = 'default'
  const home = mount(PushStatus, { props: { compact: true } })
  await flushPromises()
  await home.get('button').trigger('click')
  await flushPromises()
  expect(home.find('section').exists()).toBe(false)
  home.unmount()
})
it('keeps connection errors visible instead of hiding a failed subscription', async () => {
  mocks.restore.mockRejectedValueOnce(new Error('Anslutningen misslyckades'))
  const home = mount(PushStatus, { props: { compact: true } })
  await flushPromises()
  expect(home.get('[role="alert"]').text()).toContain(
    'Anslutningen misslyckades',
  )
  home.unmount()
})
