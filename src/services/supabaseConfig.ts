export function publicConfiguration(url: unknown, key: unknown) {
  if (typeof url !== 'string' || typeof key !== 'string' || !url || !key)
    return false
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' &&
      !(
        parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(parsed.hostname)
      )
    )
      return false
    if (parsed.username || parsed.password) return false
    if (key.startsWith('sb_publishable_')) return true
    const payload = JSON.parse(
      atob(key.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
    )
    return payload.role === 'anon'
  } catch {
    return false
  }
}
