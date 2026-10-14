/* Read-only diagnostics: never inspect storage values, tokens, URL queries or fragments. */
;(function () {
  var button = document.getElementById('pwa-check')
  var output = document.getElementById('pwa-report')
  if (!button || !output) return
  button.addEventListener('click', async function () {
    button.disabled = true
    var base = document.querySelector('meta[name="app-base"]').content
    var app = new URL(base, location.origin)
    var manifestUrl = new URL('manifest.webmanifest', app)
    var report = {
      appUrl: app.href,
      secureContext: window.isSecureContext,
      displayMode: matchMedia('(display-mode: standalone)').matches
        ? 'standalone'
        : 'browser',
      browser: navigator.userAgent,
      androidWebApk:
        'Kan inte läsas eller återställas från en webbsida. Kontrollera chrome://webapks på telefonen.',
    }
    try {
      var response = await fetch(manifestUrl, { cache: 'no-store' })
      if (!response.ok) throw new Error('Manifest HTTP ' + response.status)
      var manifest = await response.json()
      var start = new URL(manifest.start_url, manifestUrl)
      var identity = new URL(manifest.id || start.href, start)
      identity.hash = ''
      report.manifest = {
        url: manifestUrl.href,
        id: identity.href,
        startUrl: start.href,
        scope: new URL(manifest.scope, manifestUrl).href,
        display: manifest.display,
        name: manifest.name,
        shortName: manifest.short_name,
      }
      report.icons = []
      for (var icon of manifest.icons || []) {
        var url = new URL(icon.src, manifestUrl)
        var status = 'Annan origin: inte hämtad'
        if (url.origin === location.origin)
          status = (await fetch(url, { cache: 'no-store' })).status
        report.icons.push({
          url: url.href,
          sizes: icon.sizes,
          purpose: icon.purpose || 'any',
          status: status,
        })
      }
      report.serviceWorkers =
        'serviceWorker' in navigator
          ? (await navigator.serviceWorker.getRegistrations())
              .filter((r) => r.scope === app.href)
              .map((r) => ({
                scope: r.scope,
                active: r.active?.state || null,
                waiting: !!r.waiting,
              }))
          : []
    } catch {
      report.error =
        'Kontrollen kunde inte slutföras. Kontrollera nätverket och försök igen.'
    }
    output.textContent = JSON.stringify(report, null, 2)
    button.disabled = false
  })
})()
