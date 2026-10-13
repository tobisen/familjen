export function deviceCapabilities() {
  return {
    geolocation: 'geolocation' in navigator,
    push:
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window,
  }
}
// Called only after an explicit user action in a future authenticated map flow.
export function readCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(new Error('Platsdelning stöds inte.'))
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 15000,
      maximumAge: 0,
    })
  })
}
export interface ReminderJob {
  eventId: string
  sendAt: string
  recipientProfileIds: string[]
}
export interface PushService {
  subscribe(): Promise<void>
  unsubscribe(): Promise<void>
}
