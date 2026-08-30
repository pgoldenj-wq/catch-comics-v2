#!/usr/bin/env node
/**
 * founder-review-handler.mjs — the Smoke Test V4 one-click handoff.
 *
 * WHAT THIS REPLACES
 * The founder used to: connect a repo folder through the File System Access
 * API, press Send, then copy a kick-off command out of the clipboard and paste
 * it into Claude Code by hand. Three manual steps stood between finding a
 * defect and repairing it. This module removes all three: the browser POSTs a
 * structured review, this handler writes the package into the repo and starts
 * the Claude Code repair session itself.
 *
 * THIS IS NOT A COMMAND RUNNER
 * The bridge's other two actions accept no request body at all. This one does,
 * so the boundary has to be drawn explicitly instead of by absence:
 *
 *   - The browser submits DATA ONLY: page id, founder text, screenshots.
 *   - It cannot name a file. Every filename on disk is generated here from an
 *     index (`issue-02-shot-1.jpg`), never from anything the browser sent.
 *   - It cannot name a directory. The package directory is the reviewId, which
 *     must match a strict pattern AND begin with a known page id, and the
 *     resolved path is asserted to stay inside launch/reviews/.
 *   - It cannot influence the Claude command. The argv is fixed here; the only
 *     variable part is the package path, which is derived from the validated
 *     reviewId. No founder text is ever interpolated into argv — it reaches
 *     Claude only as a file the session reads.
 *   - It cannot pick the prompt. repairPrompt() below is the whole instruction.
 *
 * HONEST STATES
 * A launched process is not a finished repair. States are reported as:
 *   packaging → packaged → launching → running → completed | failed | blocked
 * `blocked` means the environment stopped Claude from starting (CLI missing or
 * not signed in). It is deliberately NOT `failed`: nothing about the product
 * was tested, so nothing about the product failed. Same three-state model the
 * Browser Trust runner uses. The review package survives every one of these.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { SIGNIN_COMMAND, claudeVersion, findClaude, readiness } from './claude-readiness.mjs'

/* ── Bounds ──────────────────────────────────────────────────────────────── */
export const LIMITS = {
  BODY_BYTES: 96 * 1024 * 1024,   // whole request; screenshots dominate it
  SHOTS: 40,
  SHOT_BYTES: 12 * 1024 * 1024,   // per decoded image
  ISSUES: 60,
  ISSUE_CHARS: 8000,
  CHECKPOINTS: 120,
  LABEL_CHARS: 500,
  NOTE_CHARS: 4000,
  REVIEW_ID: 80,
}

/** The Smoke Test V4 pages. A reviewId must begin with one of these, which is
 *  what stops the directory name from being founder- or attacker-chosen. */
export const PAGE_IDS = [
  'homepage', 'search', 'series-index', 'series-pages', 'product', 'offerstable',
  'affiliate', 'mobile', 'loading', 'route', 'errors', 'covers', 'recommendation',
  'launch-readiness',
]

const REVIEW_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/

/* ── Validation ──────────────────────────────────────────────────────────── */

export class ValidationError extends Error {}

const bad = msg => { throw new ValidationError(msg) }

/** Clamp length and drop control characters (tab, newline and carriage
 *  return survive). Founder text lands in files Claude reads and in a
 *  terminal that prints them, so it must never carry escape sequences.
 *  Written as an explicit codepoint filter rather than a regex literal:
 *  a character class of raw control bytes is unreadable in source. */
function cleanText(v, max, what) {
  if (v == null) return ''
  if (typeof v !== 'string') bad(`${what} must be a string`)
  let stripped = ''
  for (const ch of v) {
    const c = ch.codePointAt(0)
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) stripped += ch
  }
  if (stripped.length > max) bad(`${what} is longer than ${max} characters`)
  return stripped
}

/**
 * Decode a data URL into image bytes, proving it really is a JPEG or PNG.
 * The declared MIME type is not trusted: the magic bytes decide, because the
 * extension written to disk is chosen from what the bytes actually are.
 */
export function decodeImage(dataUrl, what) {
  if (typeof dataUrl !== 'string') bad(`${what}: not a data URL`)
  const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl)
  if (!m) bad(`${what}: only base64 image/jpeg or image/png data URLs are accepted`)
  let bytes
  try { bytes = Buffer.from(m[2], 'base64') } catch { bad(`${what}: base64 did not decode`) }
  if (!bytes.length) bad(`${what}: decoded to zero bytes`)
  if (bytes.length > LIMITS.SHOT_BYTES) bad(`${what}: ${(bytes.length / 1048576).toFixed(1)} MB exceeds the ${LIMITS.SHOT_BYTES / 1048576} MB per-screenshot limit`)

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (!isJpeg && !isPng) bad(`${what}: the bytes are not a JPEG or PNG image`)
  return { bytes, ext: isJpeg ? 'jpg' : 'png' }
}

