/**
 * scripts/costguard-clear-lockdown.ts — founder-only LOCKDOWN release.
 *
 * Run: npm run costguard:clear -- --confirm CLEAR
 *
 * LOCKDOWN latches deliberately: the engine never un-latches it, a webhook
 * cannot un-latch it, and there is no HTTP endpoint that can un-latch it —
 * only this local CLI with the founder's machine + env. The state drops to
 * RED (not GREEN); normal hysteresis then walks it down as clean samples
 * accumulate.
 */

import { COSTGUARD_CONFIG as CFG } from '../lib/costguard/config'
import { appendEvent, getState, setState } from '../lib/costguard/store'

async function main() {
  const confirmIdx = process.argv.indexOf('--confirm')
  if (confirmIdx === -1 || process.argv[confirmIdx + 1] !== 'CLEAR') {
    console.error('Refusing: run with `--confirm CLEAR` to acknowledge you have reviewed the incident.')
    process.exitCode = 1
    return
  }

  const state = await getState()
  if (!state) { console.log('No Cost Guard state exists — nothing to clear.'); return }
  if (!state.lockdownLatched && state.state !== 'LOCKDOWN') {
    console.log(`State is ${state.state} with no lockdown latch — nothing to clear.`)
    return
  }

  const now = new Date().toISOString()
  state.lockdownLatched = false
  state.state = 'RED'
  state.since = now
  state.updatedAt = now
  state.reasons = [
    'LOCKDOWN cleared by founder via costguard:clear — holding RED until clean samples accumulate.',
    ...state.reasons,
  ].slice(0, 8)
  state.counters = { abnormalSamples: 0, cleanSamples: 0 }
  await setState(state)

  await appendEvent(
    {
      at: now,
      kind: 'lockdown-cleared',
      provider: 'global',
      message: 'LOCKDOWN latch cleared by founder (costguard:clear). State set to RED; recovery proceeds by hysteresis.',
      detail: { action: 'lockdown-cleared', newState: 'RED' },
    },
    CFG.alertDedupeWindowMs,
  )
  console.log('LOCKDOWN latch cleared. State is now RED and will recover through AMBER to GREEN as clean samples accumulate.')
}

main().catch(err => { console.error('[costguard-clear] failed:', err); process.exitCode = 1 })
