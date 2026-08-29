#!/usr/bin/env node
/**
 * test-claude-readiness.mjs — proves the Claude Code readiness capability that
 * Command Centre and the Smoke Test both consume.
 *
 * WHAT IT DRIVES FOR REAL
 *   - claude-readiness.mjs, with the CLI replaced by injected readers, so every
 *     state (connected, signed out, not installed, repo missing) is exercised
 *     deterministically WITHOUT touching the founder's real account.
 *   - The console launcher's argv, with a fake spawn — so what would reach
 *     Windows is asserted rather than assumed.
 *   - The live bridge, booted on a spare port, answering /claude/status,
 *     /claude/signin and /claude/open with a fake console launcher underneath.
 *     Nothing opens a window and nothing spends money.
 *   - The real CLI, once, read-only: `claude auth status --json` against a
 *     throwaway CLAUDE_CONFIG_DIR, which is how a signed-out machine is
 *     simulated safely. Skipped with a clear note if the CLI is not installed.
 *
 * Run: npm run test:claude-readiness
 */

import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INSTALL_COMMAND, REPO_ROOT, SIGNIN_COMMAND, SIGNIN_SCRIPT,
  checkRepo, findClaude, launchClaudeInRepo, launchSignin, openConsole,
  readAuth, readiness, resetReadinessCache, signinActive,
} from '../launch/operations/claude-readiness.mjs'

let pass = 0, fail = 0, skip = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}
const skipped = (name, why) => { skip++; console.log(`  – ${name} (skipped: ${why})`) }

/* ── Injected readers: a machine in any state, without changing this one ──── */
const CONNECTED = { loggedIn: true, method: 'claude.ai', account: 'founder@example.com', plan: 'pro', error: null }
const SIGNED_OUT = { loggedIn: false, method: null, account: null, plan: null, error: null }

const deps = ({ exe = 'C:\\fake\\claude.exe', auth = CONNECTED, repo = { ok: true, root: 'C:\\repo', name: 'catch-comics', reason: null }, version = '2.1.251 (Claude Code)' } = {}) => ({
  findClaude: () => exe,
  claudeVersion: () => version,
  readAuth: () => auth,
  checkRepo: () => repo,
})

const read = (opts, o = {}) => { resetReadinessCache(); return readiness({ fresh: true, ...o, deps: deps(opts) }) }

/* ═══ 1. The four states are four states ═══════════════════════════════════ */
console.log('\nEvery failure has its own name — nothing collapses into "Claude failed"')

const connected = read({})
check('a working machine is CONNECTED', connected.state === 'connected', connected.state)
check('the headline is the one the card shows', connected.headline === 'Claude Code · Connected')
check('the version is reported', connected.claude.version === '2.1.251 (Claude Code)')
check('the account is named so the founder can see WHICH account',
  connected.detail.includes('founder@example.com'))

const signedOut = read({ auth: SIGNED_OUT })
check('an expired sign-in is SIGN-IN REQUIRED', signedOut.state === 'signin-required', signedOut.state)
check('sign-in required is not confused with missing', signedOut.claude.installed === true)
check('the headline says sign-in, not failure', signedOut.headline === 'Claude Code · Sign-in required')

const missing = read({ exe: null })
check('no executable is NOT INSTALLED', missing.state === 'not-installed', missing.state)
check('not-installed gives the exact install command', missing.detail.includes(INSTALL_COMMAND))
check('not-installed never claims to know the auth state', missing.auth.loggedIn === false && missing.auth.method === null)

const noRepo = read({ repo: { ok: false, root: 'C:\\wrong', name: 'something-else', reason: 'that directory is "something-else", not catch-comics' } })
check('a missing repo is REPO NOT FOUND, not a sign-in problem', noRepo.state === 'repo-unavailable', noRepo.state)
check('repo trouble still reports Claude as signed in', noRepo.auth.loggedIn === true)
check('the repo reason is specific', /not catch-comics/.test(noRepo.detail))

