#!/usr/bin/env node
/**
 * claude-status.mjs — print Claude Code readiness, from the terminal.
 *
 * The same claude-readiness.mjs Command Centre and the Smoke Test read, with no
 * bridge and no browser in the way. Useful when the founder wants a straight
 * answer, and useful when something upstream is misbehaving and you need to
 * know whether the problem is Claude Code or the page in front of you.
 *
 *   npm run claude:status          human-readable
 *   npm run claude:status -- --json   the raw object
 *
 * Read-only. It starts nothing, signs nothing in, and prints no credential.
 * Exit status is 0 when CONNECTED and 1 otherwise, so a script can branch on it.
 */

import { readiness } from './claude-readiness.mjs'

const r = readiness({ fresh: true })

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(r, null, 2))
} else {
  const mark = r.state === 'connected' ? '✓' : '✗'
  console.log('')
  console.log(`  ${mark}  ${r.headline.toUpperCase()}`)
  console.log(`     ${r.detail}`)
  if (r.claude.installed) console.log(`     CLI: ${r.claude.version ?? 'version unknown'}`)
  console.log(`     Repo: ${r.repo.root}`)
  if (r.state === 'signin-required') {
    console.log('')
    console.log('     Fix it with one click in Command Centre: "Sign in to Claude Code".')
    console.log(`     Or here, by hand:  ${r.signin.command}`)
  }
  if (r.state === 'not-installed') {
    console.log('')
    console.log(`     Install once:  ${r.installCommand}`)
  }
  console.log('')
}

process.exit(r.state === 'connected' ? 0 : 1)
