// Apply an available version only when no editor or unsent input can be lost.
export function canApplyAppUpdate() {
  if (document.visibilityState !== 'visible') return false
  if (document.querySelector('dialog[open]')) return false
  if (document.activeElement?.matches('input, textarea, select')) return false
  return ![
    ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])',
    ),
  ].some((field) => field.value.trim())
}
