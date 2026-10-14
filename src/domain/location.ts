import type { ListPerson } from './lists'
export interface Sample {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
}
export interface FamilyPosition {
  profile_id: string
  family_id: string
  latitude: number
  longitude: number
  accuracy: number
  reported_at: string
  received_at: string
}
export interface MapSnapshot {
  people: ListPerson[]
  positions: FamilyPosition[]
}
export interface HelpDelivery {
  name: string
  devices: number
  sent: number
  failed: number
  pending: number
  canceled: boolean
  expired?: boolean
}
export function ageStatus(timestamp: number | null, now = Date.now()) {
  if (timestamp === null || !Number.isFinite(timestamp))
    return { label: 'Okänd position', level: 'unknown' }
  const age = Math.max(0, now - timestamp)
  return age < 120000
    ? { label: 'Nyligen uppdaterad', level: 'fresh' }
    : age <= 900000
      ? { label: 'Äldre position', level: 'older' }
      : { label: 'Inaktuell position', level: 'stale' }
}
export function ageLabel(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  return seconds < 60
    ? `${seconds} sek sedan`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} min sedan`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)} tim sedan`
        : `${Math.floor(seconds / 86400)} dagar sedan`
}
export function positionTime(instant: string | number) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(instant))
}
export function validSample(s: Sample, now = Date.now()) {
  return (
    Number.isFinite(s.latitude) &&
    Math.abs(s.latitude) <= 90 &&
    Number.isFinite(s.longitude) &&
    Math.abs(s.longitude) <= 180 &&
    Number.isFinite(s.accuracy) &&
    s.accuracy >= 0 &&
    s.accuracy <= 1000000 &&
    Number.isFinite(s.timestamp) &&
    s.timestamp <= now + 30000 &&
    s.timestamp >= now - 120000
  )
}
export function distance(a: Sample, b: Sample) {
  const radians = (v: number) => (v * Math.PI) / 180
  const lat = radians(b.latitude - a.latitude),
    lng = radians(b.longitude - a.longitude)
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(lng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}
export function shouldReport(
  next: Sample,
  previous: Sample | null,
  lastSent: number,
  now = Date.now(),
) {
  if (
    !validSample(next, now) ||
    (previous && next.timestamp <= previous.timestamp)
  )
    return false
  if (!previous) return true
  if (now - lastSent < 10000) return false
  return (
    now - lastSent >= 60000 ||
    distance(previous, next) >=
      Math.max(75, previous.accuracy, next.accuracy) ||
    next.accuracy < previous.accuracy / 2
  )
}
export function helpDeliveryLabel(d: HelpDelivery) {
  if (d.canceled) return 'Notisen har återkallats'
  if (d.sent > 0)
    return 'Godkänd av pushleverantören; mottagning är inte bekräftad'
  if (d.expired)
    return 'Push kunde inte levereras innan notisens giltighetstid tog slut'
  if (d.devices === 0)
    return 'Ingen ansluten notisenhet – push kan inte levereras'
  if (d.failed > 0 && d.pending === 0) return 'Pushleveransen misslyckades'
  return 'Push köad – leverans är ännu inte bekräftad'
}
