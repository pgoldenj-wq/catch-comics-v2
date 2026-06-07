'use strict';
/**
 * metrics-snapshot.js — Daily metrics capture
 * Appends one entry per day to metrics-history.json.
 * Called by generate-dashboard.js; exported functions used inline.
 * Never fabricates data — if DB unavailable, no entry is written.
 */

const fs   = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, 'metrics-history.json');

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
  catch { return []; }
}

function saveHistory(entries) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Capture today's snapshot using an already-open Prisma client.
 * If today already has an entry, returns existing history without writing.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {object} liveData  — already-fetched DB counts (avoids double-query)
 * @returns {{ history: object[], isNew: boolean }}
 */
async function captureSnapshot(prisma, liveData) {
  const today   = todayStr();
  const history = loadHistory();

  const existing = history.find(e => e.date === today);
  if (existing) return { history, isNew: false };

  try {
    const entry = {
      date:         today,
      capturedAt:   new Date().toISOString(),
      total:        liveData.total        ?? 0,
      cvCount:      liveData.cvCount      ?? 0,
      coverCount:   liveData.coverCount   ?? 0,
      descCount:    liveData.descCount    ?? 0,
      listingCount: liveData.listingCount ?? 0,
      matchedCount: liveData.matchedCount ?? 0,
    };
    history.push(entry);
    saveHistory(history);
    return { history, isNew: true };
  } catch (e) {
    console.warn('  [snapshot] write failed:', e.message);
    return { history, isNew: false };
  }
}

/**
 * Compute deltas between the last two history entries.
 * Returns null if fewer than two entries exist — never fabricates.
 */
function getDeltas(history) {
  if (history.length < 2) return null;
  const t = history[history.length - 1];   // today
  const y = history[history.length - 2];   // yesterday
  return {
    cvDelta:       t.cvCount      - y.cvCount,
    coverDelta:    t.coverCount   - y.coverCount,
    listingDelta:  t.listingCount - y.listingCount,
    matchedDelta:  t.matchedCount - y.matchedCount,
    totalDelta:    t.total        - y.total,
    descDelta:     t.descCount    - y.descCount,
    fromDate:      y.date,
    toDate:        t.date,
    today:         t,
    yesterday:     y,
  };
}

module.exports = { captureSnapshot, loadHistory, getDeltas, todayStr };
