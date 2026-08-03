/**
 * scripts/costguard-collect.ts — manual Cost Guard collection cycle.
 *
 * Run: npm run costguard:collect
 * Reads provider APIs with whatever credentials .env.local provides, appends
 * a snapshot, re-evaluates the state machine, prints the outcome. Exits 2 on
 * RED, 3 on LOCKDOWN so shell callers can react.
 */

import { runCollection } from '../lib/costguard/collect'

async function main() {
  const { state, snapshot, storeMode, emittedEvents } = await runCollection()

  console.log(`\nCatch Cost Guard — collection ${snapshot.at}`)
  console.log(`store: ${storeMode} · events emitted: ${emittedEvents}`)
  console.log(`\nSTATE: ${state.state}${state.lockdownLatched ? ' (latched)' : ''}`)
  for (const r of state.reasons) console.log(`  - ${r}`)
  console.log(`\nTotals: variable MTD $${state.totals.variableMtdUsd}` +
    ` · projected month $${state.totals.projectedMonthUsd}` +
    ` · burn $${state.totals.burnUsdPerDay}/day` +
    ` (baseline ${state.totals.baselineUsdPerDay === null ? 'n/a' : `$${state.totals.baselineUsdPerDay}/day`})`)
  for (const p of state.perProvider) {
    const flag = !p.configured ? 'NOT CONFIGURED' : p.fresh ? 'fresh' : 'STALE'
    console.log(`  ${p.provider.padEnd(11)} $${String(p.variableMtdUsd).padEnd(8)} proj $${String(p.projectedMonthUsd).padEnd(8)} ${flag}${p.note ? ` — ${p.note}` : ''}`)
  }

  if (state.state === 'RED') process.exitCode = 2
  if (state.state === 'LOCKDOWN') process.exitCode = 3
}

main().catch(err => { console.error('[costguard-collect] failed:', err); process.exitCode = 1 })
