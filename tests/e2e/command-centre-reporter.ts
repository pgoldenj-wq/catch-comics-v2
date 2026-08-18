/**
 * command-centre-reporter.ts — writes launch/operations/browser-trust-latest.json
 *
 * Follows the same contract as launch-smoke-latest.json / launch-health-latest.json:
 * a small, honest, machine-readable snapshot that Mission Control renders. The
 * rules that matter:
 *
 *   • It records what actually ran. A run that tested nothing is NOT a pass.
 *   • A run that never started a browser is NOT a product failure either. That
 *     is BLOCKED, and it is kept strictly apart from FAIL — see
 *     browser-trust-result.mjs for the three-state model.
 *   • It always carries its own timestamp so the Command Centre can age it out.
 *   • Error text is sanitised before it is written. Nothing in this suite
 *     handles secrets, but a stack trace can still quote an environment value,
 *     so redaction happens on the way out rather than being assumed unnecessary.
 *
 * Tallies are computed in onEnd by walking the suite, not accumulated per
 * attempt: with retries enabled in CI, onTestEnd fires once per attempt and
 * counting there would report a retried test twice.
 */

import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError } from '@playwright/test/reporter'
import { dirname, relative } from 'node:path'
import {
  REPORT_PATH,
  VERDICT,
  classifyInfrastructure,
  gitBranch,
  gitSha,
  isInfrastructureFailure,
  playwrightVersion,
  resultPath,
  sanitise,
  writeResult,
} from './browser-trust-result.mjs'
import { resolveTarget } from './target'

interface ProjectTally { passed: number; failed: number; skipped: number; flaky: number; blocked: number }
interface Failure {
  test:    string
  project: string
  file:    string
  error:   string
  pageUrl: string | null
}

export default class CommandCentreReporter implements Reporter {
  private rootDir = process.cwd()
  private startedAt = Date.now()
  private suite: Suite | null = null
  private projectNames: string[] = []
  /** Errors Playwright raises outside any test: webServer, globalSetup, config. */
  private globalErrors: string[] = []

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

  /**
   * A dev server that never came up, or a globalSetup that threw, produces no
   * failing test at all — just this. Capturing it is what lets an environment
   * failure be reported as BLOCKED instead of vanishing into "NOT RUN".
   */
  onError(error: TestError): void {
    this.globalErrors.push(sanitise(error.message ?? error.stack ?? String(error)))
  }

  onEnd(result: FullResult): void {
    const projects: Record<string, ProjectTally> = {}
    const tallyFor = (name: string) =>
      (projects[name] ||= { passed: 0, failed: 0, skipped: 0, flaky: 0, blocked: 0 })
    for (const name of this.projectNames) tallyFor(name)

    const tests: TestCase[] = this.suite ? this.suite.allTests() : []
    const unexpected: Failure[] = []

    for (const test of tests) {
      const project = test.parent.project()?.name ?? 'unknown'
      const tally = tallyFor(project)

      switch (test.outcome()) {
        case 'expected':   tally.passed  += 1; break
        case 'flaky':      tally.flaky   += 1; break
        case 'skipped':    tally.skipped += 1; break
        case 'unexpected': /* tallied below, once we know what kind it was */ break
      }

      if (test.outcome() !== 'unexpected') continue

      const last = test.results[test.results.length - 1]
      const pageUrl = last?.attachments.find(a => a.name === 'page-url')?.body?.toString('utf8') ?? null
      unexpected.push({
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

    const passedSoFar = Object.values(projects).reduce((a, p) => a + p.passed, 0)

    // Was this a run, or an environment that never let one happen? A single
    // genuine product failure settles it: an assertion cannot fail unless a
    // browser ran, so classifyInfrastructure returns null and this is a FAIL.
    const blocked = classifyInfrastructure({
      passed: passedSoFar,
      failures: unexpected,
      globalErrors: this.globalErrors,
    })

    // Infrastructure casualties are never written as product failures.
    const failures: Failure[] = []
    for (const f of unexpected) {
      if (blocked && isInfrastructureFailure(f.error)) tallyFor(f.project).blocked += 1
      else { tallyFor(f.project).failed += 1; failures.push(f) }
    }

    const sum = (k: keyof ProjectTally) => Object.values(projects).reduce((a, p) => a + p[k], 0)
    const passed = sum('passed'), failed = sum('failed'), skipped = sum('skipped'), flaky = sum('flaky')
    const ran = passed + failed + flaky

    // Precedence. BLOCKED comes first because everything below it is a claim
    // about Catch Comics, and a run that never reached Catch Comics may not
    // make one — in either direction.
    const verdict =
      blocked                                                                  ? VERDICT.BLOCKED
      : failed > 0 || result.status === 'failed' || result.status === 'timedout' ? VERDICT.FAIL
      : result.status === 'interrupted'                                        ? VERDICT.INCOMPLETE
      : ran === 0                                                              ? VERDICT.NOT_RUN
      : flaky > 0                                                              ? VERDICT.PASS_WITH_FLAKES
      : VERDICT.PASS

    const out = {
      version: 2,
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
      blocked,
    }

    try {
      const dest = writeResult(this.rootDir, out)
      if (blocked) {
        console.log(`\nBrowser Trust: BLOCKED — ${blocked.summary}`)
        console.log(blocked.partial
          ? `${passed} journey(s) ran before the browser became unusable; ${blocked.testsAffected} could not start.`
          : `${blocked.testsAffected} test(s) could not start a browser. No product verdict recorded.`)
        console.log(`Retry with: ${blocked.remedy}`)
      } else {
        console.log(`\nBrowser Trust: ${verdict} — ${passed} passed · ${failed} failed · ${skipped} skipped · ${flaky} flaky`)
      }
      console.log(`Recorded → ${relative(this.rootDir, dest).replace(/\\/g, '/')}`)
    } catch (e) {
      console.error(`Browser Trust: could not write ${relative(this.rootDir, resultPath(this.rootDir))}:`, e)
    }
  }
}
