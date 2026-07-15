#!/usr/bin/env tsx
/**
 * generate-retailer-ops-xlsx.ts
 *
 * Generates the Catch Comics Retailer Operations Tracker spreadsheet.
 * Output: retailer-ops.xlsx (project root)
 *
 * Usage:
 *   npx tsx scripts/generate-retailer-ops-xlsx.ts
 */

import ExcelJS from 'exceljs'
import * as path from 'path'

// ── Colour palette ────────────────────────────────────────────────────────────
const COLOURS = {
  // Status
  live:       { fill: 'D6F4E0', font: '1A6B3A' },   // green
  pending:    { fill: 'FFF3CD', font: '856404' },   // amber
  broken:     { fill: 'FDDEDE', font: 'A31515' },   // red
  unknown:    { fill: 'EEF2F7', font: '374151' },   // grey-blue

  // Priority
  p0:         { fill: 'FDDEDE', font: 'A31515' },
  p1:         { fill: 'FFF3CD', font: '856404' },
  p2:         { fill: 'EEF2F7', font: '374151' },
  none:       { fill: 'FFFFFF', font: '374151' },

  // Sheet header
  header:     { fill: '1A1A2E', font: 'FFFFFF' },
  subheader:  { fill: 'E8272A', font: 'FFFFFF' },
}

// ── Data ──────────────────────────────────────────────────────────────────────