console.log('\nPrecedence is deliberate')
check('not-installed outranks signed-out (you cannot sign in to nothing)',
  read({ exe: null, auth: SIGNED_OUT }).state === 'not-installed')
check('signed-out outranks a repo problem (fix the sign-in first)',
  read({ auth: SIGNED_OUT, repo: { ok: false, root: 'x', name: null, reason: 'gone' } }).state === 'signin-required')

/* ═══ 2. No credential ever leaves ═════════════════════════════════════════ */
console.log('\nNothing that could be a credential is carried out of the module')

const leaky = readiness({
  fresh: true,
  deps: { ...deps({}), readAuth: () => ({ ...CONNECTED, accessToken: 'sk-ant-SECRET', refreshToken: 'rt-SECRET', orgId: 'org-123' }) },
})
resetReadinessCache()
const serialised = JSON.stringify(leaky)
check('a token in the CLI output never reaches the payload', !/SECRET/.test(serialised))
check('the org id is not carried either', !/org-123/.test(serialised))
check('only the four auth facts are exposed',
  Object.keys(leaky.auth).sort().join(',') === 'account,error,loggedIn,method,plan',
  Object.keys(leaky.auth).join(','))

/* ═══ 3. Caching: honest, and never a subprocess storm ═════════════════════ */
console.log('\nStatus is cached, so opening a page cannot spawn the CLI repeatedly')

resetReadinessCache()
let authCalls = 0
const counting = { ...deps({}), readAuth: () => { authCalls++; return CONNECTED } }
const t0 = 1_000_000
readiness({ now: t0, deps: counting })
readiness({ now: t0 + 500, deps: counting })
readiness({ now: t0 + 19_000, deps: counting })
check('three reads inside the idle window spawn the CLI once', authCalls === 1, `got ${authCalls}`)
readiness({ now: t0 + 21_000, deps: counting })
check('a read after the idle window asks again', authCalls === 2, `got ${authCalls}`)

resetReadinessCache()
authCalls = 0
readiness({ fresh: true, now: t0, deps: counting })
readiness({ fresh: true, now: t0 + 1_000, deps: counting })
readiness({ fresh: true, now: t0 + 2_000, deps: counting })
check('even "fresh" polling is floor-limited to one call per 2.5s', authCalls === 1, `got ${authCalls}`)
readiness({ fresh: true, now: t0 + 2_600, deps: counting })
check('past the floor, a fresh read really is fresh', authCalls === 2, `got ${authCalls}`)

resetReadinessCache()
check('nothing is polling before a sign-in is launched', signinActive() === false)

/* ═══ 4. The console launcher's argv ═══════════════════════════════════════ */
console.log('\nWhat would reach Windows is a fixed argv, not a command string')

function fakeSpawn() {
  const calls = []
  const fn = (exe, argv, opts) => { calls.push({ exe, argv, opts }); const c = new EventEmitter(); c.unref = () => {}; return c }
  fn.calls = calls
  return fn
}

if (process.platform !== 'win32') {
  skipped('console launcher argv', 'not Windows')
} else {
  const sp = fakeSpawn()
  openConsole({ title: 'Catch Comics - test', exe: 'C:\\fake\\claude.exe', args: ['auth', 'login'], cwd: 'C:\\repo', spawnFn: sp })
  const c = sp.calls[0]
  check('exactly one process is started', sp.calls.length === 1)
  check('it goes through cmd start, which is what creates a visible console',
    /cmd\.exe$/i.test(c.exe) && c.argv[0] === '/c' && c.argv[1] === 'start')
  check('the window is titled', c.argv[2] === 'Catch Comics - test')
  check('the working directory is passed to start, so it opens IN the repo',
    c.argv[3] === '/D' && c.argv[4] === 'C:\\repo')
  check('the executable and its arguments are separate argv entries',
    c.argv.slice(5).join(' ') === 'C:\\fake\\claude.exe auth login')
  check('no shell interprets any of it', c.opts.shell === false)
  check('the child is detached so closing Command Centre does not kill the login',
    c.opts.detached === true)
  check('the console is NOT hidden — the founder has to be able to use it',
    c.opts.windowsHide === false)

  console.log('\nA path carrying console punctuation is refused, not executed')
  const meta = ['C:\\repo & evil', 'C:\\repo | evil', 'C:\\repo > evil', 'C:\\re"po', 'C:\\repo\nevil']
  check('every shell metacharacter in a path is rejected', meta.every(bad => {
    try { openConsole({ title: 't', exe: 'C:\\c.exe', args: [], cwd: bad, spawnFn: fakeSpawn() }); return false }
    catch { return true }
  }))
  check('a metacharacter in an argument is rejected too', (() => {
    try { openConsole({ title: 't', exe: 'C:\\c.exe', args: ['a & b'], cwd: 'C:\\repo', spawnFn: fakeSpawn() }); return false }
    catch { return true }
  })())
}

