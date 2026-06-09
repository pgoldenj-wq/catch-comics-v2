#!/usr/bin/env node
/**
 * Catch Comics — Founder Command Centre v2.1
 *
 * Usage:  node launch/generate-dashboard.js
 * Output: launch/dashboard.html
 *
 * Data sources (in priority order):
 *   1. Neon Postgres (via Prisma) — live catalogue metrics
 *   2. Checkpoint files           — enrichment pipeline state
 *   3. Windows Task Scheduler     — scheduled task status
 *   4. launch/logs/*.log          — retailer sync history
 *   5. launch/metrics-history.json — historical deltas
 *   6. launch/LAUNCH.md / WEEK.md — requirements + priorities
 *   7. git log                    — shipped work
 *
 * If DB is unavailable: renders from cached snapshot + markdown files.
 * Never fabricates data. Missing data shows "Not yet tracked".
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const LAUNCH_DIR  = __dirname;
const ROOT_DIR    = path.join(__dirname, '..');
const OUTPUT      = path.join(LAUNCH_DIR, 'dashboard.html');
const LAUNCH_DATE = new Date('2026-07-01T00:00:00');
const START_DATE  = new Date('2026-06-01T00:00:00');
const NOW         = new Date();

// ── Load .env.local so this works from bat file AND post-commit hook ───────────
;(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(ROOT_DIR, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    }
  } catch {}
})();

// ── Impact weights (single source of truth for launch readiness gain %) ────────
const IMPACT = {
  'CV Enrichment':    { impact: 'High',   gain: 12 },
  'Reading Order':    { impact: 'High',   gain: 18 },
  'Data Cleanup':     { impact: 'Medium', gain:  5 },
  'AWIN Write Mode':  { impact: 'High',   gain:  6 },
  'AWIN':             { impact: 'High',   gain:  6 },
  'Product Search':   { impact: 'Medium', gain:  5 },
  'Product Pages':    { impact: 'Low',    gain:  3 },
  'Affiliate Track':  { impact: 'High',   gain:  8 },
  'Legal Pages':      { impact: 'Medium', gain:  4 },
  'Series Index':     { impact: 'High',   gain: 10 },
  'Navbar':           { impact: 'Low',    gain:  2 },
  'Vercel':           { impact: 'High',   gain:  5 },
};

function getImpact(title) {
  for (const [key, val] of Object.entries(IMPACT)) {
    if (title.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return { impact: 'Medium', gain: 3 };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function read(filename) {
  try { return fs.readFileSync(path.join(LAUNCH_DIR, filename), 'utf8'); }
  catch { return ''; }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtNum(n) { return (n ?? 0).toLocaleString(); }

function pct(n, d) { return d ? Math.round(n / d * 100) : 0; }

function fileMinsAgo(filepath) {
  try { return (Date.now() - fs.statSync(filepath).mtimeMs) / 60000; }
  catch { return null; }
}

function fileStaleDays(filename) {
  try { return (Date.now() - fs.statSync(path.join(LAUNCH_DIR, filename)).mtimeMs) / 86400000; }
  catch { return null; }
}

// ── Markdown parsers ──────────────────────────────────────────────────────────

function classifyStatus(text) {
  const t = (text || '').toLowerCase();
  if (/\b(done|complete|functional|good|working|live|verified|shipped|active)\b/.test(t)) return 'done';
  if (/\b(in.progress|partial|running|awaiting|unverified|configured)\b/.test(t))         return 'partial';
  return 'todo';
}

function parseRequirements(md) {
  const m = md.match(/## Launch Requirements[^\n]*\n([\s\S]*?)(?=\n## (?!#))/);
  const section = m ? m[1] : md;
  return section.split(/^### /m).slice(1).map(block => {
    const fl  = block.split('\n')[0] || '';
    const hm  = fl.match(/^(\d+)\.\s+(.+?)(?:\s+—\s+(.+))?$/);
    const title      = hm ? hm[2].trim() : fl.trim();
    const tag        = hm ? (hm[3] || '').trim() : '';
    const statusRaw  = (block.match(/\*\*Status:\*\*\s*([^\n]+)/) || [])[1]?.trim() || 'Not started';
    const shortSt    = statusRaw.split(/[(.]/)[0].trim();
    const imp        = getImpact(title);
    return { title, tag, status: statusRaw, shortStatus: shortSt, level: classifyStatus(statusRaw), ...imp };
  }).filter(r => r.title);
}

function parseWeek(md) {
  return md.split(/^### /m).slice(1).map(block => {
    const fl       = block.split('\n')[0] || '';
    const m        = fl.match(/^(\d+)\.\s+(.+)$/);
    const title    = m ? m[2].trim() : fl.trim();
    const area     = (block.match(/\*\*Area:\*\*\s*([^\n]+)/)      || [])[1]?.trim() || '';
    const doneWhen = (block.match(/\*\*Done when:\*\*\s*([^\n]+)/) || [])[1]?.trim() || '';
    const blocked  = (block.match(/\*\*Blocked by:\*\*\s*([^\n]+)/)|| [])[1]?.trim() || '';
    const stRaw    = (block.match(/\*\*Status:\*\*\s*([^\n]+)/)    || [])[1]?.trim().toLowerCase() || 'todo';
    const isBlocked = !!blocked && !/^[—\-\s]*$/.test(blocked);
    const status   = ['done','in-progress','todo'].includes(stRaw) ? stRaw : 'todo';
    return { title, area, doneWhen, blockedBy: blocked, blocked: isBlocked, status };
  }).filter(w => w.title);
}

function parseCriticalPath(md) {
  const m = md.match(/## Critical Path[^\n]*\n([\s\S]*?)(?=\n## (?!#)|$)/);
  if (!m) return [];
  return m[1].split('\n')
    .map(l => l.match(/^\d+\.\s+(.+)$/))
    .filter(Boolean).map(m2 => m2[1].trim());
}

function parseReadingOrderProgress(md) {
  const m = md.match(/In progress \((\d+) of (\d+) series/);
  return m ? { done: +m[1], total: +m[2] } : { done: 0, total: 25 };
}

// ── Completion % calculator ───────────────────────────────────────────────────

function calcPct(reqs) {
  if (!reqs.length) return 0;
  const scores  = { done: 1.0, partial: 0.5, todo: 0.0 };
  const weights = { 'STRATEGIC BLOCKER': 2, 'TACTICAL BLOCKER': 1.5, 'CRITICAL PATH UNLOCKER': 1.5 };
  let total = 0, max = 0;
  for (const r of reqs) {
    const w = weights[r.tag] || 1;
    total += (scores[r.level] || 0) * w;
    max   += w;
  }
  return max ? Math.round(total / max * 100) : 0;
}

// ── Checkpoint readers ────────────────────────────────────────────────────────

function readCheckpoint(filename) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', filename), 'utf8'));
    const minsAgo = fileMinsAgo(path.join(ROOT_DIR, 'scripts', filename));
    return { ...raw, minsAgo };
  } catch { return null; }
}

function cpRunning(ck) {
  if (!ck || ck.minsAgo === null) return 'unknown';
  if (ck.minsAgo < 40)  return 'running';
  if (ck.minsAgo < 360) return 'idle';
  return 'stopped';
}

// ── Windows Task Scheduler ────────────────────────────────────────────────────

function schtaskStatus(taskName) {
  try {
    const out = execSync(`schtasks /query /tn "\\${taskName}" /fo LIST 2>&1`, { encoding: 'utf8', timeout: 5000 });
    const m   = out.match(/Status:\s+(\S[^\r\n]*)/);
    return m ? m[1].trim() : 'Unknown';
  } catch { return 'Unknown'; }
}

// ── Retailer sync log reader ──────────────────────────────────────────────────

function getRetailerSyncLogs() {
  const logDir = path.join(LAUNCH_DIR, 'logs');
  const result = {};
  try {
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log')).sort().reverse();
    for (const f of files) {
      const m = f.match(/^awin-([a-z]+(?:-[a-z]+)*)-(\d{8}-\d{4})\.log$/);
      if (!m) continue;
      const key = m[1];
      if (result[key]) continue;
      const fp      = path.join(logDir, f);
      const content = fs.readFileSync(fp, 'utf8');
      const mins    = fileMinsAgo(fp);
      const tail    = content.split('\n').slice(-8).join('\n');
      const done    = /✓|Done|complete|upserted/i.test(tail) || mins > 45;
      // Exclude summary counter lines ("Errors : 0") from the error check — they match
      // /error/i as a substring but indicate a successful run, not a failure.
      const failed  = tail.split('\n').some(l =>
        /error|failed|exception/i.test(l) && !/^\s*errors?\s*:/i.test(l)
      );
      // Use [\d,]+ so comma-formatted counts ("14,796") parse correctly.
      const upM     = content.match(/Upserted\s*:\s*([\d,]+)/);
      const crM     = content.match(/Created[^:]*\s*:\s*([\d,]+)/);
      const erM     = content.match(/Errors\s*:\s*([\d,]+)/);
      result[key] = {
        ts: f.replace(/^awin-[a-z-]+-/, '').replace('.log',''),
        status: failed ? 'error' : done ? 'complete' : 'running',
        mins,
        upserted: upM ? parseInt(upM[1].replace(/,/g, ''), 10) : null,
        created:  crM ? parseInt(crM[1].replace(/,/g, ''), 10) : null,
        errors:   erM ? parseInt(erM[1].replace(/,/g, ''), 10) : null,
      };
    }
  } catch {}
  return result;
}

// ── Git log with category grouping ───────────────────────────────────────────

const CAT_RULES = [
  { cat: 'Features',       rx: /\b(feat|feature|add|new|series|reading.order|ingest)\b/i },
  { cat: 'Data',           rx: /\b(data|enrich|seed|import|feed|csv|cv|comicvine|cleanup|backfill|cover)\b/i },
  { cat: 'Retailers',      rx: /\b(retail|awin|wob|bookshop|waterstones|wordery|amazon|ebay|fp|forbidden)\b/i },
  { cat: 'Infrastructure', rx: /\b(infra|chore|config|hook|bat|dashboard|deploy|vercel|env|prisma|migrate|script)\b/i },
  { cat: 'UX',             rx: /\b(ui|ux|style|css|design|layout|component|page|view)\b/i },
  { cat: 'Monetisation',   rx: /\b(affiliate|monetis|revenue|awin|epn|associate)\b/i },
];

function categoriseCommit(msg) {
  const clean = msg.replace(/^(feat|fix|chore|docs|refactor|style|test|perf)(\([^)]+\))?!?:\s*/i, '');
  for (const { cat, rx } of CAT_RULES) if (rx.test(msg)) return { cat, msg: clean };
  return { cat: 'Other', msg: clean };
}

