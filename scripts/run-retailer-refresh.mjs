#!/usr/bin/env node
/**
 * run-retailer-refresh.mjs — fixed-argv launcher for the bounded retailer
 * price refresh, so the Command Centre bridge has one thing to spawn.
 *
 * It is deliberately dumb. It takes no arguments, reads nothing from the
 * environment beyond what dotenv loads, and runs exactly this and nothing else:
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/price-verify-dryrun.ts --write --max-rows 2300
 *
 * ALL the operational logic — cohort selection, sitemap membership, exact
 * variant identity, verification, the write, the ceilings and the circuit
 * breaker — lives in scripts/price-verify-dryrun.ts and stays there. This file
 * must never grow flags, and the ceiling below must never be raised to make a
 * SAFE STOP go away: a cohort above the ceiling is a signal to investigate.
 *
 * Mirrors the spawn style of scripts/run-e2e.mjs (npx is npx.cmd on Windows).
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The hard safety ceiling. Do not raise this to clear a SAFE STOP. */
const MAX_ROWS = '2300'

const ARGS = [
  'dotenv', '-e', '.env.local', '--',
  'npx', 'tsx', 'scripts/price-verify-dryrun.ts',
  '--write', '--max-rows', MAX_ROWS,
]

console.log(`[retailer-refresh] npx ${ARGS.join(' ')}`)

const child = spawn('npx', ARGS, {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32', // npx on Windows is npx.cmd
})

child.on('exit', code => process.exit(code ?? 1))
child.on('error', err => {
  console.error('[retailer-refresh] failed to start:', err.message)
  process.exit(1)
})
