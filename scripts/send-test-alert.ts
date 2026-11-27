/**
 * send-test-alert.ts — send ONE clearly-labelled test alert through the real
 * production notifier (lib/alerts/notify.ts).
 *
 * WHY THIS EXISTS
 * ───────────────
 * raiseAlert() has exactly two callers in the codebase: offer-refresh and
 * offer-health-check. Both are Inngest functions, and as of 2026-11-27 neither
 * is registered in Inngest Cloud, so nothing in production can send an alert at
 * all. Setting SLACK_WEBHOOK_URL therefore proves nothing on its own — the
 * webhook and the caller are two separate failures, and this separates them.
 *
 * It exercises the genuine notifier: the same raiseAlert(), the same
 * formatAlert(), the same Slack block payload production would send. The only
 * difference is which machine makes the HTTPS POST. Proof that the notifier
 * runs inside Vercel's runtime arrives with the first offer-health-check run
 * after the Inngest app is re-synced — this cannot substitute for that.
 *
 * Refuses to run without a webhook rather than no-oping, so it can never
 * report success for an alert that was only written to the console.
 * Never prints the webhook, only whether one is configured.
 *
 * Run: npm run alerts:test
 */

import { raiseAlert, formatAlert } from '@/lib/alerts/notify'

async function main() {
  if (!process.env.SLACK_WEBHOOK_URL) {
    console.error('SLACK_WEBHOOK_URL is not set in this environment.')
    console.error('')
    console.error('Nothing was sent. Set it where you are running this:')
    console.error('  - in Vercel, for the deployed notifier (needs a redeploy to take effect)')
    console.error('  - in .env.local, to exercise the notifier from here')
    process.exit(1)
  }

  const stamp = new Date().toISOString()
  const alert = {
    key:      'notifier-test',
    severity: 'warning' as const,
    title:    'TEST ALERT — notifier reachability check',
    details: [
      'This is a deliberate test. No production problem is being reported.',
      `sent ${stamp}`,
      'sent via scripts/send-test-alert.ts (npm run alerts:test)',
    ],
    action: 'No action needed. If you can read this in Slack, the notifier and webhook both work.',
  }

  console.log('Sending this payload:\n')
  console.log(formatAlert(alert))
  console.log('')

  const result = await raiseAlert(alert)

  console.log('result:')
  console.log(`  logged to console : ${result.loggedToConsole}`)
  console.log(`  slack configured  : ${result.slackConfigured}`)
  console.log(`  slack delivered   : ${result.slackDelivered}`)
  if (result.slackError) console.log(`  slack error       : ${result.slackError}`)

  if (!result.slackDelivered) {
    console.error('\nNOT DELIVERED — the webhook is set but Slack did not accept the post.')
    process.exit(1)
  }
  console.log('\nDelivered. Check the Slack channel for one message titled "TEST ALERT".')
}

main().catch(e => { console.error(e); process.exit(1) })
