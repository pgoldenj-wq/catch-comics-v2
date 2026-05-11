/**
 * Inngest client singleton.
 *
 * Import `inngest` from here everywhere — do not create multiple instances.
 *
 * Dev setup:
 *   Run `npx @inngest/cli@latest dev -u http://localhost:3000/api/inngest`
 *   alongside `npm run dev` to get the Inngest Dev Server at http://localhost:8288
 *
 * Env vars (production):
 *   INNGEST_EVENT_KEY   — from Inngest dashboard → App → Event Keys
 *   INNGEST_SIGNING_KEY — from Inngest dashboard → App → Signing Key
 */

import { Inngest } from 'inngest'

export const inngest = new Inngest({
  id:   'catch-comics',
  name: 'Catch Comics',
})
