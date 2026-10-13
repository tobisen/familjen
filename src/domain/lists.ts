import type { ProfileId } from './profiles'
export type ListKind = 'task' | 'shopping'
export type TaskFilter = 'all' | 'mine' | 'active' | 'done'
export type Frequency = 'daily' | 'weekly' | 'monthly'
export interface ListPerson {
  id: string
  key: ProfileId
  name: string
}
export interface TaskInput {
  title: string
  description: string
  deadline: string | null
  priority: 'low' | 'normal' | 'high'
  assigned_ids: ProfileId[]
  recurrence: Frequency | null
  reminder_days: number | null
}
export interface Task extends TaskInput {
  id: string
  version: number
  completed: boolean
  created_by: string | null
  completed_by: string | null
  completed_at: string | null
  created_at: string
  recurrence_parent: string | null
}
export interface ShoppingInput {
  title: string
  amount: number
  unit: string
}
export interface ShoppingItem extends ShoppingInput {
  id: string
  version: number
  purchased: boolean
  created_by: string | null
  purchased_by: string | null
  purchased_at: string | null
  created_at: string
}
export interface ListsSnapshot {
  people: ListPerson[]
  tasks: Task[]
  shopping: ShoppingItem[]
}
export function filterTasks(
  tasks: Task[],
  filter: TaskFilter,
  own: ProfileId | null,
) {
  return tasks
    .filter((t) =>
      filter === 'mine'
        ? !!own && t.assigned_ids.includes(own)
        : filter === 'active'
          ? !t.completed
          : filter === 'done'
            ? t.completed
            : true,
    )
    .sort(
      (a, b) =>
        Number(a.completed) - Number(b.completed) ||
        (a.deadline || '9999').localeCompare(b.deadline || '9999') ||
        { high: 0, normal: 1, low: 2 }[a.priority] -
          { high: 0, normal: 1, low: 2 }[b.priority] ||
        a.created_at.localeCompare(b.created_at),
    )
}
export function taskTiming(task: Task, date: string) {
  return task.completed
    ? 'Klar'
    : task.deadline
      ? task.deadline < date
        ? 'Förfallen'
        : task.deadline === date
          ? 'Idag'
          : 'Kommande'
      : 'Utan deadline'
}
export function activeShopping(items: ShoppingItem[]) {
  return items.filter((i) => !i.purchased)
}
export function shoppingHistory(items: ShoppingItem[]) {
  return items
    .filter((i) => i.purchased)
    .sort((a, b) => (b.purchased_at || '').localeCompare(a.purchased_at || ''))
}
export function validateTask(t: TaskInput): string | null {
  if (!t.title.trim() || t.title.trim().length > 200)
    return 'Ange en titel på 1–200 tecken.'
  if (t.description.length > 5000)
    return 'Beskrivningen får ha högst 5 000 tecken.'
  if (t.recurrence && !t.deadline)
    return 'Välj deadline för en återkommande uppgift.'
  if (new Set(t.assigned_ids).size !== t.assigned_ids.length)
    return 'Samma person får inte väljas flera gånger.'
  return null
}
export function validateShopping(s: ShoppingInput): string | null {
  if (!s.title.trim() || s.title.trim().length > 200)
    return 'Ange ett varunamn på 1–200 tecken.'
  if (
    !Number.isFinite(s.amount) ||
    s.amount <= 0 ||
    s.amount > 1000000 ||
    Math.abs(s.amount * 1000 - Math.round(s.amount * 1000)) > 0.000001
  )
    return 'Ange ett antal över noll med högst tre decimaler.'
  if (s.unit.length > 40) return 'Enheten får ha högst 40 tecken.'
  return null
}
export const frequencyLabels = {
  daily: 'Dagligen',
  weekly: 'Veckovis',
  monthly: 'Månadsvis',
}
export const priorityLabels = { low: 'Låg', normal: 'Normal', high: 'Hög' }
