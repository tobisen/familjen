/* Standalone startup fallback. No app bundle or auth dependency. */
;(function () {
  var base = document.querySelector('meta[name="app-base"]').content
  var scope = new URL(base, location.origin).href
  var message = document.getElementById('boot-message')
  var repair = document.getElementById('boot-repair')
  function reveal() {
    if (message)
      message.textContent =
        'Appen kunde inte starta. Kontrollera nätverket, ladda om eller återställ enbart appens cache.'
    if (repair) repair.hidden = false
  }
  window.addEventListener('error', reveal)
  window.addEventListener('unhandledrejection', reveal)
  window.addEventListener('vite:preloadError', function (event) {
    event.preventDefault()
    // Only one automatic retry per tab; avoid an endless reload loop.
    try {
      if (!sessionStorage.getItem('familjen.boot.retry')) {
        sessionStorage.setItem('familjen.boot.retry', '1')
        location.reload()
        return
      }
    } catch {
      /* recovery remains available */
    }
    reveal()
  })
  setTimeout(function () {
    if (document.getElementById('boot-fallback')) reveal()
  }, 12000)
  async function reset() {
    if (repair) repair.disabled = true
    try {
      if ('serviceWorker' in navigator) {
        var registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(
          registrations
            .filter(function (r) {
              return r.scope === scope
            })
            .map(function (r) {
              return r.unregister()
            }),
        )
      }
      if ('caches' in window)
        await Promise.all(
          (await caches.keys())
            .filter(function (name) {
              return (
                (name.startsWith('familjen-') || name.startsWith('workbox-')) &&
                name.endsWith(scope)
              )
            })
            .map(function (name) {
              return caches.delete(name)
            }),
        )
      location.replace(scope + '?repair=' + Date.now() + '#/')
    } catch {
      if (message)
        message.textContent =
          'Återställningen misslyckades. Öppna appen i webbläsaren och försök igen.'
      if (repair) repair.disabled = false
    }
  }
  document.querySelectorAll('[data-reset-app]').forEach(function (button) {
    button.addEventListener('click', reset)
  })
})()
