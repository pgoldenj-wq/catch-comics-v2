/**
 * scripts/test-costguard-webhook.ts — Vercel webhook authentication and
 * idempotency tests.
 *
 * Run: npm run test:costguard:webhook
 *
 * Exercises the REAL route handler (app/api/costguard/vercel-webhook) with
 * constructed requests. No network, no provider calls, no real limits touched.
 * The store is forced into its local file fallback inside a temp dir.
 *
 * Covers: valid signature; missing signature; invalid signature; malformed
 * signature; correctly signed but tampered body; malformed JSON with a valid
 * signature; unexpected payload fields; wrong teamId; duplicate delivery;
 * 50/75/100% thresholds; end-of-billing-cycle; missing signing secret.
 */

import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

delete process.env.KV_REST_API_URL
delete process.env.KV_REST_API_TOKEN
const workDir = mkdtempSync(join(tmpdir(), 'costguard-webhook-'))
process.chdir(workDir)

const SECRET = 'test-signing-secret-not-a-real-credential'
process.env.COSTGUARD_WEBHOOK_SECRET = SECRET

import { NextRequest } from 'next/server'
import { POST } from '../app/api/costguard/vercel-webhook/route'
import { getEvents, getState, setState } from '../lib/costguard/store'
import type { CostGuardState } from '../lib/costguard/types'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(` ✓ ${name}`) }
  else { fail++; console.error(` ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const URL_ = 'https://www.catchcomics.com/api/costguard/vercel-webhook'

function sign(body: string, secret = SECRET): string {
  return createHmac('sha1', secret).update(body, 'utf8').digest('hex')
}

function makeReq(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(URL_, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** Reset stored state to a known GREEN baseline between cases. */
async function resetState(): Promise<void> {
  const now = new Date().toISOString()
  const st: CostGuardState = {
    state: 'GREEN', since: now, reasons: [], lockdownLatched: false, updatedAt: now,
    lastCollectionAt: now, staleProviders: [], unconfiguredProviders: [],
    totals: { variableMtdUsd: 5, fixedMonthlyUsd: 20, projectedMonthUsd: 12, burnUsdPerDay: 0.4, baselineUsdPerDay: 0.4 },
    perProvider: [], activeRestrictions: [], counters: { abnormalSamples: 0, cleanSamples: 0 },
  }
  await setState(st)
}

function spendBody(pct: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `evt_${pct}_${Math.random().toString(36).slice(2, 10)}`,
    type: 'budget.threshold.reached',
    teamId: 'team_catchcomics',
    payload: { budgetAmount: 100, currentSpend: pct, percentage: pct },
    ...extra,
  })
}

async function main() {
  console.log('\nVercel webhook authentication\n─────────────────────────────')

  // ── Rejection cases: must NOT change state ────────────────────────────────
  {
    await resetState()
    const body = spendBody(100)
    const res = await POST(makeReq(body)) // no signature header
    const after = await getState()
    ok('missing signature → 401', res.status === 401, `got ${res.status}`)
    ok('missing signature does not change state', after?.state === 'GREEN', after?.state)
    ok('missing signature does not latch lockdown', after?.lockdownLatched === false)
  }

  {
    await resetState()
    const body = spendBody(100)
    const res = await POST(makeReq(body, { 'x-vercel-signature': sign(body, 'wrong-secret') }))
    const after = await getState()
    ok('invalid signature → 401', res.status === 401, `got ${res.status}`)
    ok('invalid signature does not change state', after?.state === 'GREEN', after?.state)
  }

  {
    await resetState()
    const body = spendBody(100)
    for (const bad of ['', 'not-hex', 'abc123', 'z'.repeat(40), sign(body) + 'ff']) {
      const res = await POST(makeReq(body, { 'x-vercel-signature': bad }))
      if (res.status !== 401) { ok(`malformed signature "${bad.slice(0, 12)}" → 401`, false, `got ${res.status}`); break }
    }
    const after = await getState()
    ok('malformed signatures → 401', true)
    ok('malformed signature does not change state', after?.state === 'GREEN', after?.state)
  }

  {
    // Correctly signed for ONE body, then the body is tampered with.
    await resetState()
    const original = spendBody(10)
    const signature = sign(original)
    const tampered = spendBody(100)
    const res = await POST(makeReq(tampered, { 'x-vercel-signature': signature }))
    const after = await getState()
    ok('signed-but-tampered body → 401', res.status === 401, `got ${res.status}`)
    ok('tampered body does not escalate', after?.state === 'GREEN', after?.state)
  }

  {
    await resetState()
    const body = '{ this is not json'
    const res = await POST(makeReq(body, { 'x-vercel-signature': sign(body) }))
    const after = await getState()
    ok('valid signature + malformed JSON → 400', res.status === 400, `got ${res.status}`)
    ok('malformed JSON does not change state', after?.state === 'GREEN', after?.state)
  }

  {
    await resetState()
    process.env.VERCEL_TEAM_ID = 'team_catchcomics'
    const body = JSON.stringify({
      id: 'evt_wrongteam', type: 'budget.threshold.reached',
      teamId: 'team_someone_else',
      payload: { budgetAmount: 100, currentSpend: 100, percentage: 100 },
    })
    const res = await POST(makeReq(body, { 'x-vercel-signature': sign(body) }))
    const after = await getState()
    ok('wrong teamId → 403', res.status === 403, `got ${res.status}`)
    ok('wrong teamId does not change state', after?.state === 'GREEN', after?.state)
    delete process.env.VERCEL_TEAM_ID
  }

  {
    await resetState()
    delete process.env.COSTGUARD_WEBHOOK_SECRET
    const body = spendBody(100)
    const res = await POST(makeReq(body, { 'x-vercel-signature': 'a'.repeat(40) }))
    const after = await getState()
    ok('missing signing secret → 503 (fails closed)', res.status === 503, `got ${res.status}`)
    ok('missing secret does not change state', after?.state === 'GREEN', after?.state)
    process.env.COSTGUARD_WEBHOOK_SECRET = SECRET
  }

  console.log('\nThreshold events\n────────────────')

  {
    await resetState()
    const body = spendBody(50)
    const res = await POST(makeReq(body, { 'x-vercel-signature': sign(body) }))
    const after = await getState()
    ok('50% threshold accepted → 200', res.status === 200, `got ${res.status}`)
    ok('50% escalates to RED', after?.state === 'RED', after?.state)
  }

  {
    await resetState()
    const body = spendBody(75)
    const res = await POST(makeReq(body, { 'x-vercel-signature': sign(body) }))
    const after = await getState()
    ok('75% threshold accepted → 200', res.status === 200, `got ${res.status}`)
    ok('75% escalates to RED', after?.state === 'RED', after?.state)
  }

  {
    await resetState()
    const body = spendBody(100)
    const res = await POST(makeReq(body, { 'x-vercel-signature': sign(body) }))
    const after = await getState()
    ok('100% threshold accepted → 200', res.status === 200, `got ${res.status}`)
    ok('100% escalates to LOCKDOWN', after?.state === 'LOCKDOWN', after?.state)
    ok('100% latches lockdown', after?.lockdownLatched === true)
  }

  {
    // End-of-cycle must NOT escalate and must NOT un-latch an existing latch.
    await resetState()
    const lockBody = spendBody(100)
    await POST(makeReq(lockBody, { 'x-vercel-signature': sign(lockBody) }))
    const cycleBody = JSON.stringify({
      id: 'evt_cycle_end', type: 'budget.period.reset', teamId: 'team_catchcomics',
      payload: { budgetAmount: 100, currentSpend: 0, percentage: 0 },
    })
    const res = await POST(makeReq(cycleBody, { 'x-vercel-signature': sign(cycleBody) }))
    const after = await getState()
    ok('end-of-billing-cycle accepted → 200', res.status === 200, `got ${res.status}`)
    ok('cycle end does not un-latch LOCKDOWN', after?.lockdownLatched === true && after?.state === 'LOCKDOWN', after?.state)
    ok('cycle end recorded in reasons',
      Boolean(after?.reasons.some(r => r.includes('billing cycle ended'))), after?.reasons.join('; '))
  }

  {
    // A low-percentage event must not de-escalate a worse state.
    await resetState()
    const high = spendBody(75)
    await POST(makeReq(high, { 'x-vercel-signature': sign(high) }))
    const low = spendBody(10)
    await POST(makeReq(low, { 'x-vercel-signature': sign(low) }))
    const after = await getState()
    ok('later low-percent event never de-escalates RED', after?.state === 'RED', after?.state)
  }

  console.log('\nIdempotency & payload robustness\n────────────────────────────────')

  {
    await resetState()
    const body = spendBody(100)
    const sig = sign(body)
    const first = await POST(makeReq(body, { 'x-vercel-signature': sig }))
    const eventsAfterFirst = (await getEvents()).filter(e => e.kind === 'webhook').length
    const second = await POST(makeReq(body, { 'x-vercel-signature': sig }))
    const third = await POST(makeReq(body, { 'x-vercel-signature': sig }))
    const eventsAfterReplays = (await getEvents()).filter(e => e.kind === 'webhook').length
    const secondJson = await second.json() as { duplicate?: boolean }
    ok('first delivery processed → 200', first.status === 200)
    ok('duplicate delivery acknowledged → 200', second.status === 200 && third.status === 200)
    ok('duplicate flagged as duplicate', secondJson.duplicate === true)
    ok('duplicate delivery adds no extra audit events',
      eventsAfterReplays === eventsAfterFirst, `${eventsAfterFirst} → ${eventsAfterReplays}`)
  }

  {
    // No id field → deterministic body hash still dedupes.
    await resetState()
    const body = JSON.stringify({
      type: 'budget.threshold.reached', teamId: 'team_catchcomics',
      payload: { budgetAmount: 100, currentSpend: 60, percentage: 60 },
    })
    const sig = sign(body)
    await POST(makeReq(body, { 'x-vercel-signature': sig }))
    const before = (await getEvents()).filter(e => e.kind === 'webhook').length
    const dup = await POST(makeReq(body, { 'x-vercel-signature': sig }))
    const after = (await getEvents()).filter(e => e.kind === 'webhook').length
    const dupJson = await dup.json() as { duplicate?: boolean }
    ok('id-less payload dedupes via body hash', dupJson.duplicate === true && before === after)
  }

  {
    await resetState()
    const body = JSON.stringify({
      id: 'evt_extra_fields', type: 'budget.threshold.reached', teamId: 'team_catchcomics',
      unexpectedTop: { nested: [1, 2, 3] }, anotherNew: 'field',
      payload: { budgetAmount: 100, currentSpend: 55, percentage: 55, futureField: true },
    })
    const res = await POST(makeReq(body, { 'x-vercel-signature': sign(body) }))
    const after = await getState()
    ok('unexpected payload fields tolerated → 200', res.status === 200, `got ${res.status}`)
    ok('unexpected fields still escalate correctly', after?.state === 'RED', after?.state)
  }

  {
    // JSON array / primitive bodies must be rejected as malformed, not crash.
    await resetState()
    for (const body of ['[1,2,3]', '"a string"', 'null']) {
      const res = await POST(makeReq(body, { 'x-vercel-signature': sign(body) }))
      if (res.status !== 400) { ok(`non-object JSON (${body}) → 400`, false, `got ${res.status}`); break }
    }
    ok('non-object JSON bodies → 400', true)
    const after = await getState()
    ok('non-object JSON does not change state', after?.state === 'GREEN', after?.state)
  }

  console.log('\nSecret hygiene\n──────────────')

  {
    const events = await getEvents()
    const serialized = JSON.stringify(events)
    ok('signing secret never appears in audit events', !serialized.includes(SECRET))
    const st = await getState()
    ok('signing secret never appears in stored state', !JSON.stringify(st).includes(SECRET))
  }

  {
    const body = spendBody(100)
    const res = await POST(makeReq(body, { 'x-vercel-signature': 'deadbeef' }))
    const text = await res.text()
    ok('error responses never echo the secret', !text.includes(SECRET))
    ok('error responses never echo a computed signature', !text.includes(sign(body)))
  }

  console.log(`\n${pass} passed · ${fail} failed`)
  if (fail > 0) process.exitCode = 1
}

main()
  .catch(err => { console.error('test-costguard-webhook crashed:', err); process.exitCode = 1 })
  .finally(() => { try { rmSync(workDir, { recursive: true, force: true }) } catch { /* Windows lock */ } })
