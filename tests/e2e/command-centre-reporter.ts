/**
 * command-centre-reporter.ts — writes launch/operations/browser-trust-latest.json
 *
 * Follows the same contract as launch-smoke-latest.json / launch-health-latest.json:
 * a small, honest, machine-readable snapshot that Mission Control renders. The
 * rules that matter:
 *
 *   • It records what actually ran. A run that tested nothing is NOT a pass.
 *   • It always carries its own timestamp so the Command Centre can age it out.
 *   • Error text is sanitised before it is written. Nothing in this suite
 *     handles secrets, but a stack trace can still quote an environment value,
 *     so redaction happens on the way out rather than being assumed unnecessary.
 *
 * Tallies are computed in onEnd by walking the suite, not accumulated per
 * attempt: with retries enabled in CI, onTestEnd fires once per attempt and
 * counting there would report a retried test twice.
 */

import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { resolveTarget } from './target'

const OUTPUT_PATH = join('launch', 'operations', 'browser-trust-latest.json')
const REPORT_PATH = 'launch/operations/browser-trust-report/index.html'

interface ProjectTally { passed: number; failed: number; skipped: number; flaky: number }
interface Failure {
  test:    string
  project: string
  file:    string
  error:   string
  pageUrl: string | null
}

/** Patterns that must never reach a committed JSON file, a report or a trace. */
const REDACTIONS: { re: RegExp; to: string }[] = [
  { re: /postgres(?:ql)?:\/\/[^\s"']+/gi,                      to: '[redacted-database-url]' },
  { re: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g,             to: '[redacted-jwt]' },
  { re: /\bBearer\s+[\w.\-~+/]{12,}=*/gi,                      to: 'Bearer [redacted]' },
  { re: /\b(?:sk|pk|ghp|gho|ghs|github_pat|npm|vercel|neon|rk)_[A-Za-z0-9_-]{16,}\b/gi, to: '[redacted-token]' },
  // key=value / key: value forms — keep the key name, drop the value.
  {
    re: /\b(api[_-]?key|apikey|token|secret|password|passwd|pwd|authorization|cookie|connection[_-]?string)\b(\s*[:=]\s*)["']?[^\s"',;)]{6,}/gi,
    to: '$1$2[redacted]',
  },
]

function sanitise(raw: string): string {
  // Strip ANSI colour codes Playwright puts in error messages.
  let s = raw.replace(/\[[0-9;]*m/g, '')
  for (const r of REDACTIONS) s = s.replace(r.re, r.to)
  // Bounded: a JSON file the Command Centre renders must stay readable.
  return s.length > 1200 ? `${s.slice(0, 1200)}\n… (truncated)` : s
}

function git(args: string[]): string | null {
  try {
    const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return out || null
  } catch {
    return null
  }
}

function gitSha(): string | null {
  return process.env.GITHUB_SHA || git(['rev-parse', 'HEAD'])
}

function gitBranch(): string | null {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  return b === 'HEAD' ? null : b
}

function playwrightVersion(): string {
  try {
    return createRequire(__filename)('@playwright/test/package.json').version as string
  } catch {
    return 'unknown'
  }
}

export default class CommandCentreReporter implements Reporter {
  private rootDir = process.cwd()
  private startedAt = Date.now()
  private suite: Suite | null = null
  private projectNames: string[] = []

  onBegin(config: FullConfig, suite: Suite): void {
    // NOT config.rootDir — Playwright sets that to the common ancestor of the
    // test directories (here: tests/e2e), which would bury the Command Centre
    // JSON at tests/e2e/launch/operations/. The repo root is the config's own
    // directory.
    this.rootDir = config.configFile ? dirname(config.configFile) : process.cwd()
    this.startedAt = Date.now()
    this.suite = suite
    this.projectNames = config.projects.map(p => p.name)
  }

  onEnd(result: FullResult): void {
    const projects: Record<string, ProjectTally> = {}
    for (const name of this.projectNames) projects[name] = { passed: 0, failed: 0, skipped: 0, flaky: 0 }

    const failures: Failure[] = []
    const tests: TestCase[] = this.suite ? this.suite.allTests() : []

    for (const test of tests) {
      const project = test.parent.project()?.name ?? 'unknown'
      const tally = (projects[project] ||= { passed: 0, failed: 0, skipped: 0, flaky: 0 })

      switch (test.outcome()) {
        case 'expected':   tally.passed  += 1; break
        case 'flaky':      tally.flaky   += 1; break
        case 'skipped':    tally.skipped += 1; break
        case 'unexpected': tally.failed  += 1; break
      }

      if (test.outcome() !== 'unexpected') continue

      const last = test.results[test.results.length - 1]
      const pageUrl = last?.attachments.find(a => a.name === 'page-url')?.body?.toString('utf8') ?? null
      failures.push({
        test:    test.titlePath().filter(Boolean).slice(1).join(' › '),
        project,
        file:    relative(this.rootDir, test.location.file).replace(/\\/g, '/'),
        error:   sanitise(last?.error?.message ?? last?.status ?? 'unknown failure'),
        pageUrl: pageUrl ? sanitise(pageUrl) : null,
      })
    }

    let target: { mode: string; baseURL: string; host: string }
    try {
      target = resolveTarget()
    } catch {
      target = { mode: 'unknown', baseURL: 'unknown', host: 'unknown' }
    }

    const sum = (k: keyof ProjectTally) => Object.values(projects).reduce((a, p) => a + p[k], 0)
    const passed = sum('passed'), failed = sum('failed'), skipped = sum('skipped'), flaky = sum('flaky')
    const ran = passed + failed + flaky

    // An interrupted run, or a run where nothing executed, is not a pass.
    // Silence is never evidence that the site is healthy.
    const verdict =
      failed > 0 || result.status === 'failed' || result.status === 'timedout' ? 'FAIL'
      : result.status === 'interrupted'                                        ? 'INCOMPLETE'
      : ran === 0                                                              ? 'NOT RUN'
      : flaky > 0                                                              ? 'PASS-WITH-FLAKES'
      : 'PASS'

    const out = {
      version: 1,
      tool: 'playwright',
      toolVersion: playwrightVersion(),
      environment: target.mode,               // local | preview | production
      url: target.baseURL,
      host: target.host,
      runAt: new Date().toISOString(),
      durationMs: Date.now() - this.startedAt,
      commitSha: gitSha(),
      branch: gitBranch(),
      ci: !!process.env.CI,
      runUrl: process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
        ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
      verdict,
      declared: tests.length,
      passed, failed, skipped, flaky,
      projects,
      reportPath: REPORT_PATH,
      failures,
    }

    const dest = join(this.rootDir, OUTPUT_PATH)
    try {
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`)
      console.log(`\nBrowser Trust: ${verdict} — ${passed} passed · ${failed} failed · ${skipped} skipped · ${flaky} flaky`)
      console.log(`Recorded → ${OUTPUT_PATH.replace(/\\/g, '/')}`)
    } catch (e) {
      console.error(`Browser Trust: could not write ${OUTPUT_PATH}:`, e)
    }
  }
}
