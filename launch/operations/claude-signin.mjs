#!/usr/bin/env node
/**
 * claude-signin.mjs — what runs inside the window the "Sign in to Claude Code"
 * button opens.
 *
 * The founder should never have to open PowerShell, remember `cd`, remember
 * `claude`, or remember which command signs them in. They press one button and
 * this window appears, already in the Catch Comics repo, already running the
 * supported sign-in flow, saying in plain words what it needs from them.
 *
 * WHAT IT DOES
 *   1. Checks first — if Claude Code is already signed in, it says so and
 *      closes rather than putting the founder through a login they do not need.
 *   2. Runs `claude auth login` with the console attached, so Anthropic's own
 *      browser approval happens exactly as it normally does.
 *   3. Re-reads `claude auth status` afterwards and reports the real outcome.
 *      A launched login is not a completed login, and this never claims it is.
 *
 * WHAT IT NEVER DOES
 * It does not type, capture, store or transmit a credential; it does not touch
 * the browser; it does not click a consent button. It starts the official flow
 * and reads the official status. That is the whole of it.
 *
 * Run by launch/operations/claude-readiness.mjs. Standalone equivalent:
 *     node launch/operations/claude-signin.mjs
 */

import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { REPO_ROOT, SIGNIN_COMMAND, findClaude, readAuth } from './claude-readiness.mjs'

const line = '  ' + '─'.repeat(66)
const say = (s = '') => process.stdout.write(s + '\n')

function banner() {
  say()
  say('  ══════════════════════════════════════════════════════════════════')
  say('    CATCH COMICS  ·  SIGN IN TO CLAUDE CODE')
  say('  ══════════════════════════════════════════════════════════════════')
  say()
  say(`    Repo: ${REPO_ROOT}`)
  say()
}

/** Hold the window open so a failure is readable, without hanging for ever. */
function holdOpen(seconds = 300) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const timer = setTimeout(() => { rl.close(); resolve() }, seconds * 1000)
    rl.question('    Press Enter to close this window. ', () => { clearTimeout(timer); rl.close(); resolve() })
  })
}

/** Close on success after a beat, so the founder sees the confirmation. */
function closeIn(seconds) {
  return new Promise(resolve => {
    let left = seconds
    const tick = setInterval(() => {
      left -= 1
      if (left <= 0) { clearInterval(tick); resolve(); return }
      process.stdout.write(`\r    Closing in ${left}s…   `)
    }, 1000)
  })
}

async function main() {
  banner()

  const exe = findClaude()
  if (!exe) {
    say('    Claude Code is NOT INSTALLED on this machine.')
    say()
    say('    Install it once, then press "Sign in to Claude Code" again:')
    say()
    say('        npm i -g @anthropic-ai/claude-code')
    say()
    say(line)
    await holdOpen()
    process.exit(1)
  }

  const before = readAuth(exe)
  if (before.loggedIn) {
    say(`    Already signed in${before.account ? ` as ${before.account}` : ''}. Nothing to do.`)
    say()
    say('    Return to Command Centre — it already says CONNECTED.')
    say()
    await closeIn(6)
    process.exit(0)
  }

  say('    Claude Code is signed out. Starting the official sign-in now.')
  say()
  say('    A browser window will open and ask you to approve the sign-in.')
  say('    That approval is the only thing that needs you.')
  say()
  say(line)
  say()

  // The console this window owns is handed straight to the CLI, so its
  // interactive prompts and the browser hand-off behave exactly as they do
  // when the founder runs it themselves. Fixed argv, no shell.
  const run = spawnSync(exe, ['auth', 'login'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: false,
    windowsHide: false,
  })

  say()
  say(line)
  say()

  const after = readAuth(exe)
  if (after.loggedIn) {
    say(`    ✓  SIGNED IN${after.account ? ` as ${after.account}` : ''}${after.plan ? ` (${after.plan})` : ''}`)
    say()
    say('    Command Centre has already noticed — it now says CONNECTED,')
    say('    and Send-to-Claude in the Smoke Test will work straight away.')
    say()
    await closeIn(8)
    process.exit(0)
  }

  say('    ✗  NOT SIGNED IN — the sign-in did not complete.')
  if (run.error) say(`       The CLI could not be started: ${run.error.message}`)
  say()
  say('    Command Centre is still showing SIGN-IN REQUIRED, which is honest.')
  say('    Press the button again, or run this here yourself:')
  say()
  say(`        ${SIGNIN_COMMAND}`)
  say()
  say(line)
  await holdOpen()
  process.exit(1)
}

main().catch(async err => {
  say()
  say(`    The sign-in helper hit a problem: ${err.message}`)
  say()
  say(`    You can always sign in by hand with:  ${SIGNIN_COMMAND}`)
  say()
  await holdOpen()
  process.exit(1)
})