/* ═══ 5. Sign-in and open, as actions ══════════════════════════════════════ */
console.log('\nThe two launch actions do exactly what the buttons promise')

if (process.platform !== 'win32') {
  skipped('launch actions', 'not Windows')
} else {
  resetReadinessCache()
  const sp = fakeSpawn()
  const res = launchSignin({ spawnFn: sp, now: 2_000_000 })
  const real = existsSync(findClaude() ?? '')
  if (!real) {
    skipped('sign-in launch', 'Claude Code is not installed on this machine')
  } else {
    check('sign-in reports that it launched', res.launched === true)
    check('it opens ONE window', sp.calls.length === 1)
    check('the window runs node against the fixed sign-in script',
      sp.calls[0].argv[5] === process.execPath && sp.calls[0].argv[6] === SIGNIN_SCRIPT)
    check('the sign-in script really exists', existsSync(SIGNIN_SCRIPT))
    check('the window opens in the Catch Comics repo', sp.calls[0].argv[4] === REPO_ROOT)
    check('launching a sign-in is what starts the bounded polling window', signinActive(2_000_001) === true)
    check('the polling window closes on its own after 15 minutes', signinActive(2_000_000 + 16 * 60_000) === false)

    resetReadinessCache()
    const sp2 = fakeSpawn()
    const opened = launchClaudeInRepo({ spawnFn: sp2 })
    check('"Open Claude Code" launches exactly one process', sp2.calls.length === 1)
    check('it launches Claude Code itself, with no arguments',
      opened.launched === true && sp2.calls[0].argv.length === 6 && sp2.calls[0].argv[5] === findClaude())
    check('it starts in the Catch Comics repo — no cd required',
      sp2.calls[0].argv[3] === '/D' && sp2.calls[0].argv[4] === REPO_ROOT)
  }
}

/* ═══ 6. The repo really is validated ══════════════════════════════════════ */
console.log('\nThe repo path is proved, not assumed')

const here = checkRepo()
check('this repo validates as catch-comics', here.ok === true && here.name === 'catch-comics', here.reason ?? '')
const elsewhere = checkRepo(tmpdir())
check('a directory that is not the repo is refused', elsewhere.ok === false)
check('and it says why', typeof elsewhere.reason === 'string' && elsewhere.reason.length > 0)

/* ═══ 7. The live bridge answers all three routes ══════════════════════════ */
console.log('\nThe bridge exposes readiness as three fixed actions and nothing more')

