/**
 * POST /api/monitor/retailers — the price-freshness watchdog that does NOT
 * live inside Inngest.
 *
 * WHY IT IS HERE AND NOT AN INNGEST FUNCTION
 * ──────────────────────────────────────────
 * offer-health-check already watches coverage, but it runs inside Inngest, so
 * it cannot report that Inngest is not running. That is precisely the failure
 * that went unnoticed from 2026-08-09, and again from 2026-09-26 when a
 * 30-day sweep took every price while nothing complained.
 *
 * This endpoint is called on a schedule by .github/workflows/retailer-monitor
 * on GitHub's infrastructure. If Inngest is dead, this still runs and says so.
 *
 * Auth: bearer COSTGUARD_CRON_SECRET — the same shared secret the Cost Guard
 * collector already uses, deliberately reused so this needs no new credential
 * in either GitHub or Vercel. 503 when it is missing, so an unconfigured
 * deployment is loud rather than silently unwatched.
 *
 * Notifications fire ONLY on a transition. A still-open incident is not news,
 * and routine runs must be silent or the channel gets ignored.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { raiseAlert } from '@/lib/alerts/notify'
import {
  evaluateRetailerHealth, detectIncidents,
  MONITOR_JOB, SCHEDULER_JOB, OVERDUE_GRACE_HOURS,
  type Incident, type RetailerHealth,
} from '@/lib/monitoring/retailer-health'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const secret = process.env.COSTGUARD_CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'COSTGUARD_CRON_SECRET not configured' }, { status: 503 },
    )
  }
  if ((req.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?simulate=<domain> forces one retailer to look overdue, in memory only, to
  // prove the alert path end to end. It never touches prices and never
  // persists incident state, so a drill cannot mask or invent a real incident.
  const simulate = req.nextUrl.searchParams.get('simulate')

  try {
    const now = new Date()
    const health = await evaluateRetailerHealth(prisma, now)

    const [tick, previous] = await Promise.all([
      prisma.jobRun.findFirst({
        where: { jobName: SCHEDULER_JOB },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      }),
      prisma.jobRun.findFirst({
        where: { jobName: MONITOR_JOB },
        orderBy: { startedAt: 'desc' },
        select: { metadata: true },
      }),
    ])

    const prevMeta = (previous?.metadata ?? {}) as { openKeys?: unknown; totalPriced?: unknown }
    const previouslyOpen: string[] = Array.isArray(prevMeta.openKeys)
      ? prevMeta.openKeys.filter((k): k is string => typeof k === 'string') : []
    const previousPriced = typeof prevMeta.totalPriced === 'number' ? prevMeta.totalPriced : null

    const effective: RetailerHealth[] = simulate
      ? health.map(h => h.domain === simulate
          ? { ...h, state: 'STALE' as const, fault: true,
              nextDue: new Date(now.getTime() - (OVERDUE_GRACE_HOURS + 12) * 3_600_000) }
          : h)
      : health

    const incidents = detectIncidents(effective, {
      lastSchedulerTick: tick?.startedAt ?? null,
      previousPriced,
    }, now)

    const openKeys  = incidents.map(i => i.key)
    const opened    = incidents.filter(i => !previouslyOpen.includes(i.key))
    const recovered = previouslyOpen.filter(k => !openKeys.includes(k))

    // One message when it opens, one when it recovers. Nothing in between.
    const delivered: Array<{ key: string; slack: boolean; error?: string }> = []
    for (const inc of opened) {
      const r = await raiseAlert({
        key: inc.key, severity: inc.severity,
        title: simulate ? `[DRILL] ${inc.title}` : inc.title,
        details: simulate ? ['THIS IS A TEST — no real incident.', ...inc.details] : inc.details,
        action: inc.action,
      })
      delivered.push({ key: inc.key, slack: r.slackDelivered, error: r.slackError })
    }
    for (const key of recovered) {
      const r = await raiseAlert({
        key: `${key}:recovered`, severity: 'warning',
        title: `Recovered — ${key}`,
        details: ['This source is refreshing normally again.', `cleared ${now.toISOString()}`],
        action: 'No action needed.',
      })
      delivered.push({ key: `${key}:recovered`, slack: r.slackDelivered, error: r.slackError })
    }

    const totalPriced = health.reduce((s, h) => s + h.priced, 0)

    // A drill must leave no trace in the state the real monitor reads.
    if (!simulate) {
      await prisma.jobRun.create({
        data: {
          jobName:        MONITOR_JOB,
          status:         'success',
          finishedAt:     new Date(),
          itemsProcessed: health.length,
          metadata: {
            openKeys, totalPriced,
            opened:    opened.map(i => i.key),
            recovered,
          } as Prisma.InputJsonObject,
        },
      })
    }

    return NextResponse.json({
      ok: true,
      simulated: simulate ?? null,
      checkedAt: now.toISOString(),
      totalPriced,
      retailers: health.length,
      faults: health.filter(h => h.fault).map(h => h.domain),
      openIncidents: incidents.map(i => ({ key: i.key, severity: i.severity, title: i.title, details: i.details, action: i.action })),
      opened:    opened.map(i => i.key),
      recovered,
      delivered,
      slackConfigured: Boolean(process.env.SLACK_WEBHOOK_URL),
    })
  } catch (err) {
    // A monitor that 200s after failing is worse than one that is down.
    console.error('[monitor/retailers] failed', err)
    return NextResponse.json(
      { ok: false, error: (err as Error).message }, { status: 500 },
    )
  }
}
