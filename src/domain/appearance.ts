import { ref } from 'vue'
function storedTheme(): 'dark' | 'light' {
  try {
    return localStorage.getItem('familjen.theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}
export const theme = ref(storedTheme())
export function setTheme(value: 'dark' | 'light') {
  theme.value = value
  document.documentElement.dataset.theme = value
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', value === 'dark' ? '#111318' : '#f5f6f8')
  try {
    localStorage.setItem('familjen.theme', value)
  } catch {
    /* Theme still works in memory. */
  }
}
setTheme(theme.value)
