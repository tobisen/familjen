import { it, expect } from 'vitest'
import {
  messageParts,
  mergeMessages,
  chatDate,
  chatTime,
  shouldSend,
  type ChatMessage,
} from './chat'
const message = { id: 'a', seq: 1, version: 1, body: 'Hej' } as ChatMessage
it('merges ordered messages by ID without replacing newer edits', () => {
  expect(
    mergeMessages(
      [message, { ...message, id: 'b', seq: 2 }],
      [{ ...message, version: 2, body: 'Edit' }, message],
    ),
  ).toMatchObject([{ id: 'a', body: 'Edit' }, { id: 'b' }])
})
it('linkifies only HTTP(S); unsafe markup and protocols remain text', () => {
  const parts = messageParts(
    '<img onerror=alert(1)> javascript:alert(1) https://example.com/test. 👋',
  )
  expect(parts.filter((p) => p.href)).toEqual([
    { text: 'https://example.com/test', href: 'https://example.com/test' },
  ])
  expect(parts.map((p) => p.text).join('')).toBe(
    '<img onerror=alert(1)> javascript:alert(1) https://example.com/test. 👋',
  )
  expect(messageParts('data:text/html,test').some((p) => p.href)).toBe(false)
})
it('formats Swedish time across DST transitions', () => {
  expect(chatTime('2026-03-29T01:30:00Z')).toBe('03:30')
  expect(chatTime('2026-10-25T01:30:00Z')).toBe('02:30')
  expect(chatDate('2026-10-13T22:30:00Z')).toContain('14 oktober')
})
it('desktop Enter sends; Shift, composition and mobile Enter keep text editing', () => {
  const enter = { key: 'Enter', shiftKey: false, isComposing: false }
  expect(shouldSend(enter, false)).toBe(true)
  expect(shouldSend({ ...enter, shiftKey: true }, false)).toBe(false)
  expect(shouldSend({ ...enter, isComposing: true }, false)).toBe(false)
  expect(shouldSend(enter, true)).toBe(false)
})