const retailers = [
  {
    name:          'Travelling Man',
    domain:        'travellingman.com',
    dbListings:    '~9,239 priced',
    monetised:     '❌ None',
    commissionPath:'No public affiliate programme',
    affiliateId:   '—',
    feedState:     'N/A (scraper)',
    feedFid:       '—',
    status:        'ACTIVE',
    statusType:    'broken',
    priority:      'P1',
    priorityType:  'p1',
    nextAction:    'Email TM directly — propose direct affiliate deal',
    owner:         'Founder',
    reviewDate:    '2026-06-04',
    notes:         'Primary data anchor for comparison pages. 9,239 listings, zero commission. Direct email is the only path.',
  },
  {
    name:          'World of Books UK',
    domain:        'worldofbooks.com',
    dbListings:    '~43,677 priced',
    monetised:     '❌ REJECTED',
    commissionPath:'AWIN — application rejected',
    affiliateId:   'Unknown mid',
    feedState:     'Unknown',
    feedFid:       '—',
    status:        'REJECTED',
    statusType:    'broken',
    priority:      'P0',
    priorityType:  'p0',
    nextAction:    'Re-apply on AWIN Rejected tab — 1 click',
    owner:         'Founder',
    reviewDate:    '2026-05-22',
    notes:         'Largest single source (43,677 listings). Zero commission. Re-apply is one click in AWIN dashboard.',
  },
  {
    name:          'Wordery',
    domain:        'wordery.com',
    dbListings:    '~1,710 priced',
    monetised:     '❌ CLOSED',
    commissionPath:'Was AWIN mid=9111 — merchant programme dead',
    affiliateId:   'null (patched)',
    feedState:     'N/A — merchant gone',
    feedFid:       '—',
    status:        'CLOSED',
    statusType:    'broken',
    priority:      'None',
    priorityType:  'none',
    nextAction:    'Monitor for re-launch. No action available.',
    owner:         '—',
    reviewDate:    '2026-09-01',
    notes:         'DB patched: affiliateNetwork=null. Links now go to bare wordery.com. Merchant genuinely closed on AWIN.',
  },
  {
    name:          'Waterstones',
    domain:        'waterstones.com',
    dbListings:    '~4,863 (stubs)',
    monetised:     '⚠️ PENDING',
    commissionPath:'AWIN mid=3787 — awaiting approval',
    affiliateId:   '3787',
    feedState:     'Unknown — awaiting access',
    feedFid:       '—',
    status:        'PENDING',
    statusType:    'pending',
    priority:      'P2',
    priorityType:  'p2',
    nextAction:    'Monitor AWIN Pending tab. Chase if >4 weeks. mid=2079 is confirmed closed.',
    owner:         'Founder',
    reviewDate:    '2026-06-04',
    notes:         'Links redirect correctly via /go/ but zero commission. mid=2079 closed; mid=3787 pending.',
  },
  {
    name:          'Zavvi',
    domain:        'zavvi.com',
    dbListings:    '~4,904 (stubs)',
    monetised:     '⚠️ PENDING',
    commissionPath:'AWIN mid=2549 — awaiting approval',
    affiliateId:   '2549',
    feedState:     'Unknown — awaiting access',
    feedFid:       '—',
    status:        'PENDING',
    statusType:    'pending',
    priority:      'P2',
    priorityType:  'p2',
    nextAction:    'Monitor AWIN Pending tab.',
    owner:         'Founder',
    reviewDate:    '2026-06-04',
    notes:         'Links redirect correctly via /go/ but zero commission.',
  },
  {
    name:          'Bookshop.org UK',
    domain:        'uk.bookshop.org',
    dbListings:    '63 priced',
    monetised:     '✅ LIVE',
    commissionPath:'AWIN mid=62675 — JOINED, confirmed',
    affiliateId:   '62675',
    feedState:     'YES — FID 99173 (not yet ingested at scale)',
    feedFid:       '99173',
    status:        'LIVE',
    statusType:    'live',
    priority:      'P0',
    priorityType:  'p0',
    nextAction:    'Fix AWIN_DATAFEED_KEY, then: npm run sync:awin -- --merchant bookshop --write',
    owner:         'Founder → Claude',
    reviewDate:    '2026-05-22',
    notes:         'Commission live. Only 63 priced listings — feed ingestion will add thousands. Datafeed key returning 400.',
  },
  {
    name:          'Lets Buy Books',
    domain:        'letsbuybooks.com',
    dbListings:    'Small',
    monetised:     '✅ LIVE',
    commissionPath:'AWIN mid=122824 — JOINED, confirmed',
    affiliateId:   '122824',
    feedState:     'YES — FID 112530 (not yet ingested)',
    feedFid:       '112530',
    status:        'LIVE',
    statusType:    'live',
    priority:      'P0',
    priorityType:  'p0',
    nextAction:    'Fix AWIN_DATAFEED_KEY, then: npm run sync:awin -- --merchant letsbuybooks --write',
    owner:         'Founder → Claude',
    reviewDate:    '2026-05-22',
    notes:         'Commission live. Feed available but not ingested.',
  },
  {
    name:          'Amazon UK',
    domain:        'amazon.co.uk',
    dbListings:    '321 priced (stored, aging out)',
    monetised:     '✅ LIVE',
    commissionPath:'Amazon Associates tag: catchcomics-21',
    affiliateId:   'catchcomics-21',
    feedState:     'NONE — Rainforest retired 2026-07-13 (account closed)',
    feedFid:       'N/A',
    status:        'AFFILIATE-ONLY',
    statusType:    'live',
    priority:      'P2',
    priorityType:  'p2',
    nextAction:    'None now. Revisit Amazon Creators API after 10 qualifying sales/30d.',
    owner:         'Founder',
    reviewDate:    '2026-07-13',
    notes:         'Stored offers age out honestly under 30-day rule. Affiliate links + search fallbacks remain. See launch/operations/amazon-post-rainforest-plan.md.',
  },
  {
    name:          'Amazon US',
    domain:        'amazon.com',
    dbListings:    'None',
    monetised:     '❌ BUG',
    commissionPath:'Wrong tag — set to UK tag catchcomics-21',
    affiliateId:   'WRONG — see notes',
    feedState:     'NONE — Rainforest retired 2026-07-13',
    feedFid:       'N/A',
    status:        'BUG',
    statusType:    'broken',
    priority:      'P1',
    priorityType:  'p1',
    nextAction:    'Blank NEXT_PUBLIC_AMAZON_US_ASSOCIATE_TAG in Vercel env vars',
    owner:         'Founder',
    reviewDate:    '2026-05-22',
    notes:         'NEXT_PUBLIC_AMAZON_US_ASSOCIATE_TAG incorrectly set to UK tag. Blank it until real US Associates tag obtained.',
  },
  {
    name:          'eBay',
    domain:        'ebay.co.uk',
    dbListings:    'Dynamic (API)',
    monetised:     '✅ LIVE',
    commissionPath:'EPN campid=5339151767',
    affiliateId:   '5339151767',
    feedState:     'Live API — no feed needed',
    feedFid:       'N/A',
    status:        'LIVE',
    statusType:    'live',
    priority:      'None',
    priorityType:  'none',
    nextAction:    'Working. rel=sponsored added to all eBay links.',
    owner:         '—',
    reviewDate:    '2026-07-01',
    notes:         'wrapEpn() applied at mapListing() time. All BIN links pre-wrapped. EbaySection + OffersTable confirmed.',
  },
  {
    name:          'AbeBooks',
    domain:        'abebooks.co.uk',
    dbListings:    'Stubs only',
    monetised:     '❌ PENDING AWIN',
    commissionPath:'AWIN mid=6139 — awaiting approval',
    affiliateId:   '6139',
    feedState:     'Unknown',
    feedFid:       '—',
    status:        'PENDING',
    statusType:    'pending',
    priority:      'P2',
    priorityType:  'p2',
    nextAction:    'Monitor AWIN. No priced listings yet — low priority.',
    owner:         'Founder',
    reviewDate:    '2026-06-04',
    notes:         'Only stubs in DB. Need both AWIN approval AND price data before this earns anything.',
  },
  {
    name:          'WHSmith',
    domain:        'whsmith.co.uk',
    dbListings:    'Stubs only',
    monetised:     '❌ Not viable',
    commissionPath:'TopCashback only — not a publisher affiliate path',
    affiliateId:   '—',
    feedState:     'N/A',
    feedFid:       '—',
    status:        'INACTIVE',
    statusType:    'broken',
    priority:      'None',
    priorityType:  'none',
    nextAction:    'No viable path. Remove from active tracking.',
    owner:         '—',
    reviewDate:    '—',
    notes:         'TopCashback is a cashback site, not a publisher network. Dead end.',
  },
  {
    name:          'Forbidden Planet',
    domain:        'forbiddenplanet.com',
    dbListings:    'Stubs only',
    monetised:     '❓ Unverified',
    commissionPath:'?affiliate=catchcomics query param (unconfirmed)',
    affiliateId:   'catchcomics (env var)',
    feedState:     'N/A — no public API',
    feedFid:       '—',
    status:        'UNKNOWN',
    statusType:    'unknown',
    priority:      'P2',
    priorityType:  'p2',
    nextAction:    'Manual test: follow a /go/ redirect → check if FP tracks attribution',
    owner:         'Founder',
    reviewDate:    '2026-06-04',
    notes:         'FP uses ?affiliate= query param — not a standard network. May not pay commission. Verify with FP directly.',
  },
  {
    name:          'MusicMagpie',
    domain:        'musicmagpie.co.uk',
    dbListings:    'None',
    monetised:     '⚠️ PENDING AWIN',
    commissionPath:'AWIN — pending approval',
    affiliateId:   'TBD',
    feedState:     'Unknown',
    feedFid:       '—',
    status:        'PENDING',
    statusType:    'pending',
    priority:      'P1',
    priorityType:  'p1',
    nextAction:    'Chase AWIN approval — email account manager. Best EPC in pending: £0.26 / 11.88% conversion.',
    owner:         'Founder',
    reviewDate:    '2026-05-29',
    notes:         'Highest EPC and conversion of all pending merchants. Used books = huge catalogue. Prioritise chase.',
  },
]

