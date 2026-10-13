import { it, expect } from 'vitest'
import {
  filterTasks,
  taskTiming,
  activeShopping,
  shoppingHistory,
  validateTask,
  validateShopping,
  type Task,
  type ShoppingItem,
} from './lists'
const base: Task = {
  id: '1',
  version: 1,
  title: 'Uppgift',
  description: '',
  deadline: '2026-10-13',
  priority: 'normal',
  assigned_ids: ['neo', 'sally'],
  recurrence: null,
  reminder_days: null,
  completed: false,
  created_by: 'p',
  completed_by: null,
  completed_at: null,
  created_at: '2026-10-01',
  recurrence_parent: null,
}
it('filters all, mine, active and completed tasks including multi-person assignments', () => {
  const rows = [
    base,
    { ...base, id: '2', assigned_ids: ['tobias'] as Task['assigned_ids'] },
    { ...base, id: '3', completed: true },
  ]
  expect(filterTasks(rows, 'all', 'neo')).toHaveLength(3)
  expect(filterTasks(rows, 'mine', 'sally').map((t) => t.id)).toEqual([
    '1',
    '3',
  ])
  expect(filterTasks(rows, 'active', 'neo')).toHaveLength(2)
  expect(filterTasks(rows, 'done', 'neo').map((t) => t.id)).toEqual(['3'])
  expect(filterTasks(rows, 'mine', null)).toEqual([])
})
it('sorts overdue and upcoming first and labels date-only deadlines in Stockholm', () => {
  const rows = [
    { ...base, id: 'later', deadline: '2026-10-20' },
    { ...base, id: 'past', deadline: '2026-10-12' },
    base,
  ]
  expect(filterTasks(rows, 'active', 'neo').map((t) => t.id)).toEqual([
    'past',
    '1',
    'later',
  ])
  expect(taskTiming(rows[1]!, '2026-10-13')).toBe('Förfallen')
  expect(taskTiming(base, '2026-10-13')).toBe('Idag')
  expect(taskTiming(rows[0]!, '2026-10-13')).toBe('Kommande')
  expect(taskTiming({ ...base, completed: true }, '2026-10-13')).toBe('Klar')
})
it('separates active shopping and recent-first purchase history', () => {
  const s = {
    id: 'a',
    title: 'Vara',
    amount: 1,
    unit: '',
    version: 1,
    purchased: false,
    created_by: 'p',
    purchased_by: null,
    purchased_at: null,
    created_at: '2026-01-01',
  } as ShoppingItem
  const rows = [
    s,
    { ...s, id: 'b', purchased: true, purchased_at: '2026-10-12' },
    { ...s, id: 'c', purchased: true, purchased_at: '2026-10-13' },
  ]
  expect(activeShopping(rows).map((s) => s.id)).toEqual(['a'])
  expect(shoppingHistory(rows).map((s) => s.id)).toEqual(['c', 'b'])
})
it('validates required fields, recurrence deadlines and decimal quantities', () => {
  expect(validateTask(base)).toBeNull()
  expect(validateTask({ ...base, title: ' ' })).toBeTruthy()
  expect(
    validateTask({ ...base, recurrence: 'weekly', deadline: null }),
  ).toBeTruthy()
  expect(
    validateShopping({ title: 'Mjölk', amount: 0.5, unit: 'liter' }),
  ).toBeNull()
  for (const amount of [0, -1, Infinity, NaN, 0.0001])
    expect(validateShopping({ title: 'Vara', amount, unit: '' })).toBeTruthy()
})