/**
 * Validate the submission and return a normalised review. Throws
 * ValidationError with a founder-readable message on anything unexpected —
 * the Smoke Test shows that message verbatim, so it must say what to do.
 */
export function validateSubmission(body) {
  if (!body || typeof body !== 'object') bad('The submission was not an object')

  const reviewId = cleanText(body.reviewId, LIMITS.REVIEW_ID, 'reviewId')
  if (!REVIEW_ID_RE.test(reviewId)) bad('reviewId may only contain lowercase letters, digits and hyphens')

  const page = body.page && typeof body.page === 'object' ? body.page : bad('page is missing')
  const pageId = cleanText(page.id, 40, 'page.id')
  if (!PAGE_IDS.includes(pageId)) bad(`Unknown page "${pageId}"`)
  // Belt and braces: the directory name must be attributable to a known page.
  if (!reviewId.startsWith(pageId + '-')) bad('reviewId must start with its page id')

  const verdict = body.verdict === 'good' || body.verdict === 'fix' ? body.verdict : null

  const rawIssues = Array.isArray(body.issues) ? body.issues : []
  if (rawIssues.length > LIMITS.ISSUES) bad(`More than ${LIMITS.ISSUES} issues in one page review`)
  const issues = rawIssues.map((it, i) => {
    const problem = cleanText(it?.problem, LIMITS.ISSUE_CHARS, `issue ${i + 1} problem`).trim()
    return {
      uid: cleanText(it?.uid, 40, `issue ${i + 1} uid`),
      problem,
      expected: cleanText(it?.expected, LIMITS.ISSUE_CHARS, `issue ${i + 1} expected`).trim(),
      createdAt: Number.isFinite(it?.createdAt) ? new Date(it.createdAt).toISOString() : null,
    }
  }).filter(it => it.problem || it.expected)

  const rawShots = Array.isArray(body.screenshots) ? body.screenshots : []
  if (rawShots.length > LIMITS.SHOTS) bad(`More than ${LIMITS.SHOTS} screenshots in one page review`)
  const issueUids = new Set(issues.map(i => i.uid).filter(Boolean))
  const screenshots = rawShots.map((s, i) => {
    const { bytes, ext } = decodeImage(s?.dataUrl, `screenshot ${i + 1}`)
    const uid = cleanText(s?.issueUid, 40, `screenshot ${i + 1} issue link`)
    return {
      // An orphaned link (issue deleted after the shot was attached) degrades
      // to a page-level screenshot rather than pointing at nothing.
      issueUid: uid && issueUids.has(uid) ? uid : null,
      note: cleanText(s?.note, LIMITS.NOTE_CHARS, `screenshot ${i + 1} note`).trim(),
      annotated: !!s?.annotated,
      bytes, ext,
    }
  })

  const rawChecks = Array.isArray(body.checkpoints) ? body.checkpoints : []
  if (rawChecks.length > LIMITS.CHECKPOINTS) bad('Too many checkpoints')
  const checkpoints = rawChecks.map((c, i) => ({
    label: cleanText(c?.label, LIMITS.LABEL_CHARS, `checkpoint ${i + 1}`).replace(/<[^>]+>/g, ''),
    checked: !!c?.checked,
    note: cleanText(c?.note, LIMITS.NOTE_CHARS, `checkpoint ${i + 1} note`).trim(),
  })).filter(c => c.label)

  if (!issues.length && !screenshots.length && verdict !== 'fix' && !checkpoints.some(c => c.note)) {
    bad('Nothing to send: write an issue, attach a screenshot or a checkpoint note, or mark the page “Needs fixing”')
  }

  return {
    reviewId,
    page: {
      id: pageId,
      title: cleanText(page.title, 120, 'page.title') || pageId,
      url: cleanText(page.url, 300, 'page.url'),
    },
    verdict, issues, screenshots, checkpoints,
    tool: 'smoke-test-v4',
  }
}

/* ── Package writing ─────────────────────────────────────────────────────── */

