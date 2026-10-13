import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { ListsRepository } from '../data/listsRepository'
import type { ListsSnapshot, ShoppingItem } from '../domain/lists'
vi.mock('../data/listsRepository', () => ({
  createListsRepository: () => null,
}))
import {
  startLists,
  stopLists,
  reloadLists,
  shopping,
  tasks,
  listEditor,
  undoPurchase,
  setListDone,
  pendingListIds,
  listsStatus,
  openListEditor,
} from './lists'
const item: ShoppingItem = {
  id: 'item',
  title: 'Testvara',
  amount: 1,
  unit: 'st',
  purchased: false,
  version: 1,
  created_by: null,
  purchased_by: null,
  purchased_at: null,
  created_at: '2026-01-01',
}
const snapshot = (): ListsSnapshot => ({
  people: [],
  tasks: [],
  shopping: [{ ...item }],
})
let repository: ListsRepository
beforeEach(() => {
  stopLists()
  repository = {
    load: vi.fn().mockResolvedValue(snapshot()),
    save: vi.fn().mockResolvedValue('new'),
    setDone: vi.fn().mockResolvedValue('item'),
    remove: vi.fn(),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
  }
})
afterEach(() => stopLists())
it('clears all private data and editing state on logout', async () => {
  startLists(repository)
  await reloadLists()
  openListEditor('shopping', shopping.value[0])
  undoPurchase.value = { id: 'item', title: 'Testvara', version: 1 }
  stopLists()
  expect(shopping.value).toEqual([])
  expect(tasks.value).toEqual([])
  expect(listEditor.value).toBeNull()
  expect(undoPurchase.value).toBeNull()
  expect(listsStatus.value).toBe('unconfigured')
})
it('never applies a late read after session changes', async () => {
  let resolve!: (s: ListsSnapshot) => void
  repository.load = vi.fn().mockImplementation(
    () =>
      new Promise<ListsSnapshot>((r) => {
        resolve = r
      }),
  )
  startLists(repository)
  stopLists()
  resolve(snapshot())
  await Promise.resolve()
  await Promise.resolve()
  expect(shopping.value).toEqual([])
})
it('coalesces realtime reloads and fetches again when dirtied during read', async () => {
  let resolve!: (s: ListsSnapshot) => void
  repository.load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<ListsSnapshot>((r) => {
          resolve = r
        }),
    )
    .mockResolvedValue(snapshot())
  startLists(repository)
  const pending = reloadLists()
  void reloadLists()
  resolve(snapshot())
  await pending
  expect(repository.load).toHaveBeenCalledTimes(2)
})
it('blocks a second local purchase while saving and exposes undo after confirmation', async () => {
  startLists(repository)
  await reloadLists()
  let resolve!: (id: string) => void
  repository.setDone = vi.fn().mockImplementation(
    () =>
      new Promise<string>((r) => {
        resolve = r
      }),
  )
  repository.load = vi.fn().mockResolvedValue({
    people: [],
    tasks: [],
    shopping: [{ ...item, purchased: true, version: 2 }],
  })
  const first = setListDone('shopping', shopping.value[0]!, true)
  expect(pendingListIds.value.has(item.id)).toBe(true)
  await expect(
    setListDone('shopping', shopping.value[0]!, true),
  ).rejects.toThrow(/sparas redan/)
  expect(repository.setDone).toHaveBeenCalledTimes(1)
  resolve('item')
  await first
  expect(shopping.value[0]?.purchased).toBe(true)
  expect(undoPurchase.value?.version).toBe(2)
  expect(pendingListIds.value.size).toBe(0)
})
it('keeps an unconfirmed purchase active after failure', async () => {
  startLists(repository)
  await reloadLists()
  repository.setDone = vi.fn().mockRejectedValue(new Error('Nätfel'))
  await expect(
    setListDone('shopping', shopping.value[0]!, true),
  ).rejects.toThrow('Nätfel')
  expect(shopping.value[0]?.purchased).toBe(false)
  expect(undoPurchase.value).toBeNull()
})