const bridgeSrc = readFileSync(resolve(fileURLToPath(import.meta.url), '..', '..', 'launch', 'operations', 'browser-trust-bridge.mjs'), 'utf8')
check('the bridge still binds to loopback only',
  /server\.listen\(PORT,\s*HOST/.test(bridgeSrc) && /const HOST = '127\.0\.0\.1'/.test(bridgeSrc))
check('the origin allowlist is still just the local Command Centre',
  /ALLOWED_ORIGINS = new Set\(\[\s*'http:\/\/localhost:8317',\s*'http:\/\/127\.0\.0\.1:8317',\s*\]\)/.test(bridgeSrc))
check('the Claude routes take no argument from the request',
  !/claude\/(status|signin|open)[\s\S]{0,900}?(searchParams\.get\(['"](?!fresh)|body\.(cmd|command|exe|args|path))/.test(bridgeSrc))
check('the sign-in route cannot be told what to run',
  /launchSignin\(\{\s*now\s*\}\)/.test(bridgeSrc))
check('the open route cannot be told where to open',
  /launchClaudeInRepo\(\)/.test(bridgeSrc))
check('a second sign-in window is guarded against',
  /RELAUNCH_GUARD_MS/.test(bridgeSrc) && /already-open/.test(bridgeSrc))
check('a double-click on Open Claude Code is guarded against',
  /OPEN_GUARD_MS/.test(bridgeSrc) && /just-opened/.test(bridgeSrc))
check('opening Claude is refused unless the state is genuinely connected',
  /state\.state !== 'connected'[\s\S]{0,220}?reason: state\.state/.test(bridgeSrc))

/* ═══ 8. The real CLI, read-only, with a throwaway config ══════════════════ */
console.log('\nThe installed CLI is asked the way this module says it asks')

const exe = findClaude()
if (!exe) {
  skipped('real CLI probes', 'Claude Code is not installed on this machine')
} else {
  const help = spawnSync(exe, ['auth', '--help'], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
  const helpText = String(help.stdout || '') + String(help.stderr || '')
  check('this CLI really has `claude auth status`', /\bstatus\b/.test(helpText), helpText.slice(0, 120))
  check('this CLI really has `claude auth login`', /\blogin\b/.test(helpText))
  check('the fallback command we print is the one the CLI documents',
    SIGNIN_COMMAND === 'claude auth login' && /\blogin\b/.test(helpText))

  const live = readAuth(exe)
  check('the live machine answers with a boolean, not a guess', typeof live.loggedIn === 'boolean')
  check('no token comes back from the real CLI either', !/token/i.test(JSON.stringify(live)))

  // A SAFE, STABLE signed-out simulation: give the CLI a throwaway home AND a
  // throwaway config directory. Both are needed — with only CLAUDE_CONFIG_DIR
  // the CLI seeds the new directory from the real credentials a moment later,
  // and the simulation silently turns back into a signed-in one. The founder's
  // real credentials are never read, written or invalidated either way.
  const fakeHome = mkdtempSync(join(tmpdir(), 'cc-claudehome-'))
  const signedOutEnv = { ...process.env, USERPROFILE: fakeHome, HOME: fakeHome, CLAUDE_CONFIG_DIR: join(fakeHome, '.claude') }
  try {
    const seen = []
    for (let i = 0; i < 2; i++) {
      const r = spawnSync(exe, ['auth', 'status', '--json'], { encoding: 'utf8', timeout: 60_000, windowsHide: true, env: signedOutEnv })
      try { seen.push(JSON.parse(String(r.stdout || '')).loggedIn) } catch { seen.push('unparseable') }
    }
    check('the throwaway-home probe returns the documented JSON',
      seen.every(v => typeof v === 'boolean'), `saw ${JSON.stringify(seen)}`)
    // Whether a fresh home actually READS as signed out is the CLI's business,
    // not this repo's: it seeds a new directory from the real credentials at a
    // time of its choosing. Report it rather than failing the suite over it —
    // every signed-out BEHAVIOUR above is already covered deterministically by
    // the injected readers, which owe nothing to the CLI's seeding schedule.
    if (seen.every(v => v === false)) check('a signed-out machine can be simulated without touching the real account', true)
    else skipped('signed-out simulation via a throwaway home', `the CLI reseeded this run (saw ${JSON.stringify(seen)})`)
    check('the real account is still signed in afterwards', readAuth(exe).loggedIn === live.loggedIn)
  } finally {
    rmSync(fakeHome, { recursive: true, force: true })
  }
}

resetReadinessCache()
console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}\n`)
process.exit(fail === 0 ? 0 : 1)
