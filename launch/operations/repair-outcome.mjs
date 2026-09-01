#!/usr/bin/env node
/**
 * repair-outcome.mjs — what a finished Claude repair actually achieved.
 *
 * WHY THIS EXISTS
 * The run record already knew when a repair PROCESS ended. It did not know
 * whether the REPAIR happened. `classifyRun` mapped exit code 0 onto the word
 * "completed", the Smoke Test card printed "Claude repair complete", and a run
 * that had edited two files, failed its typecheck and never committed read
 * exactly like one that had fixed the defect. A founder cannot act on that.
 *
 * So this module answers a different question from "did the process exit": did
 * the work the repair was ASKED to do get done. It is deliberately not a second
 * opinion on the model's prose — Claude's own report is carried through
 * verbatim as `summary`, and every claim BELOW it is derived from something
 * that happened rather than something that was said.
 *
 * TWO CLASSES OF EVIDENCE, AND WHY THEY DIFFER
 *
 *   From git, in the repo:  commits, and what is still uncommitted in the
 *   worktree. These are filesystem facts. A repair cannot write a commit into
 *   existence by claiming one, and the 2026-08-31 listing-trust work is on
 *   record precisely because a transcript string was once mistaken for proof.
 *   Anything a founder would act on — "there is a commit to integrate" — comes
 *   from here.
 *
 *   From the transcript:  which verification commands ran and whether the
 *   command itself reported an error, which files were edited, what was
 *   refused. These are the stream's own tool_result records, not the model's
 *   summary of them — the closest thing to a receipt that exists for a command
 *   whose output was never written to disk.
 *
 * WHAT "VERIFIED" IS ALLOWED TO MEAN
 * Only what the repair was actually asked for. `repairPrompt` requires three
 * things and forbids the rest: make the smallest correct change, run focused
 * verification, finish on a commit. Push, merge and deploy are REFUSED to an
 * unattended repair, so demanding production proof before saying anything good
 * would make every run incomplete forever — dishonest in the other direction.
 * The outcome therefore tops out at `verified-local`, which says in its own
 * name that production has not been touched, and every such report carries the
 * founder's remaining steps rather than implying there are none.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

/** Cap on how much of one transcript we will hold in memory at once. A repair
 *  log is routinely 1.5 MB and is read once, at exit; this is a guard against a
 *  pathological one, not a budget. */
const MAX_LOG_BYTES = 64 * 1024 * 1024

/** Bounds on what reaches run.json. The record is re-read on every bridge
 *  start, so it stays small enough to be cheap and complete enough to be true. */
export const REPORT_LIMITS = {
  FILES: 40,
  COMMITS: 20,
  VERIFICATION: 20,
  REFUSALS: 8,
  SUMMARY_CHARS: 6000,
}

/* ── Reading the transcript ──────────────────────────────────────────────── */

/** Parse claude-run.jsonl. A malformed line is skipped, never fatal: the
 *  transcript is evidence, and partial evidence still beats none. */
export function readTranscript(logPath) {
  if (!logPath || !existsSync(logPath)) return []
  let raw
  try { raw = readFileSync(logPath, 'utf8') } catch { return [] }
  if (raw.length > MAX_LOG_BYTES) raw = raw.slice(0, MAX_LOG_BYTES)
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* a torn line is not a verdict */ }
  }
  return out
}

/**
 * Repo-relative, forward-slashed, with whichever root it sits under removed.
 *
 * Both roots are tried because both occur: a repair since 2026-08-31 edits its
 * own worktree, and the runs before that edited the founder's checkout
 * directly. Either way the founder wants `lib/search/priceFilter.ts`, not a
 * 70-character path whose only distinguishing part is at the end.
 */