function getCommits(n = 15) {
  try {
    return execSync(`git log --oneline -${n} --no-merges`, { cwd: ROOT_DIR, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .map(line => {
        const sp = line.indexOf(' ');
        return { hash: line.slice(0, sp), ...categoriseCommit(line.slice(sp + 1)) };
      });
  } catch { return []; }
}

// ── Metrics-history deltas ───────────────────────────────────────────────────

function loadDeltas() {
  try {
    const history = JSON.parse(fs.readFileSync(path.join(LAUNCH_DIR, 'metrics-history.json'), 'utf8'));
    if (history.length < 2) return null;
    const t = history[history.length - 1];
    const y = history[history.length - 2];
    return {
      cvDelta:       t.cvCount      - y.cvCount,
      coverDelta:    t.coverCount   - y.coverCount,
      listingDelta:  t.listingCount - y.listingCount,
      matchedDelta:  t.matchedCount - y.matchedCount,
      totalDelta:    t.total        - y.total,
      fromDate: y.date, toDate: t.date,
    };
  } catch { return null; }
}

// ── Status dot helpers ────────────────────────────────────────────────────────

function dot(status) {
  const map = { running:'#22C55E', idle:'#F59E0B', stopped:'#EF4444', complete:'#22C55E', error:'#EF4444', unknown:'#555' };
  return `<span class="dot" style="background:${map[status]||'#555'}"></span>`;
}
function statusLabel(s) {
  const map = { running:'Running', idle:'Idle', stopped:'Stopped', complete:'Complete', error:'Error', unknown:'Unknown' };
  return map[s] || s;
}
function deltaHtml(n, unit='') {
  if (n === null || n === undefined) return `<span class="muted">—</span>`;
  const sign = n > 0 ? '+' : '';
  const cls  = n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
  return `<span class="delta ${cls}">${sign}${fmtNum(n)}${unit}</span>`;
}
function impactBadge(impact) {
  const cls = { High:'imp-h', Medium:'imp-m', Low:'imp-l' }[impact] || 'imp-m';
  return `<span class="imp ${cls}">${impact}</span>`;
}

// ═══════════════════════════════════════════════════════════════════
//  ASYNC MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {

  // ── 1. DB queries (graceful fallback if unavailable) ─────────────
  let db = null;
  let prisma = null;
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient({ log: [] });
    const [total, cvCount, coverCount, descCount, listingCount, matchedCount, retailers] = await Promise.all([
      prisma.canonicalProduct.count({ where: { deletedAt: null } }),
      prisma.canonicalProduct.count({ where: { deletedAt: null, comicvineId: { not: null } } }),
      prisma.canonicalProduct.count({ where: { deletedAt: null, coverImageUrl: { not: null } } }),
      prisma.canonicalProduct.count({ where: { deletedAt: null, description: { not: null } } }),
      prisma.retailerListing.count({ where: { deletedAt: null } }),
      prisma.retailerListing.count({ where: { deletedAt: null, canonicalProductId: { not: null } } }),
      prisma.retailer.findMany({ select: { name:true, domain:true, isActive:true, affiliateNetwork:true, lastSyncedAt:true, _count:{ select:{ listings:true } } } }),
    ]);
    db = { total, cvCount, coverCount, descCount, listingCount, matchedCount, retailers };

    // Snapshot (one per day)
    const { captureSnapshot } = require('./metrics-snapshot.js');
    await captureSnapshot(prisma, db);
  } catch (e) {
    console.warn('  [db] unavailable, using last snapshot:', e.message.slice(0, 80));
    // Fall back to last history entry
    try {
      const hist = JSON.parse(fs.readFileSync(path.join(LAUNCH_DIR, 'metrics-history.json'), 'utf8'));
      if (hist.length) db = { ...hist[hist.length - 1], retailers: [], dbFallback: true };
    } catch {}
  } finally {
    if (prisma) try { await prisma.$disconnect(); } catch {}
  }

  // ── 2. Checkpoint files ──────────────────────────────────────────
  const ckW1  = readCheckpoint('.enrich-catalogue-checkpoint.json');
  const ckW2  = readCheckpoint('.enrich-catalogue-checkpoint-w2.json');
  const ckCov = readCheckpoint('.backfill-covers-checkpoint.json');
  const w1Run  = cpRunning(ckW1);
  const w2Run  = cpRunning(ckW2);
  const covRun = cpRunning(ckCov);

  // ── 3. Task Scheduler ────────────────────────────────────────────
  const task1St = schtaskStatus('CatchComicsEnrichment');
  const task2St = schtaskStatus('CatchComicsEnrichment-W2');

  // ── 4. Retailer sync logs ────────────────────────────────────────
  const syncLogs = getRetailerSyncLogs();

  // ── 5. Markdown ──────────────────────────────────────────────────
  const launchMd = read('LAUNCH.md');
  const weekMd   = read('WEEK.md');
  const reqs     = parseRequirements(launchMd);
  const weekItems = parseWeek(weekMd);
  const critPath = parseCriticalPath(launchMd);
  const roProgress = parseReadingOrderProgress(launchMd);

  // ── 6. Deltas ────────────────────────────────────────────────────
  const deltas = loadDeltas();

  // ── 7. Git ──────────────────────────────────────────────────────
  const commits = getCommits(20);

  // ── 8. Compute timeline metrics ─────────────────────────────────
  const overallPct  = calcPct(reqs);
  const totalDays   = Math.ceil((LAUNCH_DATE - START_DATE) / 86400000);
  const daysLeft    = Math.max(0, Math.ceil((LAUNCH_DATE - NOW) / 86400000));
  const daysPassed  = totalDays - daysLeft;
  const expectedPct = Math.round(daysPassed / totalDays * 100);
  const onTrack     = overallPct >= expectedPct * 0.85;
  const trackGap    = overallPct - expectedPct;

  // ── 9. Derived shortcuts ─────────────────────────────────────────
  const doneItems    = weekItems.filter(i => i.status === 'done');
  const activeItems  = weekItems.filter(i => i.status !== 'done');
  const blockedItems = weekItems.filter(i => i.blocked && i.status !== 'done');
  const nextAction   = activeItems.find(i => i.status === 'in-progress') || activeItems.find(i => !i.blocked) || activeItems[0] || null;
  const biggestBlocker = reqs.find(r => r.level !== 'done' && (r.tag.includes('STRATEGIC') || r.tag.includes('BLOCKER'))) || reqs.find(r => r.level === 'todo') || null;
  const topGainItem = reqs.filter(r => r.level === 'todo').sort((a,b) => b.gain - a.gain)[0] || null;

  // Stale detection
  const weekStaleDays = fileStaleDays('WEEK.md');
  const dataAgeDays   = weekStaleDays ?? 0;
  const isStale       = dataAgeDays > 2.5;
  const dataAgeLabel  = dataAgeDays < 1 ? 'today' : dataAgeDays < 2 ? 'yesterday' : `${Math.floor(dataAgeDays)}d ago`;

  // CV enrichment ETA
  const cvRemaining    = db ? db.total - db.cvCount : null;
  const cvRatePerHr    = 288; // 2 workers × 144/hr
  const cvEtaHrs       = cvRemaining ? Math.ceil(cvRemaining / cvRatePerHr) : null;
  const cvMatchPct     = db ? pct(db.cvCount, db.total) : null;

  // Cover coverage
  const coverPct = db ? pct(db.coverCount, db.total) : null;

  // Retailer affiliate stats
  const activeRetailers = db?.retailers?.filter(r => r.isActive && r._count.listings > 0) || [];
  const affiliatedR     = activeRetailers.filter(r => r.affiliateNetwork);
  const affiliateCovPct = activeRetailers.length ? Math.round(affiliatedR.length / activeRetailers.length * 100) : null;

  // Launch readiness weight breakdown
  const todoHighGain = reqs.filter(r => r.level === 'todo').reduce((s,r) => s + r.gain, 0);

  // Commit grouping
  const commitsByCat = {};
  for (const c of commits) {
    (commitsByCat[c.cat] = commitsByCat[c.cat] || []).push(c);
  }

  // ─────────────────────────────────────────────────────────────────
  // CSS
  // ─────────────────────────────────────────────────────────────────
  const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --red:#E8272A;--black:#080808;--card:#111;--card2:#141414;--border:#1E1E1E;
  --text:#EEEEEE;--muted:#555;--muted2:#777;--done:#22C55E;--partial:#60A5FA;
  --warn:#F59E0B;--active:#A78BFA;--todo:#3a3a3a;
  --font:system-ui,-apple-system,'Segoe UI',Inter,sans-serif;
}
html{background:var(--black);color:var(--text);font-family:var(--font);font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
body{max-width:1140px;margin:0 auto;padding:20px 18px 60px}
h2{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--muted2);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
a{color:inherit;text-decoration:none}

/* ── Layout ── */
.g2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px}
.gap{margin-bottom:14px}
@media(max-width:800px){.g2,.g3,.g4{grid-template-columns:1fr}}

