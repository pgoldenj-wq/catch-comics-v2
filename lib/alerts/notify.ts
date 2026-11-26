/**
 * notify.ts — one place to raise an operational alert.
 *
 * Follows the convention lib/inngest/functions/on-failure.ts already
 * established: always console.error (Vercel captures it), and additionally
 * post to Slack when SLACK_WEBHOOK_URL is configured.
 *
 * on-failure covers "a job threw and exhausted its retries". It cannot cover a
 * job that never ran, coverage that quietly fell to zero, or offers drifting
 * towards the 30-day expiry — those are silent failures, and they are what
 * blocker B4 actually was. Those alarms call this.
 *
 * A missing webhook is NOT an error: the alert still reaches the logs, and the
 * caller is told whether it was delivered so a report can be honest about it.
 */

export type AlertSeverity = 'critical' | 'warning'

export interface Alert {
  /** Short stable identifier, e.g. "offer-refresh-stalled". */
  key: string
  severity: AlertSeverity
  title: string
  /** One line per fact. Keep them short and quantitative. */
  details: string[]
  /** What the reader should do about it. */
  action?: string
}

export interface AlertResult {
  raised: boolean
  loggedToConsole: boolean
  slackConfigured: boolean
  slackDelivered: boolean
  slackError?: string
}

const ICON: Record<AlertSeverity, string> = { critical: '🚨', warning: '⚠️' }

export function formatAlert(a: Alert): string {
  return [
    `${ICON[a.severity]} Catch Comics — ${a.title}`,
    ...a.details.map(d => `  • ${d}`),
    ...(a.action ? [`  → ${a.action}`] : []),
  ].join('\n')
}

/**
 * Raise an alert. Never throws: an alerting failure must not fail the job that
 * noticed the problem, or the problem disappears along with the alert.
 */
export async function raiseAlert(a: Alert): Promise<AlertResult> {
  const summary = formatAlert(a)
  const result: AlertResult = {
    raised: true,
    loggedToConsole: false,
    slackConfigured: Boolean(process.env.SLACK_WEBHOOK_URL),
    slackDelivered: false,
  }

  // ── 1. Always log ─────────────────────────────────────────────────────────
  try {
    console.error(`[alert:${a.key}] ${summary}`)
    result.loggedToConsole = true
  } catch { /* logging must never be the thing that breaks */ }

  // ── 2. Slack, when configured ─────────────────────────────────────────────
  const webhook = process.env.SLACK_WEBHOOK_URL
  if (!webhook) return result

  try {
    const res = await fetch(webhook, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        text: summary,
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              `*${ICON[a.severity]} Catch Comics — ${a.title}*`,
              ...a.details.map(d => `• ${d}`),
              ...(a.action ? [`_${a.action}_`] : []),
            ].join('\n'),
          },
        }],
      }),
    })
    result.slackDelivered = res.ok
    if (!res.ok) result.slackError = `Slack responded ${res.status}`
  } catch (err) {
    result.slackError = (err as Error).message
  }

  return result
}
