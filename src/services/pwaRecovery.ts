export function isAppCache(name: string, scope: string) {
  return (
    (name.startsWith('familjen-') || name.startsWith('workbox-')) &&
    name.endsWith(scope)
  )
}
export async function resetAppResources(base = import.meta.env.BASE_URL) {
  const scope = new URL(base, location.origin).href
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(
      registrations.filter((r) => r.scope === scope).map((r) => r.unregister()),
    )
  }
  if ('caches' in window)
    await Promise.all(
      (await caches.keys())
        .filter((name) => isAppCache(name, scope))
        .map((name) => caches.delete(name)),
    )
  // Never clear localStorage, IndexedDB, cookies or Supabase tokens.
  location.replace(scope + '?repair=' + Date.now() + '#/')
}