export function relativise(p, ...roots) {
  if (typeof p !== 'string' || !p) return null
  let s = p.replace(/\\/g, '/')
  for (const root of roots) {
    const r = String(root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
    if (r && s.toLowerCase().startsWith(r.toLowerCase() + '/')) { s = s.slice(r.length + 1); break }
  }
  return s.replace(/^\.\//, '')
}

/**
 * The verification script a command runs, if it runs one we recognise, plus
 * whether that script was the ONLY thing the command did.
 *
 * `clean` exists because of a real misreading: the 2026-08-31 repair typed
 * `npm run lint && git add … && git commit …` as one command, and quoting the
 * output's last line under the heading "npm run lint" printed a commit summary
 * as if it were the linter's verdict. A chained command still proves the script
 * ran and that the chain did not error — it does not entitle us to quote a line
 * that some later command wrote. So `clean` gates the quote, never the result.
 */
export function verifyScriptIn(command, known) {
  const text = String(command ?? '')
  const m = /(?:^|&&|\|\||;)\s*(?:cd\s+[^&|;]*&&\s*)?npm\s+run\s+([A-Za-z0-9:_-]+)/.exec(text)
  if (!m || !known.includes(m[1])) return null
  // Segments that do real work: a `cd` that only positions the shell is not one.
  const work = text.split(/\s*(?:&&|\|\||;)\s*/)
    .map(s => s.trim())
    .filter(s => s && !/^cd\b/.test(s))
  return { script: m[1], clean: work.length === 1 }
}

/**
 * Pair every tool_use with its tool_result. The stream interleaves them across
 * events, so this is the only way to know whether a command that RAN also
 * WORKED — which is the whole difference between "Claude ran the typecheck"
 * and "the typecheck passed".
 */
export function toolOutcomes(events) {
  const uses = []
  const results = new Map()
  for (const ev of events) {
    const content = ev?.message?.content
    if (!Array.isArray(content)) continue
    if (ev.type === 'assistant') {
      for (const b of content) if (b?.type === 'tool_use') uses.push({ id: b.id, name: b.name, input: b.input ?? {} })
    } else if (ev.type === 'user') {
      for (const b of content) {
        if (b?.type !== 'tool_result') continue
        const text = typeof b.content === 'string'
          ? b.content
          : Array.isArray(b.content)
            ? b.content.filter(x => x?.type === 'text').map(x => x.text).join('\n')
            : ''
        results.set(b.tool_use_id, { error: b.is_error === true, text })
      }
    }
  }
  return uses.map(u => ({ ...u, result: results.get(u.id) ?? null }))
}

/**
 * One line of a command's output worth showing: the last non-empty line is
 * where a test runner puts its verdict.
 *
 * Replacement characters are dropped rather than shown. They are real — the
 * transcript records what the Windows console made of a runner's ✓ — but a
 * founder reading "'� Types clean'" learns nothing from the mojibake and
 * may reasonably read it as a fault in the check itself.
 */
function lastLine(text, max = 120) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  return (lines[lines.length - 1] ?? '')
    .replace(/�/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^['"\s]+|['"\s]+$/g, '')
    .slice(0, max)
}

/* ── Git, which is the half a repair cannot talk its way past ────────────── */

const runGit = (cwd, args) => {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
    if (r.status !== 0) return null
    return String(r.stdout ?? '')
  } catch { return null }
}

/** Field separator for `git log --format`. A unit separator, because a commit
 *  subject may legitimately contain any punctuation a person can type. */
const UNIT = ''

/**
 * Commits the repair actually made, read from the object store the founder's
 * checkout and the repair worktree share. Read in the REPO, not the worktree:
 * the worktree may already have been removed by the time a founder reads the
 * report, and the branch ref outlives it.
 */
export function commitsMade({ repoRoot, branch, baseCommit, gitFn = runGit }) {
  if (!repoRoot || !branch || !baseCommit) return []
  const out = gitFn(repoRoot, ['log', '--no-color', `--format=%H${UNIT}%s${UNIT}%aI`, `${baseCommit}..${branch}`])
  if (!out) return []
  const commits = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [sha, subject, at] = line.split(UNIT)
    if (!sha) continue
    const names = gitFn(repoRoot, ['show', '--no-color', '--pretty=format:', '--name-only', sha]) ?? ''
    commits.push({
      sha: sha.slice(0, 7),
      subject: String(subject ?? '').slice(0, 140),
      at: at ?? null,
      files: names.split('\n').map(s => s.trim()).filter(Boolean).slice(0, REPORT_LIMITS.FILES),
    })
  }
  return commits.reverse().slice(0, REPORT_LIMITS.COMMITS)
}

/** Work left loose in the repair worktree. A repair that edited and never
 *  committed is the exact case that must not read as finished. */
export function uncommittedIn({ worktreePath, gitFn = runGit }) {
  if (!worktreePath || !existsSync(worktreePath)) return []
  const out = gitFn(worktreePath, ['status', '--porcelain'])
  if (!out) return []
  return out.split('\n').map(l => l.slice(3).trim()).filter(Boolean).slice(0, REPORT_LIMITS.FILES)
}

/* ── The verdict ─────────────────────────────────────────────────────────── */

/** What the founder still has to do after ANY successful repair, because the
 *  repair is refused all three. Stated on every report so "verified" can never
 *  be read as "shipped". */
export const FOUNDER_STEPS = [
  'Review the commit and integrate it into main',
  'Deploy',
  'Re-check the page on production',
]

export const OUTCOME_LABELS = {
  'verified-local': 'Verified locally — not on production yet',
  incomplete: 'Incomplete — not verified fixed',
  'no-change': 'No change made',
  failed: 'Failed',
  unknown: 'Outcome unknown',
}

/**
 * Turn the facts into one word. The order matters: a failing verification is
 * never allowed to be outranked by a commit that exists, because a repair can
 * commit a broken change and every step would still look green.
 */
export function classifyOutcome({ state, changedFiles, verification, commits, uncommitted }) {
  if (state === 'failed') return { outcome: 'failed', missing: [], done: [] }
  if (state !== 'completed') return { outcome: 'unknown', missing: [], done: [] }

  const ran = verification.length > 0
  const allPassed = ran && verification.every(v => v.ok)
  const changed = changedFiles.length > 0 || commits.length > 0
  const committed = commits.length > 0

  const done = []
  const missing = []
  if (changed) done.push('Code changes')
  else missing.push('Code changes')
  if (allPassed) done.push('Verification')
  else missing.push(ran ? 'Verification (a check failed)' : 'Verification (nothing was run)')
  if (committed) done.push('Commit')
  else missing.push(uncommitted.length ? 'Commit (changes left uncommitted)' : 'Commit')

  if (!changed) return { outcome: 'no-change', missing, done }
  if (allPassed && committed) return { outcome: 'verified-local', missing: [], done }
  return { outcome: 'incomplete', missing, done }
}

/**
 * The whole founder-facing report for one finished run. Everything here is
 * durable: it is written into run.json, so it survives a page reload, a bridge
 * restart and the worktree being removed.
 */
export function deriveReport({
  state, logPath, events = null, result = null, summary = null,
  repoRoot, branch, baseCommit, worktreePath, verifyScripts = [],
  gitFn = runGit,
}) {
  const evs = events ?? readTranscript(logPath)
  const tools = toolOutcomes(evs)

  // Edits, in the order they were first made. A failed edit is not a change.
  const files = []
  for (const t of tools) {
    if (!['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(t.name)) continue
    if (t.result?.error) continue
    const rel = relativise(t.input.file_path ?? t.input.notebook_path, worktreePath, repoRoot)
    if (rel && !files.includes(rel)) files.push(rel)
  }

  // Verification, keyed by script so a re-run replaces its own earlier failure.
  // A command with no result never finished, and an unfinished check is not a
  // passed one.
  const byScript = new Map()
  for (const t of tools) {
    if (t.name !== 'Bash') continue
    const found = verifyScriptIn(t.input.command, verifyScripts)
    if (!found) continue
    byScript.set(found.script, {
      script: found.script,
      command: `npm run ${found.script}`,
      ok: !!t.result && !t.result.error,
      detail: !t.result ? 'never reported back' : found.clean ? lastLine(t.result.text) : '',
    })
  }
  const verification = [...byScript.values()].slice(0, REPORT_LIMITS.VERIFICATION)

  // Deduped by message. A session that hit the same wall eight times learned
  // one thing, not eight, and eight identical red lines read as eight problems.
  const seen = new Map()
  for (const e of evs) {
    if (e?.type !== 'system' || e.subtype !== 'permission_denied') continue
    const message = String(e.message ?? '').replace(/\s+/g, ' ').slice(0, 200)
    const key = `${e.tool_name ?? 'Bash'}|${message}`
    const prev = seen.get(key)
    if (prev) prev.times += 1
    else seen.set(key, { tool: e.tool_name ?? 'Bash', message, times: 1 })
  }
  const refusals = [...seen.values()].slice(0, REPORT_LIMITS.REFUSALS)

  const commits = commitsMade({ repoRoot, branch, baseCommit, gitFn })
  const uncommitted = uncommittedIn({ worktreePath, gitFn })
  const { outcome, missing, done } = classifyOutcome({ state, changedFiles: files, verification, commits, uncommitted })

  const finalText = typeof summary === 'string' && summary
    ? summary
    : typeof result?.result === 'string' ? result.result : ''

  return {
    outcome,
    label: OUTCOME_LABELS[outcome] ?? OUTCOME_LABELS.unknown,
    // Said outright rather than left to be inferred from the absence of a
    // field: nothing in this pipeline can deploy, so nothing in it can prove
    // the founder's issue is fixed where the founder saw it.
    productionVerified: false,
    changedFiles: files.slice(0, REPORT_LIMITS.FILES),
    changedFileCount: files.length,
    verification,
    commits,
    uncommitted,
    refusals,
    done,
    missing,
    founderSteps: outcome === 'verified-local' ? FOUNDER_STEPS : [],
    turns: evs.filter(e => e?.type === 'assistant').length,
    summary: finalText.slice(0, REPORT_LIMITS.SUMMARY_CHARS),
    derivedAt: new Date().toISOString(),
  }
}

/* ── The same report, as a file a person can open ────────────────────────── */

const tick = ok => (ok ? '✓' : '✗')

/** Written next to the review it repairs, so the report outlives the browser
 *  that displayed it and can be read with no tooling at all. */
export function renderReportMd(rec, report) {
  const L = []
  const title = rec?.page?.title ?? rec?.reviewId ?? 'Review'
  L.push(`# Claude repair report — ${title}`, '')
  L.push(`**Result: ${report.label.toUpperCase()}**`, '')
  L.push(`- Review: \`${rec?.reviewId ?? ''}\``)
  if (rec?.branch) L.push(`- Branch: \`${rec.branch}\``)
  if (rec?.baseCommit) L.push(`- Based on: \`${String(rec.baseCommit).slice(0, 7)}\``)
  if (rec?.finishedAt) L.push(`- Finished: ${rec.finishedAt}`)
  if (typeof rec?.costUsd === 'number') L.push(`- Cost: $${rec.costUsd.toFixed(2)} over ${report.turns} turns`)
  L.push('')

  if (report.changedFiles.length) {
    L.push('## Files changed', '')
    for (const f of report.changedFiles) L.push(`- \`${f}\``)
    if (report.changedFileCount > report.changedFiles.length) {
      L.push(`- …and ${report.changedFileCount - report.changedFiles.length} more`)
    }
    L.push('')
  }

  L.push('## Verification', '')
  if (report.verification.length) {
    for (const v of report.verification) L.push(`- ${tick(v.ok)} \`${v.command}\`${v.detail ? ` — ${v.detail}` : ''}`)
  } else {
    L.push('- ✗ Nothing was run.')
  }
  L.push('')

  L.push('## Commits', '')
  if (report.commits.length) {
    for (const c of report.commits) L.push(`- \`${c.sha}\` ${c.subject} (${c.files.length} file${c.files.length === 1 ? '' : 's'})`)
  } else {
    L.push('- ✗ None.')
  }
  L.push('')

  if (report.uncommitted.length) {
    L.push('## Left uncommitted in the repair worktree', '')
    for (const f of report.uncommitted) L.push(`- \`${f}\``)
    L.push('')
  }

  if (report.missing.length) {
    L.push('## Not completed', '')
    for (const m of report.missing) L.push(`- ✗ ${m}`)
    L.push('')
  }

  if (report.refusals.length) {
    L.push('## Commands the repair was refused', '')
    for (const r of report.refusals) L.push(`- ${r.tool}: ${r.message}${r.times > 1 ? ` (×${r.times})` : ''}`)
    L.push('')
  }

  L.push('## Production', '')
  L.push('An unattended repair cannot push, merge or deploy — those are refused. '
    + 'Nothing in this report is evidence that the page the founder reviewed is fixed on production.')
  if (report.founderSteps.length) {
    L.push('', 'Still to do:')
    for (const s of report.founderSteps) L.push(`- [ ] ${s}`)
  }
  L.push('')

  if (report.summary) L.push("## Claude's own report", '', report.summary, '')
  return L.join('\n')
}
