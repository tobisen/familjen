import { it, expect } from 'vitest'
import {
  chatRecipients,
  chatNotificationLink,
  chatDeliveryKey,
} from '../../supabase/functions/_shared/chatNotifications'
it('server notification planning excludes own and unregistered; OS permission governs delivery recipients', () => {
  const base = { lastReadSeq: 0, chatEnabled: true, registered: true }
  expect(
    chatRecipients({ senderId: 'a', seq: 5, deleted: false }, [
      { ...base, profileId: 'a' },
      { ...base, profileId: 'b' },
      { ...base, profileId: 'c', lastReadSeq: 5 },
      { ...base, profileId: 'd', chatEnabled: false },
      { ...base, profileId: 'e', registered: false },
    ]).map((p) => p.profileId),
  ).toEqual(['b', 'c', 'd'])
  expect(
    chatRecipients({ senderId: 'a', seq: 5, deleted: true }, [
      { ...base, profileId: 'b' },
    ]),
  ).toEqual([])
})
it('uses an HTTPS hash route and stable per-recipient delivery key', () => {
  expect(chatNotificationLink()).toBe(
    'https://tobisen.github.io/familjen/#/chatt',
  )
  expect(() => chatNotificationLink('http://insecure.invalid/')).toThrow()
  expect(chatDeliveryKey('message', 'profile')).toBe('message:profile')
})