/** Resolve the package directory and prove it cannot escape launch/reviews/. */
export function packageDir(repoRoot, reviewId) {
  const reviewsRoot = resolve(repoRoot, 'launch', 'reviews')
  const dir = resolve(reviewsRoot, reviewId)
  if (dir !== reviewsRoot && !dir.startsWith(reviewsRoot + sep)) {
    throw new ValidationError('Refusing to write outside launch/reviews/')
  }
  return dir
}

const pad2 = n => String(n).padStart(2, '0')

/**
 * Assign each screenshot its filename and its issue. Names are positional and
 * generated here — `issue-02-shot-1.jpg` reads unambiguously in both the JSON
 * and the markdown, so Claude never has to guess which image belongs to which
 * issue.
 */
function assignScreenshots(review) {
  const issueNo = new Map(review.issues.map((it, i) => [it.uid, i + 1]))
  const seq = new Map()
  return review.screenshots.map(s => {
    const n = s.issueUid ? issueNo.get(s.issueUid) : null
    const key = n ? `issue-${pad2(n)}` : 'page'
    const idx = (seq.get(key) ?? 0) + 1
    seq.set(key, idx)
    return { ...s, issueId: n ? `issue-${pad2(n)}` : null, file: `screenshots/${key}-shot-${idx}.${s.ext}` }
  })
}

function buildReviewJson(review, shots, createdAt) {
  const issues = review.issues.map((it, i) => {
    const id = `issue-${pad2(i + 1)}`
    return {
      id,
      uid: it.uid,
      page: review.page.id,
      section: review.page.title,
      problem: it.problem,
      expected: it.expected || null,
      // The founder deliberately does not triage — severity is Claude's call.
      severity: null,
      founderVerdict: review.verdict === 'fix' ? 'NEEDS FIXING' : review.verdict === 'good' ? 'Looks good' : null,
      notes: shots.filter(s => s.issueId === id).map(s => s.note).filter(Boolean),
      screenshots: shots.filter(s => s.issueId === id).map(s => s.file),
      createdAt: it.createdAt || createdAt,
    }
  })
  return {
    reviewId: review.reviewId,
    tool: review.tool,
    createdAt,
    page: review.page,
    founderVerdict: review.verdict === 'fix' ? 'NEEDS FIXING' : review.verdict === 'good' ? 'Looks good' : 'No verdict given',
    checkpoints: {
      confirmed: review.checkpoints.filter(c => c.checked).length,
      total: review.checkpoints.length,
      items: review.checkpoints,
    },
    issues,
    screenshots: shots.map(s => ({
      file: s.file,
      issue: s.issueId,
      note: s.note || null,
      annotated: s.annotated,
      bytes: s.bytes.length,
    })),
    // `issues` counts written issue rows only. A founder who photographs a
    // defect and types the problem into the screenshot's note has reported a
    // defect just as much as one who filled an issue row, so those notes are
    // counted too — otherwise a real review reads as "0 issues" and looks like
    // nothing was sent. `evidence` is the number the founder should recognise.
    counts: countEvidence(issues, shots, review.checkpoints),
  }
}

/** Issues, screenshots, and the notes that are issues in everything but shape. */
export function countEvidence(issues, shots, checkpoints) {
  const written = s => !!(s && s.note && s.note.trim())
  const notes = shots.filter(written).length + checkpoints.filter(written).length
  return {
    issues: issues.length,
    screenshots: shots.length,
    notes,
    evidence: issues.length + notes,
  }
}

