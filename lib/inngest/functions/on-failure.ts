/**
 * on-failure — global failure handler for all Inngest jobs.
 *
 * Fires when any function exhausts all its retries (Inngest emits the
 * `inngest/function.failed` event automatically in that case).
 *
 * Actions:
 *   1. console.error — always (Vercel captures these in logs)
 *   2. Slack notification — if SLACK_WEBHOOK_URL env var is set
 *
 * Env vars:
 *   SLACK_WEBHOOK_URL  — incoming webhook URL (optional). Get one at:
 *     https://api.slack.com/apps → Incoming Webhooks
 */

import { inngest } from '@/lib/inngest/client'

interface FunctionFailedData {
  function_id: string
  run_id:      string
  error: {
    name:    string
    message: string
    stack?:  string
  }
  event: {
    name: string
    data: unknown
  }
}

export const onFailure = inngest.createFunction(
  {
    id:       'alert-on-job-failure',
    name:     'Alert on Job Failure',
    triggers: [{ event: 'inngest/function.failed' }],
  },
  async ({ event }) => {
    const data = event.data as FunctionFailedData

    const summary = [
      `🚨 Catch Comics job failed: ${data.function_id}`,
      `Run ID: ${data.run_id}`,
      `Error: ${data.error.name}: ${data.error.message}`,
      `Triggered by event: ${data.event.name}`,
    ].join('\n')

    // ── 1. Always log ────────────────────────────────────────────────────────
    console.error('[on-failure] Inngest job exhausted all retries:\n' + summary)
    if (data.error.stack) {
      console.error('[on-failure] stack:\n', data.error.stack)
    }

    // ── 2. Slack notification ────────────────────────────────────────────────
    const slackWebhook = process.env.SLACK_WEBHOOK_URL
    if (slackWebhook) {
      try {
        const payload = {
          text: summary,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: [
                  `*🚨 Catch Comics — Job Failure*`,
                  `*Function:* \`${data.function_id}\``,
                  `*Run ID:* \`${data.run_id}\``,
                  `*Error:* ${data.error.name}: ${data.error.message}`,
                  `*Triggered by:* \`${data.event.name}\``,
                ].join('\n'),
              },
            },
          ],
        }

        const res = await fetch(slackWebhook, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
          signal:  AbortSignal.timeout(5_000),
        })

        if (!res.ok) {
          console.warn(`[on-failure] Slack notification failed: HTTP ${res.status}`)
        }
      } catch (err) {
        console.warn('[on-failure] Slack notification threw:', err instanceof Error ? err.message : err)
      }
    }
  },
)
