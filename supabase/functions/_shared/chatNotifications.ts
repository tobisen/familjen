// Server-only preparation for Phase 4. Never imported by the frontend.
export interface NotificationRecipient {
  profileId: string
  lastReadSeq: number
  chatEnabled: boolean
  registered: boolean
}
export function chatRecipients(
  event: { senderId: string; seq: number; deleted: boolean },
  members: NotificationRecipient[],
) {
  if (event.deleted) return []
  return members.filter(
    (member) =>
      member.registered &&
      member.profileId !== event.senderId &&
      member.chatEnabled &&
      member.lastReadSeq < event.seq,
  )
}
export function chatNotificationLink(
  appUrl = 'https://tobisen.github.io/familjen/',
) {
  const url = new URL(appUrl)
  if (url.protocol !== 'https:')
    throw new Error('Push destination requires HTTPS')
  url.hash = '/chatt'
  url.search = ''
  return url.href
}
export function chatDeliveryKey(messageId: string, profileId: string) {
  return messageId + ':' + profileId
}
