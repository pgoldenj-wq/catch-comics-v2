/**
 * scripts/costguard-runs.ts — build the Cost Guard run/incident analysis that
 * launch/cost-guard.html renders.
 *
 * Run: npm run costguard:runs        (Command Centre launcher calls this)
 *
 * Reads GitHub Actions history for the Cost Guard workflow via the `gh` CLI —
 * which already holds the founder's credentials, so no token is ever written
 * into a file the browser can read. Output: launch/operations/costguard-runs-
 * latest.json.
 *
 * ZERO COST AND ZERO SIDE EFFECTS: this script only performs GitHub REST GETs.
 * It never re-runs a workflow, never calls a provider API, never triggers an
 * Inngest function, and never touches production. Requests are hard-capped by
 * MAX_API_CALLS.
 *
 * The whole point is that diagnosis is RULE-BASED: every condition the founder
 * actually hits is classified here, deterministically, so the page can answer
 * "is money at risk / is Cost Guard broken / must I act" without an LLM.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = process.env.COSTGUARD_RUNS_REPO ?? 'pgoldenj-wq/catch-comics-v2'
const WORKFLOW = 'cost-guard.yml'
const RUN_LIMIT = Number(process.env.COSTGUARD_RUNS_LIMIT ?? 40)
/** Hard ceiling on GitHub API calls, so a bad day can never become a request storm. */
const MAX_API_CALLS = 120
const OUT = join(process.cwd(), 'launch', 'operations', 'costguard-runs-latest.json')

let apiCalls = 0