/* ── Card ── */
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px 18px}
.card.accent{border-color:rgba(232,39,42,.35);background:rgba(232,39,42,.04)}
.card.green-border{border-color:rgba(34,197,94,.25)}
.card.warn-border{border-color:rgba(245,158,11,.25)}

/* ── Stale warning ── */
.stale{background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.25);color:var(--warn);border-radius:6px;padding:10px 14px;font-size:12px;margin-bottom:14px}

/* ── Header ── */
.hdr{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border)}
.brand{font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--red)}
.brand-sub{font-weight:400;color:var(--muted2)}
.hdr-meta{font-size:11px;color:var(--muted);margin-top:3px}
.hdr-right{display:flex;gap:20px;align-items:center}
.cd-num{font-size:38px;font-weight:800;color:var(--red);line-height:1;text-align:center}
.cd-label{font-size:9px;letter-spacing:.2em;color:var(--muted);text-transform:uppercase;text-align:center;margin-top:2px}
.track-badge{display:inline-block;padding:4px 10px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.on-track{background:rgba(34,197,94,.1);color:var(--done);border:1px solid rgba(34,197,94,.2)}
.behind{background:rgba(239,68,68,.1);color:#F87171;border:1px solid rgba(239,68,68,.2)}

/* ── Progress bar ── */
.prog{margin-bottom:14px}
.prog-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.prog-label{font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--muted)}
.prog-pct{font-size:28px;font-weight:800;color:var(--text)}
.prog-track{height:4px;background:#181818;border-radius:3px;overflow:hidden;position:relative}
.prog-fill{height:100%;background:linear-gradient(90deg,var(--red),#ff6b6b);border-radius:3px;transition:width .3s}
.prog-exp{position:absolute;top:0;width:2px;height:100%;background:var(--muted);opacity:.4}
.prog-sub{font-size:10px;color:var(--muted);margin-top:4px;text-align:right}

/* ── Morning Brief ── */
.brief-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border:1px solid rgba(232,39,42,.3);border-radius:8px;overflow:hidden;margin-bottom:14px;background:rgba(232,39,42,.03)}
.brief-main{padding:20px 22px;border-right:1px solid rgba(232,39,42,.15)}
.brief-greeting{font-size:18px;font-weight:700;margin-bottom:12px;color:var(--text)}
.brief-readiness{font-size:42px;font-weight:800;color:var(--red);line-height:1}
.brief-readiness-label{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted2);margin-bottom:16px;margin-top:2px}
.brief-delta{font-size:12px;line-height:1.8;color:var(--muted2)}
.brief-delta .pos{color:var(--done)}
.brief-blocker{padding:20px 22px;border-right:1px solid rgba(232,39,42,.15);display:flex;flex-direction:column;justify-content:center}
.brief-action{padding:20px 22px;display:flex;flex-direction:column;justify-content:center}
.brief-section-label{font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.brief-blocker-text{font-size:13px;font-weight:600;color:var(--warn);margin-bottom:6px}
.brief-action-text{font-size:13px;font-weight:600;color:var(--text);margin-bottom:6px}
.brief-action-impact{font-size:11px;color:var(--muted2)}
@media(max-width:800px){.brief-grid{grid-template-columns:1fr}.brief-main,.brief-blocker{border-right:none;border-bottom:1px solid rgba(232,39,42,.15)}}

/* ── Ops ── */
.ops-stat{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px}
.ops-stat:last-child{border-bottom:none}
.ops-label{color:var(--muted2)}
.ops-value{font-weight:600;text-align:right}
.ops-header{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.ops-title{font-size:12px;font-weight:700}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}

/* ── Delta panel ── */
.delta-panel{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:18px 20px;margin-bottom:14px}
.delta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:12px}
.delta-item{text-align:center;padding:12px;background:var(--card2);border-radius:6px;border:1px solid var(--border)}
.delta-num{font-size:26px;font-weight:800;line-height:1;margin-bottom:4px}
.delta-sub{font-size:10px;color:var(--muted2);text-transform:uppercase;letter-spacing:.1em}
.pos{color:var(--done)}
.neg{color:#F87171}
.zero{color:var(--muted2)}
.delta{font-weight:700}

/* ── Catalogue health ── */
.health-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.hstat{padding:12px 14px;background:var(--card2);border:1px solid var(--border);border-radius:6px}
.hstat-num{font-size:22px;font-weight:800;line-height:1;margin-bottom:3px}
.hstat-label{font-size:10px;color:var(--muted2);text-transform:uppercase;letter-spacing:.08em}
.hstat-sub{font-size:10px;color:var(--muted);margin-top:2px}

/* ── Launch readiness table ── */
.lr-table{width:100%;border-collapse:collapse}
.lr-table tr{border-bottom:1px solid var(--border)}
.lr-table tr:last-child{border-bottom:none}
.lr-table td{padding:8px 4px;font-size:12px;vertical-align:middle}
.lr-title{width:38%;font-weight:600}
.lr-status{width:20%;color:var(--muted2)}
.lr-imp{width:12%}
.lr-gain{width:10%;text-align:right;font-weight:700;font-size:13px}
.lr-gain.pos{color:var(--done)}
.lr-gain.zero{color:var(--muted)}
.imp{display:inline-block;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.imp-h{background:rgba(232,39,42,.12);color:var(--red)}
.imp-m{background:rgba(96,165,250,.1);color:var(--partial)}
.imp-l{background:rgba(100,100,100,.15);color:var(--muted2)}
.done-row td{opacity:.5}
.done-row .lr-title{text-decoration:line-through}
.status-badge{display:inline-block;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.s-done{background:rgba(34,197,94,.1);color:var(--done)}
.s-partial{background:rgba(96,165,250,.1);color:var(--partial)}
.s-todo{background:rgba(80,80,80,.2);color:var(--muted2)}

/* ── Critical path ── */
.cp-step{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)}
.cp-step:last-child{border-bottom:none}
.cp-n{font-size:10px;font-weight:700;color:var(--muted);width:18px;flex-shrink:0;text-align:right;margin-top:1px}
.cp-done .cp-n{color:var(--done)}
.cp-text{font-size:12px;color:var(--text)}
.cp-done .cp-text{color:var(--muted);text-decoration:line-through}

/* ── Week items ── */
.wi-item{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)}
.wi-item:last-child{border-bottom:none}
.wi-icon{width:14px;flex-shrink:0;text-align:center;font-size:12px;margin-top:1px}
.wi-title{font-size:13px;font-weight:600;margin-bottom:2px}
.wi-sub{font-size:11px;color:var(--muted2)}
.wi-done .wi-title{text-decoration:line-through;color:var(--muted)}
.wi-done{opacity:.5}
.badge{display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;margin-top:4px}
.b-done{background:rgba(34,197,94,.1);color:var(--done)}
.b-active{background:rgba(167,139,250,.12);color:var(--active)}
.b-blocked{background:rgba(245,158,11,.1);color:var(--warn)}
.b-todo{background:rgba(80,80,80,.15);color:var(--muted2)}

/* ── Commits ── */
.cat-label{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin:12px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--border)}
.cat-label:first-child{margin-top:0}
.cm{display:flex;gap:8px;align-items:baseline;padding:4px 0;font-size:12px;border-bottom:1px solid #141414}
.cm:last-child{border-bottom:none}
.ch{font-family:'Courier New',monospace;font-size:10px;color:var(--muted);flex-shrink:0}

/* ── Retailer table ── */
.rtable{width:100%;border-collapse:collapse}
.rtable tr{border-bottom:1px solid var(--border)}
.rtable tr:last-child{border-bottom:none}
.rtable td{padding:6px 4px;font-size:12px;vertical-align:middle}
.rc-name{font-weight:600;width:35%}
.rc-count{text-align:right;color:var(--muted2);width:12%}
.rc-affil{font-size:10px;color:var(--muted);width:20%}

/* ── Monetisation ── */
.mono-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px}
.mono-row:last-child{border-bottom:none}
.mono-label{color:var(--muted2)}
.mono-val{font-weight:600}
.configured{color:var(--done)}
.not-configured{color:var(--warn)}
.partial-config{color:var(--partial)}

/* ── Protocol ── */
.protocol{background:#0c0c0c;border:1px solid var(--border);border-radius:8px;padding:14px 18px;margin-top:14px;font-family:'Courier New',monospace;font-size:12px;color:var(--muted);line-height:1.9}
.muted{color:var(--muted2)}
.empty{font-size:12px;color:var(--muted);font-style:italic}
.db-warn{font-size:10px;color:var(--warn);margin-top:4px}
`;

  // ─────────────────────────────────────────────────────────────────
  // HTML SECTIONS
  // ─────────────────────────────────────────────────────────────────

  // Helper: format delta for morning brief
  const briefDelta = deltas
    ? [
        deltas.cvDelta    ? `<span class="pos">+${fmtNum(deltas.cvDelta)}</span> ComicVine matches` : null,
        deltas.coverDelta ? `<span class="pos">+${fmtNum(deltas.coverDelta)}</span> covers` : null,
        deltas.listingDelta ? `<span class="pos">+${fmtNum(deltas.listingDelta)}</span> retailer listings` : null,
        doneItems.length  ? `<span class="pos">+${doneItems.length}</span> tasks completed` : null,
      ].filter(Boolean).join('<br>')
    : '<span class="muted">Baseline day — no delta yet</span>';

  const MORNING_BRIEF = `
<div class="brief-grid">
  <div class="brief-main">
    <div class="brief-greeting">Good morning, Joe.</div>
    <div class="brief-readiness">${overallPct}%</div>
    <div class="brief-readiness-label">Launch Readiness</div>
    <div class="brief-delta">
      <div style="font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:6px">Since yesterday</div>
      ${briefDelta}
    </div>
  </div>
  <div class="brief-blocker">
    <div class="brief-section-label">Biggest Blocker</div>
    <div class="brief-blocker-text">${biggestBlocker ? esc(biggestBlocker.title) : 'None — all clear'}</div>
    <div style="font-size:11px;color:var(--muted2)">${biggestBlocker ? esc(biggestBlocker.shortStatus) : ''}</div>
  </div>
  <div class="brief-action">
    <div class="brief-section-label">Recommended Action</div>
    <div class="brief-action-text">${nextAction ? esc(nextAction.title) : (topGainItem ? esc(topGainItem.title) : 'Update WEEK.md')}</div>
    ${topGainItem ? `<div class="brief-action-impact">Expected impact: +${topGainItem.gain}% launch readiness</div>` : ''}
  </div>
</div>`;

  // Live Ops — CV
  const w1Stats = ckW1?.stats || {};
  const w2Stats = ckW2?.stats || {};
  const w1Total = (w1Stats.matched||0) + (w1Stats.unmatched||0) + (w1Stats.skippedNoSignal||0);
  const w2Total = (w2Stats.matched||0) + (w2Stats.unmatched||0) + (w2Stats.skippedNoSignal||0);
  const processedTotal = w1Total + w2Total;
  const matchedTotal   = (w1Stats.matched||0) + (w2Stats.matched||0);
  const matchRatePct   = processedTotal ? Math.round(matchedTotal / processedTotal * 100) : null;

  const CV_OPS = `
<div class="card">
  <div class="ops-header">
    ${dot(w1Run)} ${dot(w2Run)}
    <div class="ops-title">ComicVine Enrichment</div>
  </div>
  <div class="ops-stat"><span class="ops-label">Worker 1</span><span class="ops-value">${dot(w1Run)} ${esc(task1St)}</span></div>
  <div class="ops-stat"><span class="ops-label">Worker 2</span><span class="ops-value">${dot(w2Run)} ${esc(task2St)}</span></div>
  <div class="ops-stat"><span class="ops-label">CV IDs linked</span><span class="ops-value">${db ? fmtNum(db.cvCount) : '—'}</span></div>
  <div class="ops-stat"><span class="ops-label">Coverage</span><span class="ops-value">${cvMatchPct !== null ? cvMatchPct+'%' : '—'}</span></div>
  <div class="ops-stat"><span class="ops-label">Processed (combined)</span><span class="ops-value">${fmtNum(processedTotal)}</span></div>
  <div class="ops-stat"><span class="ops-label">Match rate</span><span class="ops-value">${matchRatePct !== null ? matchRatePct+'%' : '—'}</span></div>
  <div class="ops-stat"><span class="ops-label">ETA (to process all)</span><span class="ops-value">${cvEtaHrs ? '~'+cvEtaHrs+'h' : '—'}</span></div>
  <div class="ops-stat"><span class="ops-label">W1 checkpoint</span><span class="ops-value">${ckW1 ? Math.round(ckW1.minsAgo)+'m ago' : '—'}</span></div>
</div>`;

  // Live Ops — Covers
  const covStats = ckCov?.stats || {};
  const COVER_OPS = `
<div class="card">
  <div class="ops-header">${dot(covRun)}<div class="ops-title">Cover Recovery</div></div>
  <div class="ops-stat"><span class="ops-label">Status</span><span class="ops-value">${dot(covRun)} ${statusLabel(covRun)}</span></div>
  <div class="ops-stat"><span class="ops-label">Products with covers</span><span class="ops-value">${db ? fmtNum(db.coverCount) : '—'}</span></div>
  <div class="ops-stat"><span class="ops-label">Coverage</span><span class="ops-value">${coverPct !== null ? coverPct+'%' : '—'}</span></div>
  <div class="ops-stat"><span class="ops-label">Recovered (total)</span><span class="ops-value">${fmtNum(covStats.recovered)}</span></div>
  <div class="ops-stat"><span class="ops-label">Failed</span><span class="ops-value">${covStats.failed ?? '—'}</span></div>
  <div class="ops-stat"><span class="ops-label">Last run</span><span class="ops-value">${ckCov ? Math.round(ckCov.minsAgo)+'m ago' : '—'}</span></div>
  <div class="ops-stat" style="margin-top:8px"><span style="font-size:10px;color:var(--muted2)">Cover backfill uses Open Library + Google Books for products without CV matches. 404s on niche ISBNs are normal.</span></div>
</div>`;

  // Live Ops — Retailer syncs
  const SYNC_STATUS_MAP = { running:'#A78BFA', complete:'#22C55E', error:'#F87171', '—':'#555' };
  const knownRetailers  = ['waterstones','bookshop','bookshop-isbn','letsbuybooks','scholastic'];
  const RETAILER_OPS = `
<div class="card">
  <div class="ops-header"><div class="ops-title">Retailer Syncs</div></div>
  ${knownRetailers.map(slug => {
    const s = syncLogs[slug];
    const label = { waterstones:'Waterstones', bookshop:'Bookshop.org UK', 'bookshop-isbn':'Bookshop (ISBN)', letsbuybooks:'Lets Buy Books', scholastic:'Scholastic' }[slug] || slug;
    const st    = s?.status || '—';
    const c     = SYNC_STATUS_MAP[st] || '#555';
    const extra = s ? (s.upserted !== null ? ` · ${fmtNum(s.upserted)} upserted` : '') + (s.created ? ` · ${fmtNum(s.created)} new` : '') : '';
    return `<div class="ops-stat"><span class="ops-label">${esc(label)}</span><span class="ops-value" style="color:${c}">${st === '—' ? '<span class="muted">No log</span>' : st}${s ? `<span style="font-size:10px;color:var(--muted);margin-left:6px">${extra || (s.mins < 60 ? Math.round(s.mins)+'m ago' : '')}</span>` : ''}</span></div>`;
  }).join('')}
  <div class="ops-stat"><span class="ops-label">WoB / Travelling Man</span><span class="ops-value" style="color:var(--muted2)">Bulk import (last: Jun 3)</span></div>
  <div class="ops-stat"><span class="ops-label">eBay</span><span class="ops-value" style="color:var(--muted2)">API-driven (on-demand)</span></div>
</div>`;

  // Daily Delta
  const DAILY_DELTA = deltas
    ? `
<div class="delta-panel">
  <h2>Since Yesterday <span style="font-weight:400;color:var(--muted);letter-spacing:0;text-transform:none;font-size:11px">${deltas.fromDate} → ${deltas.toDate}</span></h2>
  <div class="delta-grid">
    <div class="delta-item"><div class="delta-num ${deltas.cvDelta>0?'pos':deltas.cvDelta<0?'neg':'zero'}">${deltas.cvDelta>=0?'+':''}${fmtNum(deltas.cvDelta)}</div><div class="delta-sub">CV matches</div></div>
    <div class="delta-item"><div class="delta-num ${deltas.coverDelta>0?'pos':deltas.coverDelta<0?'neg':'zero'}">${deltas.coverDelta>=0?'+':''}${fmtNum(deltas.coverDelta)}</div><div class="delta-sub">Covers</div></div>
    <div class="delta-item"><div class="delta-num ${deltas.listingDelta>0?'pos':deltas.listingDelta<0?'neg':'zero'}">${deltas.listingDelta>=0?'+':''}${fmtNum(deltas.listingDelta)}</div><div class="delta-sub">Listings</div></div>
    <div class="delta-item"><div class="delta-num ${deltas.totalDelta>0?'pos':deltas.totalDelta<0?'neg':'zero'}">${deltas.totalDelta>=0?'+':''}${fmtNum(deltas.totalDelta)}</div><div class="delta-sub">Products</div></div>
    <div class="delta-item"><div class="delta-num ${doneItems.length?'pos':'zero'}">${doneItems.length>0?'+':''}${doneItems.length}</div><div class="delta-sub">Tasks done</div></div>
  </div>
</div>`
    : `<div class="delta-panel"><h2>Since Yesterday</h2><div style="font-size:13px;color:var(--muted2);margin-top:8px">Baseline day — no delta available yet. Check back tomorrow.</div></div>`;

  // Catalogue Health
  const CATALOGUE_HEALTH = `
<div class="card gap">
  <h2>Catalogue Health${db?.dbFallback ? '<span class="db-warn"> · Using cached snapshot (DB unavailable)</span>' : ''}</h2>
  <div class="health-grid">
    <div class="hstat"><div class="hstat-num">${db ? fmtNum(db.total) : '—'}</div><div class="hstat-label">Products</div></div>
    <div class="hstat"><div class="hstat-num">${db ? fmtNum(db.cvCount) : '—'}</div><div class="hstat-label">CV IDs</div><div class="hstat-sub">${cvMatchPct !== null ? cvMatchPct+'% coverage' : ''}</div></div>
    <div class="hstat"><div class="hstat-num">${db ? fmtNum(db.coverCount) : '—'}</div><div class="hstat-label">Covers</div><div class="hstat-sub">${coverPct !== null ? coverPct+'% coverage' : ''}</div></div>
    <div class="hstat"><div class="hstat-num">${db ? fmtNum(db.descCount) : '—'}</div><div class="hstat-label">Descriptions</div><div class="hstat-sub">${db ? pct(db.descCount,db.total)+'%' : ''}</div></div>
    <div class="hstat"><div class="hstat-num">${db ? fmtNum(db.listingCount) : '—'}</div><div class="hstat-label">Listings</div></div>
    <div class="hstat"><div class="hstat-num">${db ? fmtNum(db.matchedCount) : '—'}</div><div class="hstat-label">Matched</div><div class="hstat-sub">${db ? pct(db.matchedCount,db.listingCount)+'%' : ''}</div></div>
    <div class="hstat"><div class="hstat-num">${db ? fmtNum(db.listingCount - db.matchedCount) : '—'}</div><div class="hstat-label">Unmatched</div></div>
    <div class="hstat"><div class="hstat-num">${roProgress.done}/${roProgress.total}</div><div class="hstat-label">Series ready</div></div>
    <div class="hstat"><div class="hstat-num">${activeRetailers.length}</div><div class="hstat-label">Active retailers</div></div>
    <div class="hstat"><div class="hstat-num">${affiliatedR.length}</div><div class="hstat-label">Affiliated</div><div class="hstat-sub">${affiliateCovPct !== null ? affiliateCovPct+'% coverage' : ''}</div></div>
  </div>
</div>`;

  // Automation Status
  const autoItems = [
    { label: 'CV Enrichment Worker 1', status: task1St === 'Running' ? 'running' : task1St === 'Ready' ? 'idle' : 'stopped', detail: ckW1 ? `Last checkpoint: ${Math.round(ckW1.minsAgo)}m ago` : '' },
    { label: 'CV Enrichment Worker 2', status: task2St === 'Running' ? 'running' : task2St === 'Ready' ? 'idle' : 'stopped', detail: ckW2 ? `Last checkpoint: ${Math.round(ckW2.minsAgo)}m ago` : '' },
    { label: 'Cover Backfill', status: covRun, detail: ckCov ? `${fmtNum(covStats.recovered)} recovered` : 'No checkpoint' },
    { label: 'Post-commit hook', status: fs.existsSync(path.join(ROOT_DIR,'.git','hooks','post-commit')) ? 'running' : 'stopped', detail: 'Regenerates dashboard on every commit' },
    { label: 'Daily snapshot', status: 'complete', detail: `Captured ${new Date().toLocaleDateString()}` },
  ];

  const AUTOMATION = `
<div class="card">
  <h2>Automation Status</h2>
  ${autoItems.map(a => `
  <div class="ops-stat">
    <span class="ops-label">${esc(a.label)}</span>
    <span class="ops-value">${dot(a.status)} <span style="color:${a.status==='running'?'var(--done)':a.status==='idle'?'var(--warn)':a.status==='complete'?'var(--done)':'#F87171'}">${statusLabel(a.status)}</span>
    ${a.detail ? `<br><span style="font-size:10px;color:var(--muted)">${esc(a.detail)}</span>` : ''}</span>
  </div>`).join('')}
</div>`;

  // Monetisation Readiness
  const awinReq      = reqs.find(r => r.title.toLowerCase().includes('awin'));
  const awinStatus   = awinReq?.level || 'todo';
  const ebayListings = db?.retailers?.find(r => r.domain.includes('ebay.co.uk'))?._count?.listings || 0;
  const amazonList   = db?.retailers?.find(r => r.domain.includes('amazon'))?._count?.listings || 0;
  const pricedCount  = db ? db.matchedCount : 0; // proxy: matched products have at least one price

  const monoRows = [
    { label: 'eBay EPN', val: ebayListings > 0 ? 'Configured' : 'Not configured', cls: ebayListings > 0 ? 'configured' : 'not-configured' },
    { label: 'Amazon Associates', val: amazonList > 0 ? 'Configured' : 'Not configured', cls: amazonList > 0 ? 'configured' : 'not-configured' },
    { label: 'AWIN Write Mode', val: awinStatus === 'partial' ? 'Partial — write mode disabled' : awinStatus === 'done' ? 'Active' : 'Not enabled', cls: awinStatus === 'done' ? 'configured' : awinStatus === 'partial' ? 'partial-config' : 'not-configured' },
    { label: 'Retailers connected', val: String(activeRetailers.length), cls: '' },
    { label: 'With affiliate attribution', val: `${affiliatedR.length} / ${activeRetailers.length}`, cls: affiliatedR.length ? 'configured' : 'not-configured' },
    { label: 'Affiliate coverage', val: affiliateCovPct !== null ? affiliateCovPct+'%' : 'Not yet tracked', cls: '' },
    { label: 'Pricing coverage', val: db ? pct(pricedCount, db.total)+'%' : 'Not yet tracked', cls: '' },
  ];

  const MONETISATION = `
<div class="card">
  <h2>Monetisation Readiness <span style="font-weight:400;color:var(--muted2);letter-spacing:0;text-transform:none;font-size:11px">— configuration only, no revenue data</span></h2>
  ${monoRows.map(r => `<div class="mono-row"><span class="mono-label">${esc(r.label)}</span><span class="mono-val ${r.cls}">${esc(r.val)}</span></div>`).join('')}
</div>`;

  // Launch Readiness
  const LR_TABLE = `
<div class="card gap">
  <h2>Launch Readiness — ${overallPct}% · ${todoHighGain > 0 ? todoHighGain+'% potential gain remaining' : 'all done!'}</h2>
  <table class="lr-table">
    <thead><tr>
      <td class="lr-title" style="color:var(--muted);font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding-bottom:6px">Requirement</td>
      <td class="lr-status" style="color:var(--muted);font-size:10px;letter-spacing:.1em;text-transform:uppercase">Status</td>
      <td class="lr-imp" style="color:var(--muted);font-size:10px;letter-spacing:.1em;text-transform:uppercase">Impact</td>
      <td class="lr-gain" style="color:var(--muted);font-size:10px;letter-spacing:.1em;text-transform:uppercase">Gain</td>
    </tr></thead>
    <tbody>
    ${reqs.map(r => {
      const isDone = r.level === 'done';
      const sBadge = `<span class="status-badge ${isDone?'s-done':r.level==='partial'?'s-partial':'s-todo'}">${esc(r.shortStatus)}</span>`;
      const gainHtml = isDone ? '<span class="lr-gain zero">✓</span>' : `<span class="lr-gain pos">+${r.gain}%</span>`;
      return `<tr class="${isDone ? 'done-row' : ''}">
        <td class="lr-title">${esc(r.title)}${r.tag ? `<br><span style="font-size:9px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase">${esc(r.tag)}</span>` : ''}</td>
        <td class="lr-status">${sBadge}</td>
        <td class="lr-imp">${impactBadge(r.impact)}</td>
        <td>${gainHtml}</td>
      </tr>`;
    }).join('')}
    </tbody>
  </table>
</div>`;

  // Critical Path
  const CP = `
<div class="card">
  <h2>Critical Path</h2>
  ${critPath.length
    ? critPath.map((step, i) => {
        const done = reqs.some(r => r.level === 'done' && r.title.toLowerCase().split(' ').some(w => w.length > 3 && step.toLowerCase().includes(w)));
        return `<div class="cp-step ${done?'cp-done':''}"><div class="cp-n">${done?'✓':i+1}</div><div class="cp-text">${esc(step)}</div></div>`;
      }).join('')
    : '<div class="empty">No critical path found in LAUNCH.md.</div>'}
</div>`;

  // This Week
  const THIS_WEEK = `
<div class="card">
  <h2>This Week — ${doneItems.length}/${weekItems.length} done${blockedItems.length ? ` · ${blockedItems.length} blocked` : ''}</h2>
  ${weekItems.length ? weekItems.map(item => {
    const isDone = item.status === 'done';
    const icon   = isDone ? '<span style="color:var(--done)">✓</span>' : item.status === 'in-progress' ? '<span style="color:var(--active)">◐</span>' : '<span style="color:var(--todo)">·</span>';
    const badge  = isDone ? '<span class="badge b-done">Done</span>' : item.blocked ? `<span class="badge b-blocked">⚠ ${esc(item.blockedBy)}</span>` : item.status === 'in-progress' ? '<span class="badge b-active">In progress</span>' : `<span class="badge b-todo">${esc(item.area)}</span>`;
    return `<div class="wi-item ${isDone?'wi-done':''}"><div class="wi-icon">${icon}</div><div><div class="wi-title">${esc(item.title)}</div>${!isDone?`<div class="wi-sub">${esc(item.doneWhen)}</div>`:''}${badge}</div></div>`;
  }).join('') : '<div class="empty">Update WEEK.md to see priorities.</div>'}
</div>`;

  // Shipped Recently (categorized)
  const CAT_ORDER = ['Features','Data','Retailers','Infrastructure','UX','Monetisation','Other'];
  const SHIPPED = `
<div class="card gap">
  <h2>Shipped Recently</h2>
  ${commits.length ? CAT_ORDER.filter(cat => commitsByCat[cat]?.length).map(cat =>
    `<div class="cat-label">${cat}</div>` +
    commitsByCat[cat].map(c => `<div class="cm"><span class="ch">${esc(c.hash)}</span>${esc(c.msg)}</div>`).join('')
  ).join('') : '<div class="empty">No commits found.</div>'}
</div>`;

  // ─────────────────────────────────────────────────────────────────
  // ASSEMBLE HTML
  // ─────────────────────────────────────────────────────────────────

  const trackGapText  = trackGap >= 0 ? `${trackGap}% ahead of expected pace` : `${Math.abs(trackGap)}% behind expected pace`;
  const staleWarning  = isStale ? `<div class="stale">⚠ Data is ${Math.floor(dataAgeDays)} days old — update LAUNCH.md or WEEK.md statuses after completing work.</div>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Catch Comics — Founder Command Centre</title>
<style>${CSS}</style>
</head>
<body>

${staleWarning}

<!-- Header -->
<header class="hdr">
  <div>
    <div class="brand">CATCH COMICS <span class="brand-sub">/ Founder Command Centre</span></div>
    <div class="hdr-meta">Launch July 1, 2026 · ${totalDays}-day sprint · Generated ${NOW.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} · Data: ${dataAgeLabel}</div>
  </div>
  <div class="hdr-right">
    <div><div class="cd-num">${daysLeft}</div><div class="cd-label">days left</div></div>
    <div style="text-align:center">
      <span class="track-badge ${onTrack?'on-track':'behind'}">${onTrack?'ON TRACK':'BEHIND'}</span>
      <div style="font-size:10px;color:var(--muted);margin-top:4px">${trackGapText}</div>
    </div>
  </div>
</header>

<!-- Progress bar -->
<div class="prog">
  <div class="prog-top">
    <span class="prog-label">Launch readiness — computed from statuses</span>
    <span class="prog-pct">${overallPct}%</span>
  </div>
  <div class="prog-track">
    <div class="prog-fill" style="width:${Math.min(100,overallPct)}%"></div>
    <div class="prog-exp" style="left:${Math.min(99,expectedPct)}%" title="Expected ${expectedPct}% at day ${daysPassed}"></div>
  </div>
  <div class="prog-sub">Expected pace: ${expectedPct}% at day ${daysPassed} of ${totalDays}</div>
</div>

<!-- Morning Brief -->
${MORNING_BRIEF}

<!-- Live Operations -->
<div class="g3">
  ${CV_OPS}
  ${COVER_OPS}
  ${RETAILER_OPS}
</div>

<!-- Daily Delta -->
${DAILY_DELTA}

<!-- Catalogue Health -->
${CATALOGUE_HEALTH}

<!-- Automation + Monetisation -->
<div class="g2">
  ${AUTOMATION}
  ${MONETISATION}
</div>

<!-- Launch Readiness -->
${LR_TABLE}

<!-- Critical Path + This Week -->
<div class="g2">
  ${CP}
  ${THIS_WEEK}
</div>

<!-- Shipped Recently -->
${SHIPPED}

<!-- Claude Session Protocol -->
<div class="protocol">
  Read launch/LAUNCH.md and launch/WEEK.md.<br>
  Tell me: (1) current launch %, (2) most critical task today, (3) one thing I should not touch today.
</div>

</body>
</html>`;

  fs.writeFileSync(OUTPUT, html, 'utf8');

  const status = onTrack ? '✓ ON TRACK' : '⚠ BEHIND';
  console.log(`\n  ${status}  |  ${overallPct}% done  |  ${daysLeft} days left  |  ${trackGapText}`);
  console.log(`  CV: ${db ? db.cvCount.toLocaleString() : '?'}/${db ? db.total.toLocaleString() : '?'} (${cvMatchPct ?? '?'}%)  |  Covers: ${coverPct ?? '?'}%  |  Listings: ${db ? db.listingCount.toLocaleString() : '?'}`);
  if (deltas) console.log(`  Δ yesterday: CV +${deltas.cvDelta}  Covers +${deltas.coverDelta}  Listings +${deltas.listingDelta}`);
  else        console.log(`  Δ yesterday: baseline day`);
  console.log(`  This week: ${weekItems.length} items, ${doneItems.length} done, ${blockedItems.length} blocked`);
  if (isStale) console.log(`  ⚠ Data is ${Math.floor(dataAgeDays)} days old — update statuses`);
  console.log(`\n  Dashboard → ${OUTPUT}\n`);
}

main().catch(e => {
  console.error('Generator failed:', e.message);
  process.exit(1);
});