// ── Build workbook ─────────────────────────────────────────────────────────────

async function main() {
  const wb = new ExcelJS.Workbook()
  wb.creator  = 'Catch Comics'
  wb.created  = new Date()

  const ws = wb.addWorksheet('Retailer Ops', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }],
  })

  // ── Column definitions ───────────────────────────────────────────────────────
  ws.columns = [
    { key: 'name',           width: 22 },
    { key: 'domain',         width: 24 },
    { key: 'dbListings',     width: 22 },
    { key: 'status',         width: 14 },
    { key: 'monetised',      width: 22 },
    { key: 'commissionPath', width: 40 },
    { key: 'affiliateId',    width: 18 },
    { key: 'feedState',      width: 36 },
    { key: 'feedFid',        width: 10 },
    { key: 'priority',       width: 10 },
    { key: 'nextAction',     width: 52 },
    { key: 'owner',          width: 18 },
    { key: 'reviewDate',     width: 14 },
    { key: 'notes',          width: 60 },
  ]

  // ── Title row ────────────────────────────────────────────────────────────────
  ws.mergeCells('A1:N1')
  const titleCell = ws.getCell('A1')
  titleCell.value = 'Catch Comics — Retailer & Monetisation Operations Tracker'
  titleCell.font  = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF' + COLOURS.header.font } }
  titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOURS.header.fill } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(1).height = 28

  // ── Column header row ────────────────────────────────────────────────────────
  const headers = [
    'Retailer', 'Domain', 'DB Listings', 'Status',
    'Monetised?', 'Commission Path', 'Affiliate ID',
    'Feed State', 'Feed FID',
    'Priority', 'Next Action', 'Owner', 'Review Date', 'Notes',
  ]

  const headerRow = ws.getRow(2)
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = h
    cell.font  = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + COLOURS.subheader.font } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOURS.subheader.fill } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFC41F22' } },
    }
  })
  headerRow.height = 22

  // ── Auto-filter on header row (row 2) ────────────────────────────────────────
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 14 } }

  // ── Data rows ────────────────────────────────────────────────────────────────
  retailers.forEach((r, idx) => {
    const rowNum = idx + 3
    const row    = ws.getRow(rowNum)
    row.height   = 40

    const statusColour   = COLOURS[r.statusType   as keyof typeof COLOURS] as { fill: string; font: string }
    const priorityColour = COLOURS[r.priorityType as keyof typeof COLOURS] as { fill: string; font: string }
    const rowBg = idx % 2 === 0 ? 'FFFFFF' : 'F9FAFB'

    const values: Record<string, string> = {
      name:           r.name,
      domain:         r.domain,
      dbListings:     r.dbListings,
      status:         r.status,
      monetised:      r.monetised,
      commissionPath: r.commissionPath,
      affiliateId:    r.affiliateId,
      feedState:      r.feedState,
      feedFid:        r.feedFid,
      priority:       r.priority,
      nextAction:     r.nextAction,
      owner:          r.owner,
      reviewDate:     r.reviewDate,
      notes:          r.notes,
    }

    ws.columns.forEach((col, ci) => {
      const key  = col.key as string
      const cell = row.getCell(ci + 1)
      cell.value = values[key] ?? ''
      cell.font  = { name: 'Calibri', size: 9.5 }
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } },
      }

      // Status column colour
      if (key === 'status') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + statusColour.fill } }
        cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF' + statusColour.font } }
      // Priority column colour
      } else if (key === 'priority') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + priorityColour.fill } }
        cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF' + priorityColour.font } }
      // Retailer name — bold
      } else if (key === 'name') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + rowBg } }
        cell.font = { name: 'Calibri', size: 9.5, bold: true }
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + rowBg } }
      }
    })
  })

  // ── Key sheet ────────────────────────────────────────────────────────────────
  const keyWs = wb.addWorksheet('Key & Env Vars')
  keyWs.columns = [
    { key: 'label', width: 36 },
    { key: 'value', width: 55 },
    { key: 'notes', width: 50 },
  ]

  const keyTitle = keyWs.getRow(1)
  keyWs.mergeCells('A1:C1')
  const ktCell   = keyWs.getCell('A1')
  ktCell.value   = 'Catch Comics — Key & Environment Variable Reference'
  ktCell.font    = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  ktCell.fill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } }
  ktCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  keyTitle.height = 26

  const keyHeaders = ['Variable', 'Value / Setting', 'Notes']
  const kh = keyWs.getRow(2)
  keyHeaders.forEach((h, i) => {
    const cell = kh.getCell(i + 1)
    cell.value = h
    cell.font  = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8272A' } }
    cell.alignment = { vertical: 'middle' }
  })
  kh.height = 20

  const envRows = [
    ['AWIN_PUBLISHER_ID',                      '2888331',                          'Publisher ID for all AWIN merchants'],
    ['AWIN_DATAFEED_KEY',                       'd1657d9787eff1bfc24ded93cbaec889', '⚠️ May be wrong — returning HTTP 400. Re-copy from AWIN → Account → Data Feeds'],
    ['RAINFOREST_API_KEY',                      'REMOVED',                          'Rainforest retired 2026-07-13 (account closed). No code references it — never re-add.'],
    ['NEXT_PUBLIC_AMAZON_UK_ASSOCIATE_TAG',     'catchcomics-21',                   '✅ Correct — UK Associates tag'],
    ['NEXT_PUBLIC_AMAZON_US_ASSOCIATE_TAG',     '(blank)',                          'Was UK tag by mistake — blanked locally 2026-07-13; blank in Vercel too. No US tag exists yet.'],
    ['EBAY_CAMPAIGN_ID',                        '5339151767',                       '✅ EPN campaign ID — confirmed working'],
    ['NEXT_PUBLIC_FORBIDDEN_PLANET_AFFILIATE_CODE', 'catchcomics',                 '❓ Unverified — FP affiliate programme not confirmed active'],
    ['DATABASE_URL',                            'Set (see .env.local)',             'Neon Postgres — eu-west-2'],
    ['',                                        '',                                 ''],
    ['AWIN Status Legend',                      '',                                 ''],
    ['JOINED',                                  'Commission active',                'Links earn commission immediately'],
    ['PENDING',                                 'Application submitted',            'Links redirect correctly but zero commission until approved'],
    ['REJECTED',                                'Application denied',               'Can re-apply. Most rejections allow resubmission.'],
    ['',                                        '',                                 ''],
    ['Priority Legend',                         '',                                 ''],
    ['P0',                                      'Act today',                        'Blocking revenue or causing broken UX'],
    ['P1',                                      'Act this week',                    'High leverage, time-sensitive'],
    ['P2',                                      'Act this month',                   'Important but not blocking'],
  ]

  envRows.forEach((r, i) => {
    const row   = keyWs.getRow(i + 3)
    row.height  = 22
    const bg    = i % 2 === 0 ? 'FFFFFF' : 'F9FAFB'
    r.forEach((val, ci) => {
      const cell = row.getCell(ci + 1)
      cell.value = val
      cell.font  = { name: 'Calibri', size: 9.5 }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bg } }
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
  })

  // ── Write file ────────────────────────────────────────────────────────────────
  const outPath = path.join(process.cwd(), 'retailer-ops.xlsx')
  await wb.xlsx.writeFile(outPath)
  console.log(`\n✓ Generated: ${outPath}`)
  console.log('  Open in Excel or Google Sheets (File → Import).\n')
}

main().catch(err => { console.error(err); process.exit(1) })
