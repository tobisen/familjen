// @vitest-environment node
import { beforeAll, afterAll, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import {
  calendarDatabase,
  testUser,
  asCalendarRole,
} from '../../tests/support/database'
let db: PGlite
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
async function issue(code: string, expired = false) {
  await db.query(
    `insert into private.device_registration_codes(code_hash,profile_id,created_at,expires_at) select $1,id,now()-interval '2 hours',${expired ? "now()-interval '1 hour'" : "now()+interval '1 hour'"} from public.profiles where auth_user_id=$2`,
    [digest('neo:' + code), testUser],
  )
}
async function redeem(code: string, profile = 'neo', ip = 'test-ip') {
  await db.exec('set role service_role')
  try {
    return (
      await db.query<{ data: { status: string; user_id?: string } }>(
        'select public.redeem_device_registration($1,$2,$3) as data',
        [digest(profile + ':' + code), profile, digest(ip)],
      )
    ).rows[0]!.data
  } finally {
    await db.exec('reset role')
  }
}
beforeAll(async () => {
  db = await calendarDatabase()
}, 30000)
afterAll(async () => db.close())
it('does not expose code records or redeem RPC to browser roles', async () => {
  for (const role of ['anon', 'authenticated'] as const) {
    await expect(
      asCalendarRole(db, role, () =>
        db.query('select * from private.device_registration_codes'),
      ),
    ).rejects.toThrow(/permission denied/)
    await expect(
      asCalendarRole(db, role, () =>
        db.query("select public.redeem_device_registration('x','neo','x')"),
      ),
    ).rejects.toThrow(/permission denied/)
  }
})
it('binds a reusable code to the correct profile', async () => {
  await issue('0123456789ABCDEF')
  expect((await redeem('0123456789ABCDEF', 'sally')).status).toBe('invalid')
  expect(await redeem('0123456789ABCDEF')).toMatchObject({
    status: 'accepted',
    user_id: testUser,
  })
  expect((await redeem('0123456789ABCDEF')).status).toBe('accepted')
})
it('rejects expired and wrong codes identically', async () => {
  await issue('EXPIRED-CODE', true)
  expect((await redeem('EXPIRED-CODE')).status).toBe('invalid')
  expect((await redeem('WRONG-CODE')).status).toBe('invalid')
})
it('limits repeated failures even when client IP changes', async () => {
  await db.exec('delete from private.device_registration_attempts')
  for (let i = 0; i < 10; i++)
    expect((await redeem('bad-' + i, 'neo', 'ip-' + i)).status).toBe('invalid')
  expect((await redeem('bad-final', 'neo', 'new-ip')).status).toBe('limited')
})
it('allows a retry once the lockout window has elapsed', async () => {
  await db.exec(
    "update private.device_registration_attempts set attempted_at=now()-interval '16 minutes'",
  )
  await issue('NEW-VALID-CODE')
  expect((await redeem('NEW-VALID-CODE')).status).toBe('accepted')
})

it('accepts a nonexpiring code long after issuance and on repeated login', async () => {
  await db.query(
    `insert into private.device_registration_codes(code_hash,profile_id,created_at,expires_at) select $1,id,now()-interval '10 years','infinity'::timestamptz from public.profiles where auth_user_id=$2`,
    [digest('neo:PERMANENT-CODE'), testUser],
  )
  expect((await redeem('PERMANENT-CODE')).status).toBe('accepted')
  expect((await redeem('PERMANENT-CODE')).status).toBe('accepted')
})

it('revokes a code only when explicitly replaced', async () => {
  await db.exec('delete from private.device_registration_attempts')
  await issue('REVOKED-CODE')
  await db.query(
    'update private.device_registration_codes set revoked_at=now() where code_hash=$1',
    [digest('neo:REVOKED-CODE')],
  )
  expect((await redeem('REVOKED-CODE')).status).toBe('invalid')
})