function buildReviewMd(review, json, shots) {
  const checkLines = json.checkpoints.items.length
    ? json.checkpoints.items.map(c => `- [${c.checked ? 'x' : ' '}] ${c.label}${c.note ? `\n      NOTE: ${c.note}` : ''}`).join('\n')
    : '(no checkpoints recorded)'

  const issueBlocks = json.issues.length
    ? json.issues.map(it => {
      const lines = [`### ${it.id}`, '', `**Problem:**`, it.problem || '(described in the screenshots below)']
      if (it.expected) lines.push('', '**Expected:**', it.expected)
      if (it.notes.length) lines.push('', '**Screenshot notes:**', ...it.notes.map(n => `- ${n}`))
      lines.push('', '**Screenshots:**', it.screenshots.length
        ? it.screenshots.map(f => `- \`${f}\``).join('\n')
        : '- (none attached to this issue)')
      return lines.join('\n')
    }).join('\n\n')
    : '(no written issues — the screenshots and checkpoint notes are the evidence)'

  const pageShots = shots.filter(s => !s.issueId)
  const pageShotBlock = pageShots.length
    ? pageShots.map(s => `- \`${s.file}\`${s.annotated ? '  (founder annotations flattened in)' : ''}${s.note ? `\n      NOTE: ${s.note}` : ''}`).join('\n')
    : '(none — every screenshot is attached to an issue above)'

  return `# CATCH COMICS — FOUNDER REVIEW

REVIEW ID: ${review.reviewId}
SECTION: ${review.page.title}
PRODUCTION: ${review.page.url.startsWith('http') ? review.page.url : 'https://catchcomics.com'}
FOUNDER VERDICT: ${json.founderVerdict}
CAPTURED: ${json.createdAt}

CHECKPOINTS (${json.checkpoints.confirmed}/${json.checkpoints.total} confirmed — notes belong to the checkpoint above them):
${checkLines}

## FOUNDER ISSUES

Separate items. Do not merge them unless they share a root cause. Severity is
deliberately absent: the founder does not triage, you do.

${issueBlocks}

## PAGE-LEVEL SCREENSHOTS

${pageShotBlock}

---

Every path above is relative to this package directory. Open the images — the
founder's annotations are drawn onto them and are part of what they mean.
`
}

/**
 * Write the package. Idempotent by construction: the directory is the
 * reviewId, and every file is rewritten from the same submission, so a retry
 * overwrites byte-for-byte instead of accumulating a second copy.
 */
export function writePackage(repoRoot, review) {
  const dir = packageDir(repoRoot, review.reviewId)
  const createdAt = new Date().toISOString()
  const shots = assignScreenshots(review)

  mkdirSync(join(dir, 'screenshots'), { recursive: true })
  for (const s of shots) writeFileSync(join(dir, ...s.file.split('/')), s.bytes)

  const json = buildReviewJson(review, shots, createdAt)
  writeFileSync(join(dir, 'review.json'), JSON.stringify(json, null, 2))
  writeFileSync(join(dir, 'review.md'), buildReviewMd(review, json, shots))

  // Verify what we claim to have written, rather than trusting the writes.
  const expected = ['review.json', 'review.md', ...shots.map(s => s.file)]
  const missing = expected.filter(f => {
    const p = join(dir, ...f.split('/'))
    return !existsSync(p) || statSync(p).size === 0
  })
  if (missing.length) throw new Error(`Package incomplete — missing or empty: ${missing.join(', ')}`)

  return { dir, json, files: expected }
}

/**
 * Merge this page's verdict into launch/founder-review.json.
 *
 * That file is Mission Control's testing-progress input, and it used to be
 * written by the browser through the directory picker. With the picker gone,
 * the bridge has to keep it current or the launch readiness score would
 * silently stop moving. Only the submitted page's entry is touched; every
 * other page is copied through untouched.
 */
