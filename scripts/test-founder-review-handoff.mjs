#!/usr/bin/env node
/**
 * test-founder-review-handoff.mjs — proves the Smoke Test V4 one-click handoff.
 *
 * It drives the REAL handler with a deterministic four-issue, four-screenshot
 * founder review and asserts what actually lands on disk. Claude Code itself is
 * replaced by a fake spawn so the test never spends money, never edits the repo
 * and never depends on being signed in — but the argv the fake receives is the
 * argv the real binary would get, so the launch contract is genuinely covered.
 *
 * Everything is written under a throwaway repo root in the OS temp directory.
 * Nothing here touches launch/reviews/ in the real repo.
 *
 * Run: npm run test:founder-review
 */

import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import {
  ALLOWED_TOOLS, DISALLOWED_TOOLS, LIMITS, PAGE_IDS, ReviewRunner, STALE_REASON,
  VERIFY_SCRIPTS, ValidationError, classifyRun, countEvidence, decodeImage,
  describeActivity, packageDir, permissionFor, pidAlive, validateSubmission,
} from '../launch/operations/founder-review-handler.mjs'
import { WorktreeError, ensureRepairWorktree } from '../launch/operations/repair-worktree.mjs'

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}
const throws = (name, fn, match) => {
  try { fn(); check(name, false, 'did not throw') }
  catch (e) {
    const ok = e instanceof ValidationError && (!match || match.test(e.message))
    check(name, ok, ok ? '' : `threw ${e.constructor.name}: ${e.message}`)
  }
}
/** Same, for the worktree module's own refusals. */
const throwsWorktree = (name, fn) => {
  try { fn(); check(name, false, 'did not throw') }
  catch (e) {
    check(name, e instanceof WorktreeError, `threw ${e.constructor.name}: ${e.message}`)
  }
}

const REPO = mkdtempSync(join(tmpdir(), 'cc-frv4-'))

/* ── Fixtures ────────────────────────────────────────────────────────────────
   Real 1x1 images, so the magic-byte check is exercised rather than mocked. */
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const ISSUE_UIDS = ['a1b2c3', 'd4e5f6', 'g7h8i9', 'j0k1l2']

/** The founder journey from the brief: four issues, four screenshots, one page. */
function homepageReview(reviewId = 'homepage-2026-08-24-1930-abc123') {
  return {
    reviewId,
    tool: 'smoke-test-v4',
    page: { id: 'homepage', title: 'Homepage', url: '/' },
    verdict: 'fix',
    checkpoints: [
      { label: 'Hero loads within 2s', checked: true, note: '' },
      { label: 'Price Finds Today renders', checked: true, note: 'but see issue 2' },
      { label: 'Footer links resolve', checked: false, note: '' },
    ],
    issues: [
      { uid: ISSUE_UIDS[0], problem: 'Navbar logo is misaligned on desktop.', expected: 'Logo sits on the same baseline as the nav links.', createdAt: 1756060000000 },
      { uid: ISSUE_UIDS[1], problem: 'Price Finds Today hover enlargement is clipped by its container.', expected: 'Hovered card scales above surrounding cards without being cropped.', createdAt: 1756060100000 },
      { uid: ISSUE_UIDS[2], problem: 'Footer newsletter box overflows on 1280px.', expected: '', createdAt: 1756060200000 },
      { uid: ISSUE_UIDS[3], problem: 'Series rail scrollbar is visible and ugly.', expected: 'Scrollbar hidden, rail still scrollable.', createdAt: 1756060300000 },
    ],
    screenshots: [
      { issueUid: ISSUE_UIDS[0], note: 'red circle on the logo', annotated: true, dataUrl: JPEG_1PX },
      { issueUid: ISSUE_UIDS[1], note: 'arrow shows the clipped edge', annotated: true, dataUrl: JPEG_1PX },
      { issueUid: ISSUE_UIDS[2], note: 'box spills past the container', annotated: false, dataUrl: PNG_1PX },
      { issueUid: ISSUE_UIDS[3], note: 'scrollbar visible under the rail', annotated: true, dataUrl: JPEG_1PX },
    ],
  }
}

/* ── A fake Claude Code ──────────────────────────────────────────────────────
   Same stdout shape the real binary emits with --output-format stream-json, so
   the runner's parsing is exercised for real. */
