import { it, expect } from 'vitest'
import {
  ageStatus,
  ageLabel,
  positionTime,
  validSample,
  distance,
  shouldReport,
  helpDeliveryLabel,
} from './location'
const now = Date.parse('2026-10-14T12:00:00Z'),
  base = { latitude: 59.86, longitude: 17.64, accuracy: 10, timestamp: now }
it('distinguishes missing, fresh, older and stale positions at exact boundaries', () => {
  expect(ageStatus(null, now).level).toBe('unknown')
  expect(ageStatus(now - 119999, now).level).toBe('fresh')
  expect(ageStatus(now - 120000, now).level).toBe('older')
  expect(ageStatus(now - 900000, now).level).toBe('older')
  expect(ageStatus(now - 900001, now).level).toBe('stale')
  expect(ageStatus(now - 6 * 3600000, now).label).toBe('Inaktuell position')
})
it('formats exact Swedish time and age without calling old samples live', () => {
  expect(positionTime('2026-10-25T01:30:00Z')).toContain('02:30:00')
  expect(ageLabel(now - 3600000, now)).toBe('1 tim sedan')
  expect(ageLabel(now - 120000, now)).toBe('2 min sedan')
})
it('validates coordinate bounds, accuracy, future and stale samples', () => {
  expect(validSample(base, now)).toBe(true)
  for (const s of [
    { ...base, latitude: NaN },
    { ...base, longitude: 181 },
    { ...base, accuracy: -1 },
    { ...base, timestamp: now - 120001 },
    { ...base, timestamp: now + 30001 },
  ])
    expect(validSample(s, now)).toBe(false)
})
it('throttles small motion, accounts for GPS accuracy, and sends fresh minute heartbeats', () => {
  expect(shouldReport(base, null, 0, now)).toBe(true)
  const previous = { ...base, timestamp: now - 20000 }
  expect(
    shouldReport({ ...base, latitude: 59.861 }, previous, now - 5000, now),
  ).toBe(false)
  expect(shouldReport(base, previous, now - 20000, now)).toBe(false)
  expect(
    shouldReport({ ...base, latitude: 59.861 }, previous, now - 20000, now),
  ).toBe(true)
  expect(
    shouldReport(
      { ...base, latitude: 59.861, accuracy: 500 },
      previous,
      now - 20000,
      now,
    ),
  ).toBe(false)
  expect(
    shouldReport(base, { ...base, timestamp: now - 70000 }, now - 61000, now),
  ).toBe(true)
  expect(shouldReport(previous, base, now - 61000, now)).toBe(false)
  expect(distance(base, { ...base, latitude: 59.861 })).toBeGreaterThan(100)
})
it('never equates push provider acceptance with reception on a phone', () => {
  const d = {
    name: 'Neo',
    devices: 1,
    sent: 0,
    failed: 0,
    pending: 0,
    canceled: false,
  }
  expect(helpDeliveryLabel({ ...d, devices: 0 })).toContain(
    'kan inte levereras',
  )
  expect(helpDeliveryLabel({ ...d, sent: 1 })).toContain(
    'mottagning är inte bekräftad',
  )
  expect(helpDeliveryLabel({ ...d, expired: true })).toContain('giltighetstid')
  expect(helpDeliveryLabel({ ...d, failed: 1 })).toContain('misslyckades')
})