export function updateFounderReviewJson(repoRoot, review, json) {
  const file = resolve(repoRoot, 'launch', 'founder-review.json')
  let doc = { pages: {} }
  try {
    // The file has been written by PowerShell in the past, so it may carry a
    // BOM. Strip it rather than letting JSON.parse throw and lose every page.
    doc = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch { /* first write, or unreadable — rebuild from what we know */ }
  if (!doc || typeof doc !== 'object') doc = {}
  if (!doc.pages || typeof doc.pages !== 'object') doc.pages = {}

  const prev = doc.pages[review.page.id] ?? {}
  doc.pages[review.page.id] = {
    ...prev,
    title: review.page.title,
    status: review.verdict,
    checkpoints: `${json.checkpoints.confirmed}/${json.checkpoints.total}`,
    shots: json.counts.screenshots,
    issues: json.counts.issues,
    lastReviewedAt: json.createdAt,
    lastSentAt: json.createdAt,
    lastReviewId: review.reviewId,
  }
  doc.updated = new Date().toISOString()
  doc.tool = 'smoke-test-v4'
  writeFileSync(file, JSON.stringify(doc, null, 2))
  return file
}

/* ── Claude Code launch ──────────────────────────────────────────────────── */

// Finding the CLI, reading its version and reading its authentication state all
// live in claude-readiness.mjs — the same module Command Centre's status card
// uses. Re-exported here so the handoff has one definition of "ready" rather
// than a second opinion of its own.
export { findClaude, claudeVersion }

/**
 * The entire instruction handed to the repair session. The browser cannot
 * change a word of it; the only substitution is the package path, which is
 * built from a reviewId that has already been pattern-checked.
 */
export function repairPrompt(relPackagePath) {
  return `Read the Founder Smoke Test review package at ${relPackagePath}/review.md, and its structured form at ${relPackagePath}/review.json.

Open every screenshot the package references, under ${relPackagePath}/screenshots/. Use the Read tool on each image file so you actually SEE it — the founder drew annotations onto these images and those marks are part of what the issue means. Do not work from the filenames or the written descriptions alone.

Treat each issue and its attached screenshots as founder evidence of a real defect. review.json maps every screenshot to the issue it belongs to; respect that mapping and do not attribute a screenshot to the wrong issue.

For each issue:
1. Inspect the actual implementation responsible for it before changing anything.
2. Repair it with the smallest correct change.
3. Do not weaken, skip or delete tests, and do not hide a defect behind a workaround.
4. Preserve unrelated work — this working tree may already contain changes that are none of your business. Never revert, stash or discard them.
5. Run focused verification for what you touched (typecheck, lint, the relevant test) — not a full audit.

Work on a focused git branch and make focused commits. Do not push, do not deploy, and do not run broad production operations.

Finish with an issue-by-issue report: diagnosis, fix, verification, and anything left unresolved with the reason. Do not perform unrelated audits or propose a redesign.`
}

/**
 * Fixed argv. Nothing the browser sent appears here except the package path,
 * inside the prompt, and that path is derived from a validated reviewId.
 */
export function claudeArgv(relPackagePath) {
  return [
    '-p', repairPrompt(relPackagePath),
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits',
    // Pinned, not aliased: on CLI 2.1.218 the `opus` alias still resolves to
    // claude-opus-4-8. A founder repair should get the current best model, so
    // the id is stated outright rather than left to an alias to decide.
    '--model', 'claude-opus-5',
    '--max-budget-usd', '15',
    // Deny rules for the actions this workflow must never take unattended.
    '--disallowedTools',
    'Bash(git push:*)', 'Bash(vercel:*)', 'Bash(npx vercel:*)', 'Bash(gh pr merge:*)',
  ]
}

/** The one sentence the founder is given when Claude Code is signed out. It
 *  names the button, not a command, because the button is now the journey. */
export const SIGNED_OUT_REASON =
  'Claude Code is signed out. Your review is saved — press “Sign in to Claude Code”, '
  + `finish the browser approval, then press Retry. (Manual fallback: ${SIGNIN_COMMAND})`

/** Classify a finished run. `blocked` is an environment problem, not a failure. */
export function classifyRun({ exitCode, result, spawnError }) {
  if (spawnError) return { state: 'blocked', reason: spawnError }
  const text = String(result?.result ?? '')
  if (/authenticat|OAuth session expired|Invalid API key|credit balance/i.test(text)) {
    return { state: 'blocked', reason: SIGNED_OUT_REASON }
  }
  if (exitCode === 0 && result && result.is_error !== true) return { state: 'completed', reason: null }
  return { state: 'failed', reason: text.slice(0, 400) || `Claude Code exited with code ${exitCode}` }
}

/* ── Process truth ───────────────────────────────────────────────────────────
   The states below are only worth anything if `running` means a process. Two
   rules make that true, and they are deliberately different from each other:

   WITHIN one bridge lifetime the child is in `this.children` and its `exit`
   event is authoritative. Liveness needs no guessing.

   ACROSS a restart the bridge has lost every handle it had. A pid read back
   out of run.json cannot be trusted to still be the same process — pids are
   reused — so a restarted bridge never re-claims a run as `running`. It marks
   it `stale`, which says exactly what is known: this run was started, and
   nobody can tell you how it ended.                                          */

/** Does a process with this pid exist? Signal 0 tests, it does not signal. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (err) { return err.code === 'EPERM' }   // exists, but not ours to signal
}

/** A run whose pid may still be editing the repo blocks new launches, but not
 *  forever: past this window a live pid is far more likely to be a reused
 *  number than a four-hour-old repair, and refusing on it would be a lie. */
export const ORPHAN_WINDOW_MS = 6 * 60 * 60 * 1000

/** States that mean "started, outcome unknown" — the ones a restart invalidates. */
const UNFINISHED = ['sending', 'packaging', 'packaged', 'launching', 'running']

export const STALE_REASON =
  'The bridge stopped before this repair reported back, so its outcome is unknown. '
  + 'The review and every screenshot are still on disk — press Retry to hand it to Claude again.'

/* ── Run registry ────────────────────────────────────────────────────────── */

/**
 * One record per submitted review, keyed by reviewId, mirrored to
 * `<package>/run.json` so a bridge restart does not lose what happened. The
 * registry is what makes a double-click safe: a reviewId that is already
 * known is never re-packaged and never re-launched.
 */
export class ReviewRunner {
  constructor(repoRoot, { spawnFn = spawn, findClaudeFn = findClaude, readinessFn = readiness } = {}) {
    this.repoRoot = repoRoot
    this.spawnFn = spawnFn
    this.findClaudeFn = findClaudeFn
    // The shared readiness check. Injected so the tests can drive a signed-out
    // machine without touching the founder's real account.
    this.readinessFn = readinessFn
    this.runs = new Map()
    this.activeId = null     // single-flight: one repair session at a time
    this.children = new Map()
    this.hydrate()
  }

  /**
   * Read every run.json back into the registry at startup and settle what the
   * previous bridge left behind. Without this the registry is empty after a
   * restart, `/review/status` answers 404 for a review the founder is watching,
   * and the page is left holding a `running` it can never resolve.
   */
  hydrate() {
    const root = resolve(this.repoRoot, 'launch', 'reviews')
    let entries = []
    try { entries = readdirSync(root, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      let rec
      try { rec = JSON.parse(readFileSync(join(root, e.name, 'run.json'), 'utf8')) }
      catch { continue }
      if (!rec || rec.reviewId !== e.name) continue
      // Packages written before evidence counting existed still deserve an
      // honest count, so recompute rather than showing the founder a stale 0.
      if (rec.counts && rec.counts.notes === undefined) {
        try {
          const r = JSON.parse(readFileSync(join(root, e.name, 'review.json'), 'utf8'))
          rec.counts = countEvidence(r.issues ?? [], r.screenshots ?? [], r.checkpoints?.items ?? [])
        } catch { /* an unreadable review.json is not worth failing hydration for */ }
      }
      if (UNFINISHED.includes(rec.state)) {
        // Never re-claim it as running: this process did not start it and
        // cannot prove what happened to it.
        rec.state = 'stale'
        rec.reason = STALE_REASON
        rec.finishedAt = rec.finishedAt ?? new Date().toISOString()
        // A pid that is still alive is the one case worth acting on: something
        // may still be editing this repo, so it holds the single-flight lock.
        rec.orphanPid = this.#orphanPid(rec) ?? null
        this.persist(rec)
      }
      this.runs.set(rec.reviewId, rec)
    }
  }

  /** The pid of a possibly-surviving repair from a previous bridge, or null. */
  #orphanPid(rec) {
    const started = Date.parse(rec.launchedAt ?? '')
    if (!Number.isFinite(started) || Date.now() - started > ORPHAN_WINDOW_MS) return null
    return pidAlive(rec.pid) ? rec.pid : null
  }

  /**
   * Settle the single-flight lock against reality before anyone reads or is
   * refused by it. A lock held by a child that has gone is not a lock.
   */
  reconcile() {
    if (this.activeId) {
      // `children` is emptied by the exit and error handlers, so membership
      // already means "has not reported an exit". The pid check is what
      // catches the case those handlers can never fire for: the child died
      // with the bridge, or with the console it was started from.
      const child = this.children.get(this.activeId)
      const alive = !!child && !child.killed && pidAlive(child.pid)
      if (!alive) {
        const rec = this.runs.get(this.activeId)
        if (rec && UNFINISHED.includes(rec.state)) {
          rec.state = 'stale'
          rec.reason = STALE_REASON
          rec.finishedAt = new Date().toISOString()
          this.persist(rec)
        }
        this.children.delete(this.activeId)
        this.activeId = null
      }
    }
    // An orphan from a previous bridge that has since exited stops blocking.
    for (const rec of this.runs.values()) {
      if (rec.orphanPid && !pidAlive(rec.orphanPid)) {
        rec.orphanPid = null
        this.persist(rec)
      }
    }
    return this.activeId
  }

  /** The record, settled first — a status read must never report a dead run
   *  as running just because nothing has looked at it since. */
  get(reviewId) {
    this.reconcile()
    return this.runs.get(reviewId) ?? null
  }

  list() { this.reconcile(); return [...this.runs.values()] }

  persist(rec) {
    try {
      writeFileSync(join(packageDir(this.repoRoot, rec.reviewId), 'run.json'), JSON.stringify(rec, null, 2))
    } catch { /* the run record is a convenience; never fail a run over it */ }
  }

  /** Public view of a record — no absolute paths beyond the repo, no argv. */
  static view(rec) {
    if (!rec) return null
    // logPath is an absolute path on this machine; destructured out so it is
    // dropped from the response rather than deleted from the live record.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { logPath, ...rest } = rec
    return rest
  }

  /**
   * Package and launch. Returns the run record. Idempotent on reviewId:
   *   - an in-flight or finished run is returned untouched (duplicate: true);
   *   - a run whose Claude launch was BLOCKED can be retried, and reuses the
   *     package that is already on disk rather than writing a second one.
   */
  submit(body) {
    const review = validateSubmission(body)
    const existing = this.runs.get(review.reviewId)

    if (existing) {
      const retryable = ['blocked', 'failed', 'stale'].includes(existing.state)
      if (!retryable) return { ...existing, duplicate: true }
      // Retry: the package is already written and verified. Only relaunch.
      existing.duplicate = false
      return this.#launch(existing)
    }

    const rec = {
      reviewId: review.reviewId,
      page: review.page,
      state: 'packaging',
      reason: null,
      packagePath: `launch/reviews/${review.reviewId}`,
      counts: { issues: 0, screenshots: 0 },
      submittedAt: new Date().toISOString(),
      launchedAt: null,
      finishedAt: null,
      exitCode: null,
      sessionId: null,
      costUsd: null,
      duplicate: false,
      attempts: 0,
    }
    this.runs.set(rec.reviewId, rec)

    let written
    try {
      written = writePackage(this.repoRoot, review)
    } catch (err) {
      // The review did not survive — say so plainly rather than launching
      // Claude at a package that is not there.
      rec.state = 'failed'
      rec.reason = `Could not write the review package: ${err.message}`
      rec.finishedAt = new Date().toISOString()
      return rec
    }

    rec.counts = written.json.counts
    rec.files = written.files
    rec.state = 'packaged'

    // Keep Mission Control's testing progress honest now that no directory
    // picker is doing it. A failure here must not cost the founder the review.
    try { updateFounderReviewJson(this.repoRoot, review, written.json) }
    catch (err) { console.error('[founder-review] could not update founder-review.json:', err.message) }

    this.persist(rec)

    return this.#launch(rec)
  }

  #launch(rec) {
    // Counted here, before anything can refuse: `attempts` means "times this
    // review was handed to Claude", which is what the founder pressed. A
    // blocked attempt is still an attempt, and saying otherwise would make a
    // retry look like it never happened.
    rec.attempts += 1

    // Settle the lock against reality first. Refusing a launch because of a
    // repair that has already exited is how a dead run becomes a permanent
    // blocker, and it is the founder who pays for that in lost reviews.
    this.reconcile()

    // Single-flight across reviews: two repair sessions editing the same repo
    // at once would fight over the working tree.
    if (this.activeId && this.activeId !== rec.reviewId) {
      const other = this.runs.get(this.activeId)
      rec.state = 'blocked'
      rec.blockedBy = other?.page?.title ?? this.activeId
      rec.reason = `A Claude repair is already running for ${rec.blockedBy}. This review is saved — press Retry when that one finishes.`
      this.persist(rec)
      return rec
    }

    // Deliberately NOT a refusal. A pid recovered from a previous bridge's
    // run.json cannot be shown to still BE that repair — pids are reused — so
    // refusing on it would block a founder on a guess, which is the exact
    // failure this whole change exists to remove. Single-flight is enforced
    // where it can be proven: against a live child this bridge is holding.
    // The observation is still worth surfacing, so it is recorded, not acted on.
    rec.blockedBy = null

    const exe = this.findClaudeFn()
    if (!exe) {
      rec.state = 'blocked'
      rec.reason = 'Claude Code was not found on this machine. Install it (npm i -g @anthropic-ai/claude-code), then press Retry. Your review is saved.'
      this.persist(rec)
      return rec
    }

    // Ask BEFORE launching. Starting a session that is only going to fail on an
    // expired token wastes the founder's time and buries the real cause in
    // Claude's own output. The package is already written and verified by the
    // time we get here, so a signed-out machine costs nothing but a retry.
    const ready = this.readinessFn({ fresh: true })
    if (ready && ready.state === 'signin-required') {
      rec.state = 'blocked'
      rec.reason = SIGNED_OUT_REASON
      rec.readinessState = ready.state
      this.persist(rec)
      console.log(`[founder-review] ${rec.reviewId} — not launched: Claude Code is signed out. Review saved.`)
      return rec
    }

    rec.state = 'launching'
    rec.launchedAt = new Date().toISOString()
    rec.finishedAt = null
    rec.exitCode = null
    rec.reason = null
    rec.pid = null
    rec.orphanPid = null

    const dir = packageDir(this.repoRoot, rec.reviewId)
    const logPath = join(dir, 'claude-run.jsonl')
    rec.logPath = logPath

    let child
    try {
      child = this.spawnFn(exe, claudeArgv(rec.packagePath), {
        cwd: this.repoRoot,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      const c = classifyRun({ spawnError: `Claude Code could not be started: ${err.message}` })
      Object.assign(rec, c, { finishedAt: new Date().toISOString() })
      this.persist(rec)
      return rec
    }

    // spawn() resolved without throwing, but only a pid proves a process was
    // actually created. Without one there is nothing to call running later.
    if (!child.pid) {
      const c = classifyRun({ spawnError: 'Claude Code was started but no process appeared. Your review is saved — press Retry.' })
      Object.assign(rec, c, { finishedAt: new Date().toISOString() })
      this.persist(rec)
      return rec
    }

    rec.pid = child.pid
    this.activeId = rec.reviewId
    this.children.set(rec.reviewId, child)

    let tail = ''
    let result = null
    let stderr = ''
    const lines = []

    child.stdout.on('data', chunk => {
      tail += chunk.toString()
      const parts = tail.split('\n')
      tail = parts.pop() ?? ''
      for (const line of parts) {
        if (!line.trim()) continue
        lines.push(line)
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        // The init event is the honest signal that Claude really started —
        // the process being alive is not the same thing.
        if (ev.type === 'system' && ev.subtype === 'init') {
          rec.sessionId = ev.session_id ?? null
          // Claude announced itself. Confirm the process it announced itself
          // from is still there before anyone is told a repair is running:
          // an init line that arrives from a child already gone is a message,
          // not a running session.
          if (this.children.has(rec.reviewId) && !child.killed && pidAlive(child.pid)) rec.state = 'running'
          this.persist(rec)
        }
        if (ev.type === 'result') result = ev
      }
    })
    child.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-4000) })

    child.on('exit', code => {
      this.children.delete(rec.reviewId)
      if (this.activeId === rec.reviewId) this.activeId = null
      if (tail.trim()) lines.push(tail)
      try { writeFileSync(logPath, lines.join('\n') + '\n') } catch { /* transcript is best-effort */ }

      rec.exitCode = code
      rec.finishedAt = new Date().toISOString()
      rec.costUsd = typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null
      rec.sessionId = result?.session_id ?? rec.sessionId
      const c = classifyRun({ exitCode: code, result })
      rec.state = c.state
      rec.reason = c.reason || (c.state === 'failed' && stderr ? stderr.slice(0, 400) : c.reason)
      rec.summary = typeof result?.result === 'string' && c.state === 'completed' ? result.result.slice(0, 2000) : null
      this.persist(rec)
      console.log(`[founder-review] ${rec.reviewId} — ${rec.state}${rec.reason ? ` (${rec.reason.slice(0, 120)})` : ''}`)
    })

    child.on('error', err => {
      this.children.delete(rec.reviewId)
      if (this.activeId === rec.reviewId) this.activeId = null
      const c = classifyRun({ spawnError: `Claude Code could not be started: ${err.message}` })
      Object.assign(rec, c, { finishedAt: new Date().toISOString() })
      this.persist(rec)
    })

    this.persist(rec)
    console.log(`[founder-review] ${rec.reviewId} — launched Claude repair as process ${rec.pid} (${rec.counts.issues} issues, ${rec.counts.notes ?? 0} notes, ${rec.counts.screenshots} screenshots)`)
    return rec
  }

  /**
   * Health for the Smoke Test: what the founder can rely on right now.
   *
   * `readiness` is the SAME object Command Centre's Claude card reads — the
   * Smoke Test does not run its own authentication check, so the two surfaces
   * can never disagree about whether Send-to-Claude will work. `claude` is kept
   * alongside it because the page has always read that shape.
   */
  health({ fresh = false } = {}) {
    this.reconcile()
    const ready = this.readinessFn({ fresh })
    const exe = this.findClaudeFn()
    return {
      ok: true,
      repoRoot: this.repoRoot,
      reviewsPath: 'launch/reviews',
      claude: exe
        ? { available: true, version: ready?.claude?.version ?? claudeVersion(exe) }
        : { available: false, version: null },
      readiness: ready,
      active: this.activeId,
    }
  }
}
