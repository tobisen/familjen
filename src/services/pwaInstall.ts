import { ref } from 'vue'
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
let pending: InstallPromptEvent | null = null
export const installAvailable = ref(false),
  installBusy = ref(false),
  installMessage = ref('')
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  pending = event as InstallPromptEvent
  installAvailable.value = true
})
window.addEventListener('appinstalled', () => {
  pending = null
  installAvailable.value = false
  installMessage.value =
    'Chrome har rapporterat installation. Kontrollera att Familjen går att starta från hemskärmen.'
})
export async function installPwa() {
  if (!pending || installBusy.value) return
  const event = pending
  pending = null
  installAvailable.value = false
  installBusy.value = true
  installMessage.value = ''
  try {
    await event.prompt()
    const choice = await event.userChoice
    installMessage.value =
      choice.outcome === 'accepted'
        ? 'Installationsbegäran skickad. Kontrollera Familjen på hemskärmen och i Androids applista.'
        : 'Installationen avbröts. Du kan fortsätta i webbläsaren.'
  } catch {
    installMessage.value =
      'Chrome kunde inte visa installationen. Ladda om sidan och använd starthjälpen om felet kvarstår.'
  } finally {
    installBusy.value = false
  }
}