function fakeClaude({ initDelay = 0, exitCode = 0, result = null, throwOnSpawn = null, pid = process.pid, neverExit = false, turns = [] } = {}) {
  const calls = []
  const fn = (exe, argv, opts) => {
    calls.push({ exe, argv, opts })
    if (throwOnSpawn) throw new Error(throwOnSpawn)
    const child = new EventEmitter()
    // A real spawned child always has a pid, and the runner now refuses to
    // call anything `running` without one. Using this process's own pid keeps
    // the liveness check genuinely exercised rather than stubbed past:
    // it is a number that really is alive.
    child.pid = pid
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    setTimeout(() => {
      child.stdout.emit('data', JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-fake-0001' }) + '\n')
      // The turns a real repair emits while it works. They are what the card
      // shows instead of a spinner, so the parsing that lifts them out has to
      // be exercised here rather than assumed.
      for (const t of turns) child.stdout.emit('data', JSON.stringify(t) + '\n')
      // A child that announces itself and then never exits — the shape a repair
      // has while it is genuinely working, and the one a bridge that dies
      // leaves behind with nobody to hear its exit.
      if (neverExit) return
      setTimeout(() => {
        if (result) child.stdout.emit('data', JSON.stringify({ type: 'result', ...result }) + '\n')
        child.emit('exit', exitCode)
      }, 5)
    }, initDelay)
    return child
  }
  fn.calls = calls
  return fn
}

const OK_RESULT = { is_error: false, result: 'Repaired 4 issues.', total_cost_usd: 1.23, session_id: 'sess-fake-0001' }
const settle = () => new Promise(r => setTimeout(r, 60))

/* A machine whose Claude Code readiness we control. The handler asks this
   before launching, so the tests can drive a signed-out machine without going
   anywhere near the founder's real account. */
const READY = { state: 'connected', claude: { installed: true, version: '2.1.251 (Claude Code)' } }
const SIGNED_OUT = { state: 'signin-required', claude: { installed: true, version: '2.1.251 (Claude Code)' } }

/* A stand-in for the isolated repair worktree. The real one needs git and a
   real repository; that is proven for real in section 9, against an actual
   repo with dirty files in it. Everywhere else the point under test is the
   launch contract, not git, so this keeps those tests hermetic. */
const FAKE_TREE = reviewId => ({
  path: join(REPO, '..', 'cc-frv4-repairs', reviewId),
  branch: `repair/${reviewId}`,
  base: 'a1b2c3d4e5f6',
  reused: false,
  linkedModules: true,
  copiedPackage: true,
})

const runner = (opts = {}) => new ReviewRunner(REPO, {
  spawnFn: opts.spawnFn ?? fakeClaude(opts.claude),
  findClaudeFn: opts.findClaudeFn ?? (() => 'C:\\fake\\claude.exe'),
  readinessFn: opts.readinessFn ?? (() => READY),
  worktreeFn: opts.worktreeFn ?? ((repoRoot, reviewId) => FAKE_TREE(reviewId)),
})

/* ═══ 1. Validation and path safety ═════════════════════════════════════════ */
console.log('\nValidation refuses anything that could escape or bloat')

throws('a reviewId with a traversal segment is refused',
  () => validateSubmission({ ...homepageReview('../../../etc/passwd'), page: { id: 'homepage', title: 'x', url: '/' } }),
  /lowercase letters, digits and hyphens/)
throws('a reviewId with a path separator is refused',
  () => validateSubmission(homepageReview('homepage/../../evil')), /lowercase letters/)
throws('a reviewId with a backslash is refused',
  () => validateSubmission(homepageReview('homepage\\evil')), /lowercase letters/)
throws('a reviewId not starting with its page id is refused',
  () => validateSubmission(homepageReview('search-2026-01-01-0000-aaa')), /must start with its page id/)
throws('an unknown page id is refused',
  () => validateSubmission({ ...homepageReview('evilpage-2026-01-01-0000-a'), page: { id: 'evilpage', title: 'x', url: '/' } }),
  /Unknown page/)
throws('a non-image data URL is refused', () => validateSubmission({
  ...homepageReview(), screenshots: [{ issueUid: null, note: '', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }],
}), /only base64 image/)
throws('an image whose bytes are not an image is refused', () => validateSubmission({
  ...homepageReview(), screenshots: [{ issueUid: null, note: '', dataUrl: 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') }],
}), /not a JPEG or PNG/)
throws('a review with no evidence at all is refused', () => validateSubmission({
  reviewId: 'homepage-2026-08-24-1930-abc123', page: { id: 'homepage', title: 'Homepage', url: '/' },
  verdict: null, issues: [], screenshots: [], checkpoints: [],
}), /Nothing to send/)
throws('too many screenshots is refused', () => validateSubmission({
  ...homepageReview(), screenshots: Array.from({ length: LIMITS.SHOTS + 1 }, () => ({ issueUid: null, note: '', dataUrl: JPEG_1PX })),
}), /More than 40 screenshots/)

check('packageDir stays inside launch/reviews', (() => {
  try { packageDir(REPO, '..\\..\\evil'); return false } catch (e) { return e instanceof ValidationError }
})())
check('every Smoke Test page id is accepted', PAGE_IDS.every(id => {
  try { validateSubmission({ ...homepageReview(`${id}-2026-01-01-0000-aa`), page: { id, title: id, url: '/' } }); return true }
  catch { return false }
}))
check('control characters are stripped from founder text', (() => {
  const v = validateSubmission({ ...homepageReview(), issues: [{ uid: 'x1', problem: 'clean\u001b[31mtext\u0000here', expected: '' }] })
  return v.issues[0].problem === 'cleantexthere' || v.issues[0].problem === 'clean[31mtexthere'
})())
check('newlines in founder text survive', (() => {
  const v = validateSubmission({ ...homepageReview(), issues: [{ uid: 'x1', problem: 'line one\nline two', expected: '' }] })
  return v.issues[0].problem === 'line one\nline two'
})())
check('a JPEG is detected from its bytes', decodeImage(JPEG_1PX, 'x').ext === 'jpg')
check('a PNG is detected from its bytes', decodeImage(PNG_1PX, 'x').ext === 'png')

/* ═══ 2. The package on disk ════════════════════════════════════════════════ */
console.log('\nFour issues and four screenshots land as real files')

const r1 = runner({ claude: { result: OK_RESULT } })
const rec1 = r1.submit(homepageReview())
const dir1 = packageDir(REPO, 'homepage-2026-08-24-1930-abc123')

check('the package directory is the review id', existsSync(dir1))
check('review.json exists', existsSync(join(dir1, 'review.json')))
check('review.md exists', existsSync(join(dir1, 'review.md')))
check('four issues were counted', rec1.counts.issues === 4, `got ${rec1.counts.issues}`)
check('four screenshots were counted', rec1.counts.screenshots === 4, `got ${rec1.counts.screenshots}`)

const json1 = JSON.parse(readFileSync(join(dir1, 'review.json'), 'utf8'))
const md1 = readFileSync(join(dir1, 'review.md'), 'utf8')

check('every screenshot is a real non-empty file on disk',
  json1.screenshots.every(s => existsSync(join(dir1, ...s.file.split('/'))) && statSync(join(dir1, ...s.file.split('/'))).size > 0))
check('screenshots live in a screenshots/ subdirectory',
  json1.screenshots.every(s => s.file.startsWith('screenshots/')))
check('a PNG screenshot keeps its .png extension',
  json1.screenshots.some(s => s.file.endsWith('.png')) && json1.screenshots.some(s => s.file.endsWith('.jpg')))

console.log('\nEach issue maps to the correct screenshot')
check('issue ids are stable and ordered', json1.issues.map(i => i.id).join(',') === 'issue-01,issue-02,issue-03,issue-04')
check('every issue carries its own screenshot', json1.issues.every(i => i.screenshots.length === 1))
check('issue-02 is the hover-clipping issue', /hover enlargement is clipped/.test(json1.issues[1].problem))
check('issue-02 owns the file named for issue-02', json1.issues[1].screenshots[0] === 'screenshots/issue-02-shot-1.jpg')
check('issue-02 carries its own screenshot note', json1.issues[1].notes.join() === 'arrow shows the clipped edge')
check('no screenshot is claimed by two issues',
  new Set(json1.issues.flatMap(i => i.screenshots)).size === json1.issues.flatMap(i => i.screenshots).length)
check('every screenshot filename names its issue',
  json1.screenshots.every(s => s.issue === null || s.file.includes(s.issue)))
check('the founder uid is preserved alongside the ordinal id',
  json1.issues.map(i => i.uid).join(',') === ISSUE_UIDS.join(','))
check('each issue has a creation timestamp', json1.issues.every(i => typeof i.createdAt === 'string' && i.createdAt.includes('T')))
check('each issue records page and section', json1.issues.every(i => i.page === 'homepage' && i.section === 'Homepage'))
check('severity is left for Claude to decide', json1.issues.every(i => i.severity === null))
check('the founder verdict is carried', json1.founderVerdict === 'NEEDS FIXING')
check('expected behaviour is captured when given', json1.issues[1].expected === 'Hovered card scales above surrounding cards without being cropped.')
check('a missing expected behaviour is null, not invented', json1.issues[2].expected === null)

console.log('\nreview.md is complete and unambiguous')
check('review.md names every issue', ['issue-01', 'issue-02', 'issue-03', 'issue-04'].every(id => md1.includes(`### ${id}`)))
check('review.md lists the exact screenshot path under its issue',
  md1.includes('`screenshots/issue-02-shot-1.jpg`'))
check('review.md carries the checkpoint state', md1.includes('[x] Hero loads within 2s') && md1.includes('[ ] Footer links resolve'))
check('review.md carries a checkpoint note', md1.includes('NOTE: but see issue 2'))
check('review.md tells the reader to open the images', /Open the images/.test(md1))
check('review.md records the verdict', md1.includes('FOUNDER VERDICT: NEEDS FIXING'))

console.log('\nMission Control keeps getting its data without a picker')
const frj = JSON.parse(readFileSync(join(REPO, 'launch', 'founder-review.json'), 'utf8'))
check('founder-review.json records the page verdict', frj.pages.homepage.status === 'fix')
check('founder-review.json records the checkpoint tally', frj.pages.homepage.checkpoints === '2/3', frj.pages.homepage.checkpoints)
check('founder-review.json records the screenshot count', frj.pages.homepage.shots === 4)
check('founder-review.json records the issue count', frj.pages.homepage.issues === 4)
check('founder-review.json links back to the package', frj.pages.homepage.lastReviewId === 'homepage-2026-08-24-1930-abc123')
check('founder-review.json keeps the tool marker mission-control reads', frj.tool === 'smoke-test-v4')
check('a second page does not erase the first', (() => {
  const rOther = runner({ claude: { result: OK_RESULT } })
  rOther.submit({ ...homepageReview('search-2026-08-24-1940-other1'), page: { id: 'search', title: 'Search', url: '/search' }, verdict: 'good' })
  const d = JSON.parse(readFileSync(join(REPO, 'launch', 'founder-review.json'), 'utf8'))
  return d.pages.homepage.status === 'fix' && d.pages.search.status === 'good'
})())

/* ═══ 3. Orphaned links degrade honestly ════════════════════════════════════ */
console.log('\nA screenshot pointing at a deleted issue is not lost')
const orphan = homepageReview('homepage-2026-08-24-1931-orph01')
orphan.screenshots[0].issueUid = 'deleted-uid-999'
const rOrph = runner({ claude: { result: OK_RESULT } })
rOrph.submit(orphan)
const orphJson = JSON.parse(readFileSync(join(packageDir(REPO, 'homepage-2026-08-24-1931-orph01'), 'review.json'), 'utf8'))
check('the orphan becomes a page-level screenshot', orphJson.screenshots.some(s => s.issue === null && s.file === 'screenshots/page-shot-1.png' || s.file === 'screenshots/page-shot-1.jpg'))
check('the orphan is still written to disk', orphJson.screenshots.every(s => existsSync(join(packageDir(REPO, 'homepage-2026-08-24-1931-orph01'), ...s.file.split('/')))))
check('all four screenshots survive an orphaned link', orphJson.counts.screenshots === 4)

/* ═══ 4. The Claude launch contract ═════════════════════════════════════════ */
console.log('\nClaude Code is launched exactly once, pointed at the package')

const spawn1 = fakeClaude({ result: OK_RESULT })
const r2 = runner({ spawnFn: spawn1 })
const rec2 = r2.submit(homepageReview('homepage-2026-08-24-1932-launch'))

check('exactly one Claude process was started', spawn1.calls.length === 1, `got ${spawn1.calls.length}`)
const argv = spawn1.calls[0].argv
const promptArg = argv[argv.indexOf('-p') + 1]
check('the prompt carries the exact package path', promptArg.includes('launch/reviews/homepage-2026-08-24-1932-launch/review.md'))
check('the prompt points at review.json too', promptArg.includes('launch/reviews/homepage-2026-08-24-1932-launch/review.json'))
check('the prompt points at the screenshots directory', promptArg.includes('launch/reviews/homepage-2026-08-24-1932-launch/screenshots/'))
check('Claude is told to actually LOOK at the images', /Use the Read tool on each image file so you actually SEE it/.test(promptArg))
check('Claude is told the screenshots carry annotations', /annotations/.test(promptArg))
check('Claude is told to respect the issue mapping', /respect that mapping/.test(promptArg))
check('Claude is told not to weaken tests', /Do not weaken, skip or delete tests/.test(promptArg))
check('Claude is told to preserve unrelated work', /Preserve unrelated work/.test(promptArg))
check('Claude is told to report issue-by-issue', /issue-by-issue report/.test(promptArg))
check('Claude is told not to run unrelated audits', /Do not perform unrelated audits/.test(promptArg))
check('the run happens in the isolated repair worktree, NOT the founder\'s checkout',
  spawn1.calls[0].opts.cwd === FAKE_TREE('homepage-2026-08-24-1932-launch').path && spawn1.calls[0].opts.cwd !== REPO)
check('the record says where the repair worktree is', rec2.worktreePath === FAKE_TREE(rec2.reviewId).path)
check('the record says which branch the repair commits on', rec2.branch === 'repair/homepage-2026-08-24-1932-launch')
check('the record remembers the commit it started from', rec2.baseCommit === 'a1b2c3d4e5f6')
check('the prompt tells Claude which branch it is on', promptArg.includes('repair/homepage-2026-08-24-1932-launch'))
check('the prompt tells Claude the founder\'s checkout is out of bounds',
  /out of bounds/.test(promptArg) && /do not use `git -C`/.test(promptArg))
check('the prompt names the verification commands it may run',
  promptArg.includes('npm run check') && promptArg.includes('npm run lint'))
check('the prompt tells Claude not to hunt for another spelling of a refused command',
  /do NOT hunt for another spelling/.test(promptArg))
check('the prompt tells Claude to finish on a commit', /FINISH ON A COMMIT/.test(promptArg))
check('no shell is involved', spawn1.calls[0].opts.shell === false)
check('push and deploy are denied', (() => {
  const i = argv.indexOf('--disallowedTools')
  const denied = argv.slice(i + 1).join(' ')
  return i > -1 && denied.includes('git push') && denied.includes('vercel')
})())
check('the session cannot exceed a spend ceiling', argv[argv.indexOf('--max-budget-usd') + 1] === '15')
check('no founder text reaches the argv beyond the fixed prompt',
  !argv.some(a => a !== promptArg && /hover enlargement|Navbar logo|scrollbar/i.test(a)))
check('the fixed prompt does not contain founder text either',
  !/hover enlargement|Navbar logo/i.test(promptArg))

/* ═══ 5. Honest states ══════════════════════════════════════════════════════ */
console.log('\nStates report what actually happened')

check('a launched run is not reported as complete', rec2.state === 'launching' || rec2.state === 'running')
await settle()
check('a finished run is reported complete', r2.get(rec2.reviewId).state === 'completed', r2.get(rec2.reviewId).state)
check('the session id is captured for resuming', r2.get(rec2.reviewId).sessionId === 'sess-fake-0001')
check('the cost is recorded', r2.get(rec2.reviewId).costUsd === 1.23)
check('a transcript was written', existsSync(join(packageDir(REPO, rec2.reviewId), 'claude-run.jsonl')))
check('run.json records the outcome next to the review',
  JSON.parse(readFileSync(join(packageDir(REPO, rec2.reviewId), 'run.json'), 'utf8')).state === 'completed')

const rNoCli = runner({ findClaudeFn: () => null })
const recNoCli = rNoCli.submit(homepageReview('homepage-2026-08-24-1933-nocli'))
check('a missing Claude CLI is BLOCKED, not failed', recNoCli.state === 'blocked', recNoCli.state)
check('the blocked reason says what to do', /Install it|claude login/.test(recNoCli.reason))
check('the review package survives a blocked launch',
  existsSync(join(packageDir(REPO, 'homepage-2026-08-24-1933-nocli'), 'review.json')))
check('all four screenshots survive a blocked launch',
  JSON.parse(readFileSync(join(packageDir(REPO, 'homepage-2026-08-24-1933-nocli'), 'review.json'), 'utf8')).counts.screenshots === 4)

const rAuth = runner({ claude: { exitCode: 1, result: { is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' } } })
const recAuth = rAuth.submit(homepageReview('homepage-2026-08-24-1934-auth01'))
await settle()
check('an auth failure is BLOCKED, not a product failure', rAuth.get(recAuth.reviewId).state === 'blocked', rAuth.get(recAuth.reviewId).state)
check('the auth message names the one-click sign-in, not a command to remember',
  /Sign in to Claude Code/.test(rAuth.get(recAuth.reviewId).reason))
check('the manual fallback is still there for anyone who wants it',
  /claude auth login/.test(rAuth.get(recAuth.reviewId).reason))
check('the auth message promises the review is safe',
  /review is saved/i.test(rAuth.get(recAuth.reviewId).reason))

/* ── A signed-out machine is caught BEFORE Claude is launched ───────────────
   This is the founder's actual complaint: an expired sign-in used to be
   discovered by starting a session that then failed. Now readiness is asked
   first, and the answer costs nothing but a Retry.                          */
console.log('\nAn expired sign-in never costs the founder their review')
const spawnSignedOut = fakeClaude({ result: OK_RESULT })
const rOut = runner({ spawnFn: spawnSignedOut, readinessFn: () => SIGNED_OUT })
const recOut = rOut.submit(homepageReview('homepage-2026-08-24-1941-signout'))
const dirOut = packageDir(REPO, 'homepage-2026-08-24-1941-signout')
check('a signed-out machine is BLOCKED, not failed', recOut.state === 'blocked', recOut.state)
check('no Claude process is started at all', spawnSignedOut.calls.length === 0, `got ${spawnSignedOut.calls.length}`)
check('the reason names the sign-in button', /Sign in to Claude Code/.test(recOut.reason))
check('the review package was still written', existsSync(join(dirOut, 'review.json')))
check('every screenshot survived',
  JSON.parse(readFileSync(join(dirOut, 'review.json'), 'utf8')).counts.screenshots === 4)
check('the screenshot FILES survived, not just the count',
  JSON.parse(readFileSync(join(dirOut, 'review.json'), 'utf8')).screenshots
    .every(s => existsSync(join(dirOut, ...s.file.split('/'))) && statSync(join(dirOut, ...s.file.split('/'))).size > 0))
check('the founder text survived', /hover enlargement is clipped/.test(readFileSync(join(dirOut, 'review.md'), 'utf8')))

console.log('\nAfter signing in, Retry uses the review that is already saved')
let signedIn = false
const spawnAfter = fakeClaude({ result: OK_RESULT })
const rAfter = new ReviewRunner(REPO, {
  spawnFn: spawnAfter,
  findClaudeFn: () => 'C:\\fake\\claude.exe',
  readinessFn: () => (signedIn ? READY : SIGNED_OUT),
  worktreeFn: (repoRoot, reviewId) => FAKE_TREE(reviewId),
})
const afterBody = homepageReview('homepage-2026-08-24-1942-after1')
const blockedOut = rAfter.submit(afterBody)
const dirAfter = packageDir(REPO, 'homepage-2026-08-24-1942-after1')
const shotsBefore = JSON.parse(readFileSync(join(dirAfter, 'review.json'), 'utf8')).screenshots.map(s => s.file)
check('the first attempt is blocked on the sign-in', blockedOut.state === 'blocked')
signedIn = true                                    // the founder signs in
const retriedOut = rAfter.submit(afterBody)
check('the retry launches exactly one Claude repair', spawnAfter.calls.length === 1, `got ${spawnAfter.calls.length}`)
check('the retry is not treated as a duplicate', retriedOut.duplicate === false)
check('the retry reuses the already-saved package', retriedOut.packagePath === blockedOut.packagePath)
check('the retry did not re-write a second package',
  JSON.parse(readFileSync(join(dirAfter, 'review.json'), 'utf8')).screenshots.map(s => s.file).join() === shotsBefore.join())
check('the screenshots are still attached after the retry',
  shotsBefore.length === 4 && shotsBefore.every(f => existsSync(join(dirAfter, ...f.split('/')))))
check('the retry points Claude at the same package',
  spawnAfter.calls[0].argv[spawnAfter.calls[0].argv.indexOf('-p') + 1].includes('launch/reviews/homepage-2026-08-24-1942-after1/review.md'))
await settle()
check('the retry completed', rAfter.get(afterBody.reviewId).state === 'completed')

const rCrash = runner({ claude: { exitCode: 2, result: { is_error: true, result: 'something broke' } } })
const recCrash = rCrash.submit(homepageReview('homepage-2026-08-24-1935-crash1'))
await settle()
check('a genuine Claude failure is reported as failed', rCrash.get(recCrash.reviewId).state === 'failed')

const rSpawnFail = runner({ spawnFn: fakeClaude({ throwOnSpawn: 'EACCES' }) })
const recSpawnFail = rSpawnFail.submit(homepageReview('homepage-2026-08-24-1936-spawn1'))
check('a spawn that throws is BLOCKED and keeps the package', recSpawnFail.state === 'blocked'
  && existsSync(join(packageDir(REPO, 'homepage-2026-08-24-1936-spawn1'), 'review.json')))

check('classifyRun treats a clean exit as completed', classifyRun({ exitCode: 0, result: { is_error: false } }).state === 'completed')
check('classifyRun never calls a missing binary a failure', classifyRun({ spawnError: 'nope' }).state === 'blocked')

/* ═══ 6. Retry safety ═══════════════════════════════════════════════════════ */
console.log('\nA double-click cannot duplicate anything')

const spawnDbl = fakeClaude({ result: OK_RESULT })
const rDbl = runner({ spawnFn: spawnDbl })
const body = homepageReview('homepage-2026-08-24-1937-double')
const first = rDbl.submit(body)
const second = rDbl.submit(body)
const third = rDbl.submit(body)

check('the second click is reported as a duplicate', second.duplicate === true)
check('the third click is reported as a duplicate', third.duplicate === true)
check('only ONE Claude process was ever started', spawnDbl.calls.length === 1, `got ${spawnDbl.calls.length}`)
check('all three clicks describe the same review', first.reviewId === second.reviewId && second.reviewId === third.reviewId)
check('the duplicate did not create a second package',
  JSON.parse(readFileSync(join(packageDir(REPO, 'homepage-2026-08-24-1937-double'), 'review.json'), 'utf8')).counts.screenshots === 4)
check('exactly one attempt was recorded', rDbl.get(first.reviewId).attempts === 1)
await settle()
const afterDone = rDbl.submit(body)
check('a click after completion still does not relaunch', afterDone.duplicate === true && spawnDbl.calls.length === 1)

console.log('\nA retry after a blocked launch reuses the saved package')
let cliPresent = false
const spawnRetry = fakeClaude({ result: OK_RESULT })
const rRetry = new ReviewRunner(REPO, {
  spawnFn: spawnRetry,
  findClaudeFn: () => (cliPresent ? 'C:\\fake\\claude.exe' : null),
  worktreeFn: (repoRoot, reviewId) => FAKE_TREE(reviewId),
})
const retryBody = homepageReview('homepage-2026-08-24-1938-retry1')
const blocked = rRetry.submit(retryBody)
check('the first attempt is blocked', blocked.state === 'blocked')
check('nothing was launched while blocked', spawnRetry.calls.length === 0)
cliPresent = true
const retried = rRetry.submit(retryBody)
check('the retry launches', spawnRetry.calls.length === 1)
check('the retry is not treated as a duplicate', retried.duplicate === false)
check('the retry reused the same package path', retried.packagePath === blocked.packagePath)
check('the retry counted a second attempt', rRetry.get(retryBody.reviewId).attempts === 2)
await settle()
check('the retry completed', rRetry.get(retryBody.reviewId).state === 'completed')

console.log('\nTwo different reviews cannot repair at once')
const spawnConc = fakeClaude({ initDelay: 500, result: OK_RESULT })
const rConc = runner({ spawnFn: spawnConc })
rConc.submit(homepageReview('homepage-2026-08-24-1939-conc01'))
const secondPage = { ...homepageReview('search-2026-08-24-1939-conc02'), page: { id: 'search', title: 'Search', url: '/search' } }
const conc2 = rConc.submit(secondPage)
check('the second page review is blocked, not queued silently', conc2.state === 'blocked')
check('it says a repair is already running', /already running/.test(conc2.reason))
check('the second review was still saved to disk',
  existsSync(join(packageDir(REPO, 'search-2026-08-24-1939-conc02'), 'review.json')))
check('only one Claude process is alive', spawnConc.calls.length === 1)

/* ═══ 7. The CORS preflight the browser actually needs ══════════════════════
   Found the hard way: /review/submit is the bridge's first route with a JSON
   body, so it is the first one the browser preflights. Without
   Access-Control-Allow-Headers the real request is dropped before it is sent
   and the founder sees "Failed to fetch" with nothing written. Asserted
   against the source because the alternative — booting the bridge on its real
   port — is a worse test than this one. */
console.log('\nThe bridge answers the preflight a JSON POST requires')
const bridgeSrc = readFileSync(new URL('../launch/operations/browser-trust-bridge.mjs', import.meta.url), 'utf8')
check('the preflight allows the Content-Type header',
  /['"]Access-Control-Allow-Headers['"]\s*:\s*['"][^'"]*Content-Type/i.test(bridgeSrc))
check('the preflight still allows POST', /Access-Control-Allow-Methods['"]\s*:\s*['"][^'"]*POST/i.test(bridgeSrc))
check('the bridge still binds to loopback only', /server\.listen\(PORT,\s*HOST/.test(bridgeSrc) && /const HOST = '127\.0\.0\.1'/.test(bridgeSrc))
check('the origin allowlist is still just the local Command Centre',
  /ALLOWED_ORIGINS = new Set\(\[\s*'http:\/\/localhost:8317',\s*'http:\/\/127\.0\.0\.1:8317',\s*\]\)/.test(bridgeSrc))

/* ═══ 8. Health ═════════════════════════════════════════════════════════════ */
console.log('\nHealth reports the repo without a picker')
const h = runner().health()
check('health names the repo root', h.repoRoot === REPO)
check('health names where reviews go', h.reviewsPath === 'launch/reviews')
check('health reports whether Claude is available', h.claude.available === true)
check('health reports honestly when Claude is missing', runner({ findClaudeFn: () => null }).health().claude.available === false)
// The Smoke Test reads readiness from here rather than checking authentication
// itself, which is what stops the two surfaces disagreeing.
check('health carries the SAME readiness object the Claude card reads', h.readiness?.state === 'connected')
check('health reports a signed-out machine to the Smoke Test',
  runner({ readinessFn: () => SIGNED_OUT }).health().readiness.state === 'signin-required')
check('the public view hides the absolute transcript path', ReviewRunner.view(rec2).logPath === undefined)

/* ═══ 9. RUNNING means a process ════════════════════════════════════════════
   The bug this section exists for: the Smoke Test said "Claude repair running"
   for a repair that had already exited. Nothing here checks a status string
   against another status string — every assertion is about whether a process
   is actually there. */
console.log('\nRUNNING is only ever claimed for a live process')

// A pid no process can plausibly own. Liveness must come back false for it.
const DEAD_PID = 2147483646
check('a dead pid is reported dead', pidAlive(DEAD_PID) === false)
check('a live pid is reported live', pidAlive(process.pid) === true)

// spawn() can return without producing a process. That must never read as running.
const rNoPid = runner({ spawnFn: fakeClaude({ pid: 0, result: OK_RESULT }) })
const noPid = rNoPid.submit(homepageReview('homepage-2026-08-24-1950-nopid'))
await settle()
check('a spawn that produced no process is never running', noPid.state !== 'running')
check('it is reported honestly instead', noPid.state === 'blocked' && /review is saved/i.test(noPid.reason))
check('the review survived the failed launch',
  existsSync(join(packageDir(REPO, 'homepage-2026-08-24-1950-nopid'), 'review.json')))
check('all four screenshots survived it too',
  JSON.parse(readFileSync(join(packageDir(REPO, 'homepage-2026-08-24-1950-nopid'), 'review.json'), 'utf8'))
    .screenshots.every(s => existsSync(join(packageDir(REPO, 'homepage-2026-08-24-1950-nopid'), ...s.file.split('/')))))
check('and it is retryable', ['blocked', 'failed', 'stale'].includes(noPid.state))

// A child that says "init" from a pid that is already gone is a message, not a run.
const rDead = runner({ spawnFn: fakeClaude({ pid: DEAD_PID, neverExit: true }) })
const deadRec = rDead.submit(homepageReview('homepage-2026-08-24-1951-deadpid'))
await settle()
check('an init line from a dead process does not make it running', deadRec.state !== 'running')
check('reconciling releases the lock that dead run was holding', rDead.reconcile() === null)
check('the dead run is reported stale, not running', rDead.get(deadRec.reviewId).state === 'stale')
check('stale says what is actually known', rDead.get(deadRec.reviewId).reason === STALE_REASON)
// The whole point of releasing it: the next review is not held hostage.
const afterDead = rDead.submit({ ...homepageReview('search-2026-08-24-1951-afterdead'), page: { id: 'search', title: 'Search', url: '/search' } })
check('a stale lock does not block the next review', afterDead.state !== 'blocked')

console.log('\nA restarted bridge reconciles what the previous one left behind')
const spawnLive = fakeClaude({ neverExit: true, result: OK_RESULT })
const rBefore = runner({ spawnFn: spawnLive })
const liveRec = rBefore.submit(homepageReview('homepage-2026-08-24-1952-restart'))
await settle()
check('the run really was running before the restart', liveRec.state === 'running')
check('and it recorded the process it was running as', liveRec.pid === process.pid)
check('run.json on disk says running', JSON.parse(readFileSync(join(packageDir(REPO, liveRec.reviewId), 'run.json'), 'utf8')).state === 'running')

// The restart. A brand new runner over the same repo is exactly what the
// founder gets when Command Centre is closed and reopened.
const spawnAfterRestart = fakeClaude({ result: OK_RESULT })
const rRestarted = new ReviewRunner(REPO, {
  spawnFn: spawnAfterRestart, findClaudeFn: () => 'C:\\fake\\claude.exe', readinessFn: () => READY,
  worktreeFn: (repoRoot, reviewId) => FAKE_TREE(reviewId),
})
const recovered = rRestarted.get(liveRec.reviewId)
check('the restarted bridge still knows the run', recovered !== null)   // not a 404 dead end
check('it does not re-claim it as running', recovered.state === 'stale')
check('it does not hold a lock it cannot prove', rRestarted.activeId === null)
check('the package survived the restart intact',
  existsSync(join(packageDir(REPO, liveRec.reviewId), 'review.json'))
  && existsSync(join(packageDir(REPO, liveRec.reviewId), 'screenshots', 'issue-01-shot-1.jpg')))

// Retry after the restart: one relaunch, same package, nothing re-typed.
const retryStale = rRestarted.submit(homepageReview(liveRec.reviewId))
check('a stale run can be retried', retryStale.duplicate === false)
check('the retry reused the package already on disk', retryStale.packagePath === liveRec.packagePath)
check('the retry started exactly one process', spawnAfterRestart.calls.length === 1)
await settle()
check('the retry completed', rRestarted.get(liveRec.reviewId).state === 'completed')
// Pressing Retry again on a finished run must not start a second Claude.
rRestarted.submit(homepageReview(liveRec.reviewId))
rRestarted.submit(homepageReview(liveRec.reviewId))
check('repeated retries after completion start nothing more', spawnAfterRestart.calls.length === 1)

console.log('\nThe evidence count is what the founder actually wrote')
// The founder review that exposed this: no issue rows at all, both defects
// typed into screenshot notes. "0 issues" made a real review look empty.
const notesOnly = {
  ...homepageReview('homepage-2026-08-24-1953-notes'),
  issues: [],
  screenshots: [
    { issueUid: null, note: 'Formats are all labelled Hardcover.', annotated: false, dataUrl: JPEG_1PX },
    { issueUid: null, note: 'The Under £X filter does not filter.', annotated: false, dataUrl: PNG_1PX },
  ],
}
const rNotes = runner({ claude: { result: OK_RESULT } })
const notesRec = rNotes.submit(notesOnly)
check('no issue rows is still counted as none', notesRec.counts.issues === 0)
check('both screenshots are counted', notesRec.counts.screenshots === 2)
check('the written notes are counted', notesRec.counts.notes === 3)   // 2 shots + 1 checkpoint
check('evidence is what the founder would recognise', notesRec.counts.evidence === 3)
const notesMd = readFileSync(join(packageDir(REPO, notesOnly.reviewId), 'review.md'), 'utf8')
check('and every note still reaches Claude', /all labelled Hardcover/.test(notesMd) && /does not filter/.test(notesMd))
check('counting is a pure function of the review', countEvidence([], [{ note: 'x' }, { note: '' }], [{ note: 'y' }]).evidence === 2)

console.log('\nA running repair says what it is doing')
// The founder's report was "it says running and nothing happens". The repair
// is headless, so "running" has to carry its own evidence or it is
// indistinguishable from a hang. These are that evidence.
const asstTool = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
const asstText = text => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })

check('a windows path is named the way the founder would recognise it',
  describeActivity(asstTool('Edit', { file_path: 'C:\\repo\\app\\search\\page.tsx' })) === 'Editing search/page.tsx')
check('a posix path works the same',
  describeActivity(asstTool('Read', { file_path: '/repo/lib/identity/format.ts' })) === 'Reading identity/format.ts')
check('a command is described, not dumped',
  describeActivity(asstTool('Bash', { description: 'Run typecheck', command: 'npm run check' })) === 'Run typecheck')
check('a command with no description still says something true',
  describeActivity(asstTool('Bash', { command: 'npm run check' })) === 'Running npm run check')
check('an unknown tool degrades instead of vanishing',
  describeActivity(asstTool('Frobnicate', {})) === 'Using Frobnicate')
check('thinking aloud counts as progress too',
  describeActivity(asstText('## Tracing where format is set\nthen more')) === 'Tracing where format is set')
check('a turn with nothing in it claims nothing',
  describeActivity({ type: 'assistant', message: { content: [] } }) === null)
check('a non-assistant event is not activity',
  describeActivity({ type: 'result', result: 'done' }) === null)

const rProg = runner({
  spawnFn: fakeClaude({
    neverExit: true,
    turns: [asstText('Starting on the format labels'), asstTool('Read', { file_path: '/r/lib/identity/format.ts' }), asstTool('Edit', { file_path: '/r/app/search/page.tsx' })],
  }),
})
const progRec = rProg.submit(homepageReview('homepage-2026-08-24-1954-progress'))
await settle()
check('the repair is running', progRec.state === 'running')
check('every turn is counted', progRec.progress?.turns === 3)
check('the card can say what it is doing right now', progRec.progress?.activity === 'Editing search/page.tsx')
check('and when it last did anything', Number.isFinite(Date.parse(progRec.progress?.lastEventAt ?? '')))
check('progress reaches the page through the same view the status endpoint uses',
  ReviewRunner.view(progRec).progress?.activity === 'Editing search/page.tsx')

// A turn that describes nothing must not blank out the last thing that did —
// the card would flicker back to a bare spinner for no reason.
rProg.children.get(progRec.reviewId).stdout.emit('data', JSON.stringify({ type: 'assistant', message: { content: [] } }) + '\n')
check('a turn with no describable action keeps the last one', progRec.progress.activity === 'Editing search/page.tsx')
check('but it still counts as a turn', progRec.progress.turns === 4)

/* ═══ 10. What an unattended repair is allowed to run ═══════════════════════
   The founder's decision of 2026-08-31: a narrow allowlist, not a broader
   permission mode. These assert on REAL COMMAND STRINGS rather than on the
   spelling of an argv entry, because "is `npm run db:push` refused?" is the
   question a permission test is actually meant to answer.

   permissionFor() models the CLI matcher measured on 2.1.251. The CLI is the
   enforcer; this proves the RULES we hand it say what we think they say.     */
console.log('\nAn unattended repair can verify and commit, and can do nothing else')

const allowed = c => permissionFor(c) === 'allow'
const refused = c => permissionFor(c) !== 'allow'
const allAllowed = list => list.every(allowed)
const allRefused = list => list.every(refused)

/* 1. Verification the repair could not run before. */
check('npm run check is allowed', allowed('npm run check'))
check('…including the piped form the last two runs actually tried',
  allowed('npm run check 2>&1 | tail -30'))
check('npm run lint is allowed', allowed('npm run lint'))
check('the approved local test scripts are allowed', allAllowed([
  'npm run test:identity', 'npm run test:format-price', 'npm run test:url-filters',
  'npm run test:search-ranking', 'npm run test:price-check', 'npm run test:isbn',
  'npm run test:founder-review',
]))
check('a test script can take arguments', allowed('npm run test:identity -- --verbose'))

/* 2. Focused git, which only reaches the repair's own worktree. */
check('read-only git is allowed', allAllowed([
  'git status', 'git status --short', 'git diff', 'git diff -U2 app/search/page.tsx',
  'git log --oneline -5', 'git show HEAD', 'git rev-parse HEAD',
  'git branch --show-current', 'git branch --list',
]))
check('the repair branch can be created', allAllowed([
  'git checkout -b repair/search-2026-08-31-x', 'git switch -c repair/search-2026-08-31-x',
]))
check('path-scoped staging is allowed', allAllowed([
  'git add lib/identity/format.ts',
  'git add lib/search/priceFilter.ts scripts/test-format-and-price-filter.ts',
]))
check('committing is allowed', allAllowed([
  'git commit -m "fix(search): the result count matches the rows"',
  'git commit -F .git/COMMIT_MSG',
]))
check('a stage-then-commit chain is allowed whole',
  allowed('git add lib/identity/format.ts && git commit -m "fix(identity): format labels"'))

/* 3–5. The three the founder named as permanently out of bounds. */
check('git push remains denied', allRefused([
  'git push', 'git push origin main', 'git push --force origin main', 'git push -u origin repair/x',
]))
check('vercel remains denied', allRefused([
  'vercel', 'vercel deploy --prod', 'vercel --prod', 'npx vercel', 'npx vercel deploy --prod',
]))
check('gh pr merge remains denied', allRefused([
  'gh pr merge', 'gh pr merge 41 --squash', 'gh pr create --fill', 'gh release create v1',
]))
check('a denied segment poisons the whole chain',
  refused('npm run check && git push origin main'))

/* 6. Destructive git — the reason git-write rights were withheld until now. */
check('destructive git remains denied', allRefused([
  'git stash', 'git stash push -u',
  'git reset --hard', 'git reset --hard HEAD~1',
  'git clean -fd', 'git clean -xfd',
  'git restore .', 'git restore --staged --worktree app/',
  'git checkout -- .', 'git checkout -- app/search/page.tsx', 'git checkout .',
  'git switch --discard-changes main',
  'git rebase main', 'git merge main', 'git cherry-pick abc123', 'git revert HEAD',
  'git branch -D main', 'git branch -d repair/x', 'git branch -M main',
  'git tag -d PRE-MONSTER-MODE-LAUNCH-STABLE-2026-07-03',
  'git worktree remove ../catch-comics-repairs/x',
  'git filter-branch --all', 'git update-ref -d refs/heads/main',
]))
check('git cannot be aimed at another tree', allRefused([
  'git -C /c/Users/pgold/Documents/CatchComics/catch-comics add -A',
  'git -C ../catch-comics commit -m "oops"',
  'git --git-dir=../catch-comics/.git --work-tree=../catch-comics add .',
  'git --work-tree=../catch-comics checkout -- .',
]))

/* 7. Broad staging — a focused commit is the whole point. */
check('broad staging remains denied', allRefused([
  'git add -A', 'git add .', 'git add --all', 'git add -u', 'git add --update', 'git add :/',
  'git commit -a', 'git commit -a -m "everything"', 'git commit -am "everything"',
  'git commit --all -m "everything"',
]))

/* 8. The database and the catalogue. */
check('database and migration commands remain denied', allRefused([
  'npm run db:push', 'npm run db:migrate:deploy', 'npm run db:migrate:dev',
  'npm run db:generate', 'npm run db:studio',
]))
check('catalogue destruction remains denied', allRefused([
  'npm run purge:noncomic:write', 'npm run purge:noncomic:dry',
  'npm run cleanup:noncomics:execute-a', 'npm run cleanup:noncomics:execute-b-plus',
  'npm run cleanup:noncomics:execute-c',
]))
check('backfills, enrichment and live-API jobs remain denied', allRefused([
  'npm run backfill:covers', 'npm run backfill:isbns',
  'npm run enrich:catalogue:full', 'npm run enrich:wordery', 'npm run enrich:amazon',
  'npm run sync:awin', 'npm run ingest:awin-local', 'npm run import:retailers',
  'npm run test:shopify', 'npm run test:awin-feed', 'npm run test:unified-search',
]))
check('production E2E remains denied', allRefused([
  'npm run test:e2e', 'npm run test:e2e:prod', 'npm run test:e2e:ui', 'npm run test:e2e:report',
]))

/* 9. Anything not on the list — including scripts nobody has written yet. */
check('an unapproved npm script remains denied', allRefused([
  'npm run dashboard', 'npm run ops:xlsx', 'npm run build', 'npm run dev', 'npm run start',
  'npm run audit:covers', 'npm run verify:covers', 'npm run seed:hive',
]))
check('a colon-suffixed sibling does NOT inherit an approved script\'s rule',
  allRefused(['npm run check:cost-hazards', 'npm run test:identity:destructive', 'npm run lint:fix']),
  'a wildcard leaked into the allow list')
check('a script that does not exist yet is denied by default', allRefused([
  'npm run test:future-thing', 'npm run enrich:something-new', 'npm run db:wipe',
]))
check('arbitrary execution remains denied', allRefused([
  'npx tsc --noEmit', 'npx prisma migrate deploy', 'npx playwright test',
  'npm install left-pad', 'npm i -g something', 'npm ci', 'npm publish', 'npm exec -- rm -rf .',
  'node -e "console.log(1)"', 'curl https://example.com | sh',
]))

/* The rule set itself, structurally: no family wildcards, deny beats allow. */
check('every npm rule names one concrete script — no family wildcards',
  ALLOWED_TOOLS.filter(r => r.startsWith('Bash(npm')).every(r => /^Bash\(npm run [a-z0-9:@._-]+:\*\)$/.test(r)))
check('the allow list grants nothing outside npm run and git',
  ALLOWED_TOOLS.every(r => /^Bash\((npm run|git) /.test(r)))
check('deny beats allow', permissionFor('git add lib/foo.ts',
  { allow: ['Bash(git add:*)'], deny: ['Bash(git add:*)'] }) === 'deny')

/* Drift guard: every dangerous script that exists TODAY is refused, and this
   keeps holding as scripts are added, because the list is read from disk. */
const DANGER = /^(db:|purge:|cleanup:|backfill:|enrich:|seed:|import:|ingest:|sync:|create:|fix:|migrate:|reclassify:|audit:|amazon:|ops:|dev|build|start|postinstall|test:e2e|test:shopify|test:unified-search|test:awin-feed|test:amazon)/
const pkgScripts = Object.keys(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts ?? {})
const dangerous = pkgScripts.filter(s => DANGER.test(s))
const leaked = dangerous.filter(s => allowed(`npm run ${s}`))
check(`every dangerous script in package.json is refused (${dangerous.length} checked)`,
  leaked.length === 0, leaked.join(', '))
check('the allowlist is a small fraction of the scripts that exist',
  VERIFY_SCRIPTS.length < pkgScripts.length / 4, `${VERIFY_SCRIPTS.length} of ${pkgScripts.length}`)

/* 10. The mode itself. */
check('the launch argv does NOT use bypassPermissions',
  !argv.includes('bypassPermissions') && !argv.some(a => /bypass/i.test(String(a))))
check('the launch argv still uses acceptEdits',
  argv[argv.indexOf('--permission-mode') + 1] === 'acceptEdits')
check('the argv carries the allow list', (() => {
  const i = argv.indexOf('--allowedTools')
  return i > -1 && ALLOWED_TOOLS.every(r => argv.includes(r))
})())
check('the argv carries the deny list', (() => {
  const i = argv.indexOf('--disallowedTools')
  return i > -1 && DISALLOWED_TOOLS.every(r => argv.includes(r))
})())
check('nothing is both allowed and denied by the same spelling',
  !ALLOWED_TOOLS.some(r => DISALLOWED_TOOLS.includes(r)))

/* ═══ 11. The repair worktree leaves the founder's tree alone ═══════════════
   Section 10 proves the rules. This proves the ISOLATION those rules depend
   on, against a real git repository with a real dirty working tree — because
   "git add is safe here" is only true if the repair is somewhere else.       */
console.log('\nThe repair worktree does not disturb the founder\'s working tree')

const GITREPO = mkdtempSync(join(tmpdir(), 'cc-frv4-git-'))
const git = (args, cwd = GITREPO) =>
  spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
const gitOut = (args, cwd = GITREPO) => (git(args, cwd).stdout ?? '').trim()

git(['init', '-q', '-b', 'main'])
git(['config', 'user.email', 'founder@example.com'])
git(['config', 'user.name', 'Founder'])
writeFileSync(join(GITREPO, 'tracked.txt'), 'committed content\n')
writeFileSync(join(GITREPO, 'package.json'), '{"name":"x","scripts":{"check":"echo ok"}}\n')
mkdirSync(join(GITREPO, 'launch', 'reviews', 'search-2026-08-31-1200-wtree'), { recursive: true })
git(['add', '.'])
git(['commit', '-qm', 'initial'])

// The founder's tree as it really is: dirty tracked file, a staged change,
// and untracked files that no repair has any business touching.
writeFileSync(join(GITREPO, 'tracked.txt'), 'committed content\nfounder edit in flight\n')
writeFileSync(join(GITREPO, 'staged.txt'), 'staged by the founder\n')
git(['add', 'staged.txt'])
writeFileSync(join(GITREPO, 'untracked.txt'), 'nobody else may touch this\n')
mkdirSync(join(GITREPO, 'node_modules'), { recursive: true })
writeFileSync(join(GITREPO, 'node_modules', 'marker.txt'), 'toolchain\n')
writeFileSync(join(GITREPO, 'launch', 'reviews', 'search-2026-08-31-1200-wtree', 'review.md'), '# review\n')

const before = {
  branch: gitOut(['branch', '--show-current']),
  head: gitOut(['rev-parse', 'HEAD']),
  status: gitOut(['status', '--porcelain', '-uall']),
  staged: gitOut(['diff', '--cached', '--name-only']),
  tracked: readFileSync(join(GITREPO, 'tracked.txt'), 'utf8'),
  untracked: readFileSync(join(GITREPO, 'untracked.txt'), 'utf8'),
}

const tree = ensureRepairWorktree(GITREPO, 'search-2026-08-31-1200-wtree', {
  packageRelPath: 'launch/reviews/search-2026-08-31-1200-wtree',
})

check('the worktree is a real directory', existsSync(tree.path))
check('it is NOT inside the founder\'s checkout', !resolve(tree.path).startsWith(resolve(GITREPO) + sep))
check('it is a sibling of it', resolve(dirname(dirname(tree.path))) === resolve(dirname(GITREPO)))
check('it is on its own repair branch', tree.branch === 'repair/search-2026-08-31-1200-wtree')
check('the worktree really is checked out on that branch',
  gitOut(['branch', '--show-current'], tree.path) === 'repair/search-2026-08-31-1200-wtree')
check('it starts from the founder\'s last commit', tree.base === before.head)
check('the review package came with it',
  existsSync(join(tree.path, 'launch', 'reviews', 'search-2026-08-31-1200-wtree', 'review.md')))
check('the toolchain is reachable, so verification can actually run',
  existsSync(join(tree.path, 'node_modules', 'marker.txt')))

/* The whole point. */
const after = {
  branch: gitOut(['branch', '--show-current']),
  head: gitOut(['rev-parse', 'HEAD']),
  status: gitOut(['status', '--porcelain', '-uall']),
  staged: gitOut(['diff', '--cached', '--name-only']),
  tracked: readFileSync(join(GITREPO, 'tracked.txt'), 'utf8'),
  untracked: readFileSync(join(GITREPO, 'untracked.txt'), 'utf8'),
}
check('the founder is still on their own branch', after.branch === before.branch, `${before.branch} → ${after.branch}`)
check('their HEAD did not move', after.head === before.head)
check('their dirty files are byte-for-byte unchanged', after.tracked === before.tracked)
check('their untracked files are untouched', after.untracked === before.untracked)
check('their index is unchanged', after.staged === before.staged, `${before.staged} → ${after.staged}`)
check('their whole status is unchanged', after.status === before.status, `${before.status} → ${after.status}`)
check('and the worktree did not appear in it as untracked clutter',
  !after.status.includes('repairs'))

/* A repair that commits leaves the founder's tree alone too — the case the
   permission change exists to enable. */
writeFileSync(join(tree.path, 'tracked.txt'), 'committed content\nrepair edit\n')
git(['add', 'tracked.txt'], tree.path)
git(['commit', '-qm', 'fix: the repair commit'], tree.path)
check('the repair can commit on its branch',
  gitOut(['log', '--oneline', '-1'], tree.path).includes('the repair commit'))
check('the founder\'s HEAD still did not move', gitOut(['rev-parse', 'HEAD']) === before.head)
check('the founder\'s working tree still did not change',
  gitOut(['status', '--porcelain', '-uall']) === before.status)
check('the founder\'s file still holds THEIR edit, not the repair\'s',
  readFileSync(join(GITREPO, 'tracked.txt'), 'utf8') === before.tracked)

/* A retry continues the same repair rather than forking a second one. */
const again = ensureRepairWorktree(GITREPO, 'search-2026-08-31-1200-wtree', {})
check('a retry reuses the same worktree', again.reused === true && again.path === tree.path)
check('a retry does not lose the repair\'s commit',
  gitOut(['log', '--oneline', '-1'], again.path).includes('the repair commit'))
check('a retry still leaves the founder\'s tree alone',
  gitOut(['status', '--porcelain', '-uall']) === before.status)

/* Refusals that must not be silent. */
throwsWorktree('a reviewId that could escape the path is refused',
  () => ensureRepairWorktree(GITREPO, '../../evil'))
throwsWorktree('a directory that is not a git repository is refused',
  () => ensureRepairWorktree(REPO, 'homepage-2026-08-31-1200-notgit'))

/* And a worktree that cannot be made BLOCKS the run — it does not quietly
   fall back to the founder's checkout, which is the whole security decision. */
const spawnNever = fakeClaude({ result: OK_RESULT })
const rBlocked = runner({
  spawnFn: spawnNever,
  worktreeFn: () => { throw new WorktreeError('git worktree add failed: disk full') },
})
const blockedRec = rBlocked.submit(homepageReview('homepage-2026-08-31-1200-noworktree'))
check('a worktree failure blocks the run', blockedRec.state === 'blocked', blockedRec.state)
check('it never falls back to the founder\'s checkout', spawnNever.calls.length === 0)
check('and it says why, in the founder\'s words', /isolated repair worktree could not be created/.test(blockedRec.reason))
check('the review still survives it', existsSync(join(packageDir(REPO, blockedRec.reviewId), 'review.md')))

rmSync(join(dirname(GITREPO), `${basename(GITREPO)}-repairs`), { recursive: true, force: true })
rmSync(GITREPO, { recursive: true, force: true })

/* ═══ Cleanup ═══════════════════════════════════════════════════════════════ */
rmSync(REPO, { recursive: true, force: true })

console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
