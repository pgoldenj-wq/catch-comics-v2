/**
 * /admin/jobs — Background jobs dashboard.
 *
 * Shows two tables:
 *   1. Recent sync_logs — one row per retailer sync run (Shopify adapter etc.)
 *   2. Recent job_runs  — enrich, cleanup, price-check runs
 *
 * Both ordered newest-first. Limited to last 50 rows each.
 * Failures are highlighted in red; running jobs pulse.
 *
 * A "Trigger" panel lets you dispatch any job manually via the Inngest API.
 */

import { prisma }  from '@/lib/prisma'
import Link        from 'next/link'

export const dynamic = 'force-dynamic'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: Date | string | null): string {
  if (!d) return '—'
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

function fmtDuration(started: Date | string | null, finished: Date | string | null): string {
  if (!started || !finished) return '—'
  const ms = new Date(finished).getTime() - new Date(started).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function fmtRelative(d: Date | string | null): string {
  if (!d) return '—'
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 60_000)    return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000)return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function statusBadge(status: string) {
  const cls =
    status === 'success' ? 'bg-green-100 text-green-800' :
    status === 'error'   ? 'bg-red-100   text-red-800'   :
    status === 'running' ? 'bg-blue-100  text-blue-800 animate-pulse' :
                           'bg-gray-100  text-gray-700'
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {status}
    </span>
  )
}

// ── Job card — summary per job name ──────────────────────────────────────────

interface JobCard {
  jobName:    string
  label:      string
  schedule:   string
  lastRunAt:  Date | string | null
  lastStatus: string | null
}

