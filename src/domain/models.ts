export type UUID = string
export interface Profile {
  id: UUID
  family_id: UUID
  display_name: string
  auth_user_id: UUID | null
}
export interface CalendarEvent {
  id: UUID
  family_id: UUID
  title: string
  starts_at: string
  ends_at: string
  created_by: UUID
  reminder_minutes: number | null
}
export interface EventParticipant {
  event_id: UUID
  profile_id: UUID
  family_id: UUID
}
export interface SchoolLesson {
  external_id: string
  student_id: UUID
  weekday: number
  starts_at: string
  ends_at: string
  subject: string
  room: string | null
  term_start: string
  term_end: string
  exception_dates: string[]
}
export interface Task {
  id: UUID
  family_id: UUID
  title: string
  completed: boolean
  assigned_to: UUID | null
}
export interface ShoppingItem {
  id: UUID
  family_id: UUID
  title: string
  quantity: string | null
  purchased: boolean
}
export interface ChatMessage {
  id: UUID
  family_id: UUID
  sender_id: UUID
  body: string
  created_at: string
}
export interface PushSubscriptionRecord {
  id: UUID
  family_id: UUID
  profile_id: UUID
  subscription: unknown
}
export interface Position {
  profile_id: UUID
  family_id: UUID
  latitude: number
  longitude: number
  accuracy: number
  reported_at: string
  received_at: string
}
export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }
  | { status: 'unconfigured' }