function gh(args: string[]): unknown {
  if (apiCalls >= MAX_API_CALLS) throw new Error(`API call cap (${MAX_API_CALLS}) reached`)
  apiCalls += 1
  const raw = execFileSync('gh', args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
  return JSON.parse(raw) as unknown
}

// ── Types ────────────────────────────────────────────────────────────────────

type Classification =
  | 'threshold-lockdown' | 'threshold-red' | 'threshold-amber'
  | 'missing-repo-secret' | 'missing-vercel-secret' | 'auth-mismatch'
  | 'endpoint-unreachable' | 'malformed-response' | 'no-telemetry'
  | 'provider-stale' | 'runner-never-assigned' | 'cost-hazard-scan-failed'
  | 'healthy' | 'in-progress' | 'unclassified'

interface RunRow {
  id: number
  url: string
  event: string
  branch: string
  sha: string
  createdAt: string
  durationSec: number | null
  conclusion: string
  failedJob: string | null
  failedStep: string | null
  annotations: string[]
  classification: Classification
  /** Stable identity for grouping identical repeats into one incident. */
  signature: string
}

interface Incident {
  signature: string
  classification: Classification
  title: string
  meaning: string
  moneyAtRisk: boolean
  costGuardBroken: boolean
  firstSeen: string
  lastSeen: string
  count: number
  state: 'open' | 'resolved'
  resolvedAt: string | null
  durationHours: number
  runIds: number[]
  sampleAnnotations: string[]
  /** Providers still blind right now, per the live state file. */
  stillFailing?: string[]
}

/**
 * Live stale-provider list from the sibling status file. Read defensively: an
 * absent or unreadable file must never be treated as "nothing is stale".
 */
function readStaleProviders(): string[] {
  try {
    const raw = readFileSync(join(process.cwd(), 'launch', 'operations', 'costguard-latest.json'), 'utf8')
    const doc = JSON.parse(raw) as { staleProviders?: string[] }
    return Array.isArray(doc.staleProviders) ? doc.staleProviders : []
  } catch {
    return []
  }
}

// ── Rule-based classification ────────────────────────────────────────────────

/**
 * Ordered rules — first match wins, most specific first. Each rule also states
 * what the condition MEANS, because "spend-check failed" is exactly the
 * unhelpful phrasing that made the founder's emails useless.
 */
const RULES: Array<{
  id: Classification
  test: (text: string) => boolean
  title: string
  meaning: string
  moneyAtRisk: boolean
  costGuardBroken: boolean
}> = [
  {
    id: 'threshold-lockdown',
    test: t => /Cost Guard is LOCKDOWN/i.test(t),
    title: 'LOCKDOWN — catastrophic spend threshold latched',
    meaning: 'Cost Guard detected spend past the catastrophic threshold and latched LOCKDOWN. Bulk and non-essential jobs are being refused. This is a real spend event.',
    moneyAtRisk: true, costGuardBroken: false,
  },
  {
    // Ordered ahead of threshold-red deliberately. A RED whose only reasons are
    // "stale provider" and the recovery hold is NOT evidence of overspend — it
    // is Cost Guard refusing to go green while blind. Collapsing the two would
    // report a blackout as a spend incident, which is the exact confusion the
    // founder's emails already caused.
    id: 'provider-stale',
    test: t => /Stale\/failed provider data/i.test(t) && !/exceeds [A-Z]+ threshold/i.test(t),
    title: 'Blind spot — a provider stopped reporting',
    meaning: 'Cost Guard did NOT measure a spend breach. At least one provider returned no usable data, so its spend is unmonitored and reads as zero in the totals. The state stays non-green because a guard that cannot see must not report all-clear.',
    moneyAtRisk: false, costGuardBroken: true,
  },
  {
    id: 'threshold-red',
    test: t => /Cost Guard is (still )?RED/i.test(t) || /exceeds RED threshold/i.test(t),
    title: 'RED — a provider crossed its critical threshold',
    meaning: 'Cost Guard collected real provider telemetry and a measured rate or projection crossed the RED threshold. Containment is active: non-essential and high-risk jobs are refused.',
    moneyAtRisk: true, costGuardBroken: false,
  },
  {
    id: 'missing-repo-secret',
    test: t => /COSTGUARD_CRON_SECRET is not set as a repo Actions secret/i.test(t),
    title: 'Not configured — COSTGUARD_CRON_SECRET missing from GitHub',
    meaning: 'The scheduled job has no secret to authenticate with, so no spend check ran at all. Nothing is watching spend.',
    moneyAtRisk: false, costGuardBroken: true,
  },
  {
    id: 'missing-vercel-secret',
    test: t => /production reports COSTGUARD_CRON_SECRET is missing from Vercel env/i.test(t),
    title: 'Not configured — COSTGUARD_CRON_SECRET missing from Vercel',
    meaning: 'Production answered 503: the server has no secret configured, so collection never ran. Nothing is watching spend.',
    moneyAtRisk: false, costGuardBroken: true,
  },
  {
    id: 'auth-mismatch',
    test: t => /rejected the Actions secret \(401\)/i.test(t),
    title: 'Auth mismatch — GitHub and Vercel secrets differ',
    meaning: 'Collection was rejected with 401. The GitHub Actions secret and the Vercel env var are not the same value, so no spend was collected.',
    moneyAtRisk: false, costGuardBroken: true,
  },
  {
    id: 'endpoint-unreachable',
    test: t => /collect endpoint unreachable/i.test(t),
    title: 'Collect endpoint unreachable',
    meaning: 'Production did not answer after 3 attempts, so spend went unwatched for that cycle. Usually a deploy window or a transient network fault.',
    moneyAtRisk: false, costGuardBroken: true,
  },
  {
    id: 'no-telemetry',
    test: t => /no provider returned telemetry/i.test(t),
    title: 'Not configured — authenticated but zero provider telemetry',
    meaning: 'Collection authenticated, but every provider failed or is unconfigured, so no spend was actually observed. A guard with no data cannot protect anything.',
    moneyAtRisk: false, costGuardBroken: true,
  },
  {
    id: 'malformed-response',
    test: t => /returned no state/i.test(t),
    title: 'Malformed collect response',
    meaning: 'The collect endpoint answered 200 but without a usable state field, so the run could not be evaluated.',
    moneyAtRisk: false, costGuardBroken: true,
  },
  {
    id: 'cost-hazard-scan-failed',
    test: t => /check-cost-hazards/i.test(t),
    title: 'PR cost-hazard scan found a hazard',
    meaning: 'The pull-request scanner flagged a concrete cost hazard in changed code. This is a code review signal, not a live spend event.',
    moneyAtRisk: false, costGuardBroken: false,
  },
]

function classify(run: {
  conclusion: string; annotations: string[]; failedJob: string | null; hasJobs: boolean
  status?: string
}): { classification: Classification; title: string; meaning: string; moneyAtRisk: boolean; costGuardBroken: boolean } {
  // A run still in flight has no conclusion yet. Treating "not success" as
  // "failed" invented an open incident every time a scan caught a live run --
  // and a page that cries wolf about its own CI is no better than one that
  // hides a real fault.
  if (run.status && run.status !== 'completed') {
    return {
      classification: 'in-progress', title: 'Run still in progress',
      meaning: 'This run had not finished when the snapshot was taken, so it has no verdict yet.',
      moneyAtRisk: false, costGuardBroken: false,
    }
  }
  if (run.conclusion === 'success') {
    return {
      classification: 'healthy', title: 'Check ran and passed',
      meaning: 'The spend check ran with real provider telemetry behind it.',
      moneyAtRisk: false, costGuardBroken: false,
    }
  }
  // A failed run that never got a runner has no jobs and no annotations — that
  // is GitHub infrastructure, not a Cost Guard fault, and must not be reported
  // as one.
  if (!run.hasJobs && !run.annotations.length) {
    return {
      classification: 'runner-never-assigned', title: 'GitHub never started the job',
      meaning: 'The run was created but no runner was assigned, so Cost Guard never executed. This is a GitHub Actions infrastructure event.',
      moneyAtRisk: false, costGuardBroken: false,
    }
  }
  const text = run.annotations.join(' \n ')
  for (const rule of RULES) {
    if (rule.test(text)) return { classification: rule.id, ...rule, title: rule.title }
  }
  return {
    classification: 'unclassified', title: 'Unrecognised failure',
    meaning: 'The run failed with a signature no rule matches. This is the case worth handing to Claude.',
    moneyAtRisk: false, costGuardBroken: true,
  }
}

/** Numbers vary run to run; the SHAPE is the incident identity. */
function signatureOf(classification: Classification, annotations: string[]): string {
  const shape = annotations
    .filter(a => !/^Process completed with exit code/i.test(a))
    .map(a => a.replace(/[\d.]+/g, '#'))
    .sort()
    .join(' | ')
  return `${classification}::${shape}`
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const doc: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    source: 'github-actions',
    repo: REPO,
    workflow: WORKFLOW,
    runUrlBase: `https://github.com/${REPO}/actions/runs/`,
  }

  let rawRuns: Array<Record<string, unknown>>
  try {
    rawRuns = gh([
      'run', 'list', '--repo', REPO, '--workflow', WORKFLOW, '--limit', String(RUN_LIMIT),
      '--json', 'databaseId,conclusion,status,event,headBranch,headSha,createdAt,updatedAt,url',
    ]) as Array<Record<string, unknown>>
  } catch (err) {
    doc.available = false
    doc.note = `GitHub run history unavailable: ${(err as Error).message.split('\n')[0]}. Run \`gh auth login\`, then \`npm run costguard:runs\`.`
    doc.runs = []; doc.incidents = []; doc.apiCalls = apiCalls
    mkdirSync(join(process.cwd(), 'launch', 'operations'), { recursive: true })
    writeFileSync(OUT, JSON.stringify(doc, null, 2))
    console.warn(`[costguard-runs] ${doc.note}`)
    return
  }

  const runs: RunRow[] = []
  for (const r of rawRuns) {
    const id = Number(r.databaseId)
    const conclusion = String(r.conclusion ?? '')
    const status = String(r.status ?? '')
    const createdAt = String(r.createdAt)
    const updatedAt = String(r.updatedAt ?? r.createdAt)

    let failedJob: string | null = null
    let failedStep: string | null = null
    let annotations: string[] = []
    let hasJobs = true

    // Only failures need the extra calls — a green run's detail is noise, and
    // every avoided call is headroom under the cap.
    if (status === 'completed' && conclusion !== 'success' && conclusion !== '') {
      try {
        const jobsDoc = gh(['api', `repos/${REPO}/actions/runs/${id}/jobs`]) as {
          jobs?: Array<{ id: number; name: string; conclusion: string; steps?: Array<{ name: string; conclusion: string }> }>
        }
        const jobs = jobsDoc.jobs ?? []
        hasJobs = jobs.length > 0
        const bad = jobs.find(j => j.conclusion === 'failure')
        if (bad) {
          failedJob = bad.name
          failedStep = bad.steps?.find(s => s.conclusion === 'failure')?.name ?? null
          try {
            const anns = gh(['api', `repos/${REPO}/check-runs/${bad.id}/annotations`]) as Array<{ message?: string }>
            annotations = anns.map(a => String(a.message ?? '')).filter(Boolean)
          } catch { /* annotations can expire before logs do */ }
        }
      } catch { hasJobs = false }
    }

    const c = classify({ conclusion, annotations, failedJob, hasJobs, status })
    runs.push({
      id,
      url: String(r.url ?? `https://github.com/${REPO}/actions/runs/${id}`),
      event: String(r.event ?? ''),
      branch: String(r.headBranch ?? ''),
      sha: String(r.headSha ?? '').slice(0, 7),
      createdAt,
      durationSec: Math.max(0, Math.round((Date.parse(updatedAt) - Date.parse(createdAt)) / 1000)) || null,
      conclusion,
      failedJob,
      failedStep,
      annotations,
      classification: c.classification,
      signature: (c.classification === 'healthy' || c.classification === 'in-progress') ? c.classification : signatureOf(c.classification, annotations),
    })
  }

  // ── Group identical repeats into incidents ────────────────────────────────
  // Runs arrive newest-first; walk oldest-first so first/last read naturally.
  const ordered = [...runs].reverse()
  const byId = new Map<string, Incident>()
  for (const run of ordered) {
    if (run.classification === 'healthy' || run.classification === 'in-progress') continue
    const meta = classify({
      conclusion: run.conclusion, annotations: run.annotations,
      failedJob: run.failedJob, hasJobs: true,
    })
    const existing = byId.get(run.signature)
    if (existing) {
      existing.lastSeen = run.createdAt
      existing.count += 1
      existing.runIds.push(run.id)
    } else {
      byId.set(run.signature, {
        signature: run.signature,
        classification: run.classification,
        title: meta.title,
        meaning: meta.meaning,
        moneyAtRisk: meta.moneyAtRisk,
        costGuardBroken: meta.costGuardBroken,
        firstSeen: run.createdAt,
        lastSeen: run.createdAt,
        count: 1,
        state: 'open',
        resolvedAt: null,
        durationHours: 0,
        runIds: [run.id],
        sampleAnnotations: run.annotations.slice(0, 4),
      })
    }
  }

  // An incident is provisionally resolved once a later run succeeded after its
  // last sighting — but a green run is NOT proof the condition cleared. A
  // provider blackout keeps the run green (AMBER exits 0) while the provider
  // stays blind, so cross-check the live provider state before calling any
  // blackout resolved. Marking an ongoing blind spot "recovered" would be the
  // same false all-clear the guard exists to prevent.
  const stillStale = readStaleProviders()
  const successesDesc = runs.filter(r => r.conclusion === 'success')
  for (const inc of byId.values()) {
    const recovery = [...successesDesc]
      .reverse()
      .find(s => Date.parse(s.createdAt) > Date.parse(inc.lastSeen))
    if (recovery) {
      inc.state = 'resolved'
      inc.resolvedAt = recovery.createdAt
    }
    if (inc.classification === 'provider-stale' && stillStale.length) {
      const text = inc.sampleAnnotations.join(' ').toLowerCase()
      if (stillStale.some(p => text.includes(p))) {
        inc.state = 'open'
        inc.resolvedAt = null
        inc.stillFailing = stillStale.filter(p => text.includes(p))
      }
    }
    const end = inc.resolvedAt ?? new Date().toISOString()
    inc.durationHours = Number(((Date.parse(end) - Date.parse(inc.firstSeen)) / 3_600_000).toFixed(1))
  }

  const incidents = [...byId.values()].sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))

  doc.available = true
  doc.runs = runs
  doc.incidents = incidents
  doc.latest = runs[0] ?? null
  doc.counts = {
    runs: runs.length,
    failures: runs.filter(r => r.classification !== 'healthy' && r.classification !== 'in-progress').length,
    openIncidents: incidents.filter(i => i.state === 'open').length,
    windowFrom: ordered[0]?.createdAt ?? null,
    windowTo: runs[0]?.createdAt ?? null,
  }
  doc.apiCalls = apiCalls

  mkdirSync(join(process.cwd(), 'launch', 'operations'), { recursive: true })
  writeFileSync(OUT, JSON.stringify(doc, null, 2))
  console.log(`[costguard-runs] ${runs.length} runs · ${incidents.length} incident group(s) · ${apiCalls} API calls → ${OUT}`)
  for (const i of incidents.slice(0, 5)) {
    console.log(`  - [${i.state}] ${i.title} ×${i.count} (${i.firstSeen.slice(0, 16)} → ${i.lastSeen.slice(0, 16)})`)
  }
}

main().catch(err => { console.error('[costguard-runs] failed:', err); process.exitCode = 1 })