const JOB_META: Record<string, { label: string; schedule: string }> = {
  'enrich.canonical_products':    { label: 'Enrich canonical products', schedule: 'Daily 02:00 UTC' },
  'cleanup.stale_listings':       { label: 'Cleanup stale listings',    schedule: 'Daily 03:00 UTC' },
  'price_check.canonical_products':{ label: 'Price check popular titles', schedule: 'Every 4 hours' },
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function JobsPage() {
  // Recent sync logs (retailer syncs)
  const syncLogs = await prisma.syncLog.findMany({
    orderBy: { startedAt: 'desc' },
    take:    50,
    include: { retailer: { select: { name: true, domain: true } } },
  })

  // Recent job runs (enrich, cleanup, price-check)
  const jobRuns = await prisma.jobRun.findMany({
    orderBy: { startedAt: 'desc' },
    take:    50,
  })

  // Summary card per job name
  const jobCards: JobCard[] = Object.entries(JOB_META).map(([jobName, meta]) => {
    const latest = jobRuns.find(r => r.jobName === jobName)
    return {
      jobName,
      label:      meta.label,
      schedule:   meta.schedule,
      lastRunAt:  latest?.startedAt ?? null,
      lastStatus: latest?.status    ?? null,
    }
  })

  // Scheduled sync summary
  const scheduledSyncCard = {
    label:     'Scheduled retailer syncs',
    schedule:  'Every hour',
    lastRunAt: syncLogs[0]?.startedAt ?? null,
    lastStatus:syncLogs[0]?.status    ?? null,
  }

  // 24h failure count (sync logs)
  const since24h     = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const syncFailures = syncLogs.filter(l => l.status === 'error' && new Date(l.startedAt) > since24h).length
  const jobFailures  = jobRuns.filter(r => r.status === 'error' && new Date(r.startedAt) > since24h).length

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Background Jobs</h1>
          {(syncFailures + jobFailures) > 0 && (
            <p className="text-xs text-red-600 mt-0.5">
              ⚠ {syncFailures + jobFailures} failure(s) in the last 24 hours
            </p>
          )}
        </div>
        <a
          href="https://app.inngest.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline"
        >
          Inngest dashboard ↗
        </a>
      </div>

      {/* ── Job overview cards ──────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Job Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Scheduled sync card */}
          <div className="bg-white border border-gray-200 rounded p-4">
            <p className="font-semibold text-gray-900 text-xs">{scheduledSyncCard.label}</p>
            <p className="text-gray-400 text-xs mt-0.5">{scheduledSyncCard.schedule}</p>
            <div className="mt-3 flex items-center gap-2">
              {scheduledSyncCard.lastStatus ? statusBadge(scheduledSyncCard.lastStatus) : <span className="text-xs text-gray-400">never run</span>}
              <span className="text-xs text-gray-500">{fmtRelative(scheduledSyncCard.lastRunAt)}</span>
            </div>
          </div>

          {jobCards.map(card => (
            <div key={card.jobName} className="bg-white border border-gray-200 rounded p-4">
              <p className="font-semibold text-gray-900 text-xs">{card.label}</p>
              <p className="text-gray-400 text-xs mt-0.5">{card.schedule}</p>
              <div className="mt-3 flex items-center gap-2">
                {card.lastStatus ? statusBadge(card.lastStatus) : <span className="text-xs text-gray-400">never run</span>}
                <span className="text-xs text-gray-500">{fmtRelative(card.lastRunAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Sync logs ───────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          Retailer Sync Logs
          <span className="ml-2 font-normal text-gray-400">({syncLogs.length} recent)</span>
        </h2>
        <div className="bg-white border border-gray-200 rounded overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-500">Retailer</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500">Started</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500">Duration</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500">Products</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500">Created</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500">Updated</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500">Prices</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500">Errors</th>
              </tr>
            </thead>
            <tbody>
              {syncLogs.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-gray-400">
                    No sync runs yet.
                  </td>
                </tr>
              )}
              {syncLogs.map(log => (
                <tr
                  key={log.id}
                  className={`border-t border-gray-100 hover:bg-gray-50 ${log.status === 'error' ? 'bg-red-50' : ''}`}
                >
                  <td className="px-3 py-2">
                    <Link href={`/admin/retailers/${log.retailerId}`} className="text-blue-600 hover:underline">
                      {log.retailer.name}
                    </Link>
                    <div className="text-gray-400">{log.retailer.domain}</div>
                  </td>
                  <td className="px-3 py-2">{statusBadge(log.status)}</td>
                  <td className="px-3 py-2 text-right text-gray-500" title={fmtDate(log.startedAt)}>
                    {fmtRelative(log.startedAt)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtDuration(log.startedAt, log.finishedAt)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{log.productsFetched.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-green-700">{log.listingsCreated.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{log.listingsUpdated.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-blue-600">{log.priceChanges.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {log.errorCount > 0
                      ? <span className="text-red-700 font-semibold">{log.errorCount}</span>
                      : <span className="text-gray-400">0</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Error details for failed syncs */}
        {syncLogs.filter(l => l.errorSummary).slice(0, 3).map(log => (
          <details key={`err-${log.id}`} className="mt-2">
            <summary className="cursor-pointer text-xs text-red-600 hover:text-red-800">
              {log.retailer.name} — error details ({fmtRelative(log.startedAt)})
            </summary>
            <pre className="mt-1 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-800 whitespace-pre-wrap break-all">
              {log.errorSummary}
            </pre>
          </details>
        ))}
      </section>

      {/* ── Job runs (enrich / cleanup / price-check) ────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          Background Job Runs
          <span className="ml-2 font-normal text-gray-400">({jobRuns.length} recent)</span>
        </h2>
        <div className="bg-white border border-gray-200 rounded overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-500">Job</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500">Started</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500">Duration</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500">Items</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500">Details</th>
              </tr>
            </thead>
            <tbody>
              {jobRuns.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                    No background job runs yet.
                  </td>
                </tr>
              )}
              {jobRuns.map(run => {
                const meta = JOB_META[run.jobName]
                const metaJson = run.metadata as Record<string, unknown>
                return (
                  <tr
                    key={run.id}
                    className={`border-t border-gray-100 hover:bg-gray-50 ${run.status === 'error' ? 'bg-red-50' : ''}`}
                  >
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {meta?.label ?? run.jobName}
                    </td>
                    <td className="px-3 py-2">{statusBadge(run.status)}</td>
                    <td className="px-3 py-2 text-right text-gray-500" title={fmtDate(run.startedAt)}>
                      {fmtRelative(run.startedAt)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fmtDuration(run.startedAt, run.finishedAt)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{run.itemsProcessed.toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {Object.entries(metaJson).length > 0
                        ? Object.entries(metaJson)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ')
                        : '—'}
                      {run.errorSummary && (
                        <span className="text-red-600 ml-2">{run.errorSummary}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Setup instructions ───────────────────────────────────────────────── */}
      <section className="bg-gray-50 border border-gray-200 rounded p-4 text-xs text-gray-600 space-y-2">
        <p className="font-semibold text-gray-800">Inngest setup</p>
        <p>
          <span className="font-medium">Local dev:</span>{' '}
          Run <code className="bg-gray-200 px-1 rounded">npx @inngest/cli@latest dev -u http://localhost:3000/api/inngest</code>{' '}
          alongside <code className="bg-gray-200 px-1 rounded">npm run dev</code>.
          Dashboard at{' '}
          <a href="http://localhost:8288" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            localhost:8288
          </a>.
        </p>
        <p>
          <span className="font-medium">Production:</span>{' '}
          Set <code className="bg-gray-200 px-1 rounded">INNGEST_EVENT_KEY</code> and{' '}
          <code className="bg-gray-200 px-1 rounded">INNGEST_SIGNING_KEY</code> in Vercel env vars,
          then register <code className="bg-gray-200 px-1 rounded">/api/inngest</code> in the{' '}
          <a href="https://app.inngest.com" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            Inngest dashboard
          </a>.
        </p>
        <p>
          <span className="font-medium">Slack alerts:</span>{' '}
          Set <code className="bg-gray-200 px-1 rounded">SLACK_WEBHOOK_URL</code> for failure notifications.
        </p>
      </section>
    </div>
  )
}
