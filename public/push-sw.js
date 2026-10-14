/* Imported by the existing Workbox worker; app-shell caching remains unchanged. */
const pushDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('familjen-push', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('seen')
      request.result.createObjectStore('owner')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
async function owner(value) {
  const db = await pushDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        'owner',
        value === undefined ? 'readonly' : 'readwrite',
      )
      const store = tx.objectStore('owner')
      const req =
        value === undefined ? store.get('profile') : store.put(value, 'profile')
      let result
      req.onsuccess = () => {
        result = req.result
      }
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
self.addEventListener('message', (event) => {
  const source = event.source?.url
  if (!source || !source.startsWith(self.registration.scope)) return
  if (event.data?.type === 'FAMILJEN_PUSH_OWNER')
    event.waitUntil(
      owner(event.data.profileId || null).then(() =>
        event.ports[0]?.postMessage({ ready: true }),
      ),
    )
})
async function first(id) {
  const db = await pushDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('seen', 'readwrite'),
        store = tx.objectStore('seen')
      let unseen = false
      const check = store.get(id)
      check.onsuccess = () => {
        if (!check.result) {
          unseen = true
          store.put(Date.now(), id)
        }
      }
      const cursor = store.openCursor()
      cursor.onsuccess = () => {
        const c = cursor.result
        if (c) {
          if (c.value < Date.now() - 7 * 86400000) c.delete()
          c.continue()
        }
      }
      tx.oncomplete = () => resolve(unseen)
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
self.addEventListener('push', (event) =>
  event.waitUntil(
    (async () => {
      let data
      try {
        data = event.data?.json()
      } catch {
        return
      }
      if (
        !data ||
        typeof data.id !== 'string' ||
        data.recipient !== (await owner())
      )
        return
      if (!(await first(data.id))) return
      const path =
        typeof data.path === 'string' &&
        /^\/(chatt|kalender|listor|installningar|karta)(\?|$)/.test(data.path)
          ? data.path
          : '/chatt'
      try {
        await self.registration.showNotification(
          String(data.title || 'Familjen'),
          {
            body: String(data.body || ''),
            icon: self.registration.scope + 'icons/icon-192.png',
            badge: self.registration.scope + 'icons/icon-192.png',
            tag: 'familjen-' + data.id,
            data: { url: self.registration.scope + '#' + path },
          },
        )
      } catch (error) {
        const db = await pushDb()
        const tx = db.transaction('seen', 'readwrite')
        tx.objectStore('seen').delete(data.id)
        tx.oncomplete = () => db.close()
        throw error
      }
    })(),
  ),
)
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const url = new URL(
        event.notification.data?.url || self.registration.scope + '#/',
      )
      if (!url.href.startsWith(self.registration.scope)) return
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const existing = clients.find((c) =>
        c.url.startsWith(self.registration.scope),
      )
      if (existing) {
        await existing.navigate(url.href)
        await existing.focus()
      } else await self.clients.openWindow(url.href)
    })(),
  )
})
