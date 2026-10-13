import { computed, ref } from 'vue'
import {
  createListsRepository,
  type ListsRepository,
} from '../data/listsRepository'
import type {
  ListKind,
  ListPerson,
  Task,
  ShoppingItem,
  TaskInput,
  ShoppingInput,
} from '../domain/lists'
import { activeShopping } from '../domain/lists'
export const tasks = ref<Task[]>([])
export const shopping = ref<ShoppingItem[]>([])
export const listPeople = ref<ListPerson[]>([])
export const listsStatus = ref<'unconfigured' | 'loading' | 'ready' | 'error'>(
  'unconfigured',
)
export const listsError = ref('')
export const listsSync = ref('Ej ansluten')
export const listsOnline = ref(navigator.onLine)
export const listsWritable = computed(
  () => listsStatus.value === 'ready' && listsOnline.value,
)
export const remainingShopping = computed(
  () => activeShopping(shopping.value).length,
)
export const listEditor = ref<{
  kind: ListKind
  item: Task | ShoppingItem | null
  request: string
} | null>(null)
export const pendingListIds = ref(new Set<string>())
export const undoPurchase = ref<{
  id: string
  title: string
  version: number
} | null>(null)
let repository: ListsRepository | null = null
let unsubscribe: (() => void) | null = null
let generation = 0
let loading: Promise<void> | null = null
let dirty = false
export async function reloadLists(): Promise<void> {
  if (!repository) return
  if (loading) {
    dirty = true
    return loading
  }
  const ownRepository = repository,
    token = generation
  loading = (async () => {
    do {
      dirty = false
      try {
        const data = await ownRepository.load()
        if (token !== generation) return
        tasks.value = data.tasks
        shopping.value = data.shopping
        listPeople.value = data.people
        listsStatus.value = 'ready'
        listsError.value = ''
      } catch (e) {
        if (token !== generation) return
        listsStatus.value = 'error'
        listsError.value =
          e instanceof Error ? e.message : 'Listorna kunde inte hämtas.'
      }
    } while (dirty && token === generation)
  })()
  const work = loading
  try {
    await work
  } finally {
    if (loading === work) loading = null
  }
}
export function stopLists() {
  generation++
  unsubscribe?.()
  unsubscribe = null
  repository = null
  loading = null
  dirty = false
  tasks.value = []
  shopping.value = []
  listPeople.value = []
  listEditor.value = null
  undoPurchase.value = null
  pendingListIds.value = new Set()
  listsStatus.value = 'unconfigured'
  listsError.value = ''
  listsSync.value = 'Ej ansluten'
}
export function startLists(injected?: ListsRepository) {
  if (repository && !injected) {
    void reloadLists()
    return
  }
  stopLists()
  repository = injected ?? createListsRepository()
  if (!repository) return
  listsStatus.value = 'loading'
  void reloadLists()
  unsubscribe = repository.subscribe(
    () => {
      void reloadLists()
    },
    (s) => {
      listsSync.value =
        s === 'SUBSCRIBED'
          ? 'Realtid ansluten'
          : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT'
            ? 'Realtid avbruten · återansluter'
            : 'Ansluter'
    },
  )
}
export function openListEditor(
  kind: ListKind,
  item: Task | ShoppingItem | null = null,
) {
  listEditor.value = {
    kind,
    item: item ? JSON.parse(JSON.stringify(item)) : null,
    request: crypto.randomUUID(),
  }
}
export const editListItem = openListEditor

async function mutate<T>(
  key: string,
  action: (r: ListsRepository) => Promise<T>,
) {
  const r = repository,
    token = generation
  if (!r || !listsOnline.value)
    throw new Error('Listans anslutning och nätverk krävs.')
  if (pendingListIds.value.has(key)) throw new Error('Ändringen sparas redan.')
  pendingListIds.value = new Set([...pendingListIds.value, key])
  try {
    const result = await action(r)
    if (token !== generation)
      throw new Error('Sessionen har ändrats. Öppna listan igen.')
    await reloadLists()
    return result
  } finally {
    if (token === generation) {
      const next = new Set(pendingListIds.value)
      next.delete(key)
      pendingListIds.value = next
    }
  }
}
export function saveListItem(
  kind: ListKind,
  payload: TaskInput | ShoppingInput,
  id: string | null,
  version: number | null,
  request: string,
) {
  return mutate(id ?? request, (r) =>
    r.save(kind, payload, id, version, request),
  )
}
export async function setListDone(
  kind: ListKind,
  item: Task | ShoppingItem,
  done: boolean,
) {
  const token = generation
  await mutate(item.id, async (r) => {
    await r.setDone(kind, item.id, done, item.version)
    if (token !== generation) return
    // Apply confirmed result before the snapshot returns. No speculative write if the RPC fails.
    if (kind === 'shopping') {
      const row = shopping.value.find((s) => s.id === item.id)
      if (row) {
        row.purchased = done
        if (done)
          undoPurchase.value = {
            id: row.id,
            title: row.title,
            version: row.version + 1,
          }
      }
    }
  })
  if (token === generation && kind === 'shopping' && done) {
    const row = shopping.value.find((s) => s.id === item.id)
    if (row?.purchased)
      undoPurchase.value = {
        id: row.id,
        title: row.title,
        version: row.version,
      }
    else undoPurchase.value = null
  }
}
export async function restorePurchase() {
  if (!undoPurchase.value) return
  const item = shopping.value.find((s) => s.id === undoPurchase.value!.id)
  if (item) await setListDone('shopping', item, false)
  undoPurchase.value = null
}
export function deleteListItem(kind: ListKind, id: string, version: number) {
  return mutate(id, (r) => r.remove(kind, id, version))
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    listsOnline.value = true
    void reloadLists()
  })
  window.addEventListener('offline', () => {
    listsOnline.value = false
  })
  window.addEventListener('focus', () => {
    void reloadLists()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void reloadLists()
  })
}
