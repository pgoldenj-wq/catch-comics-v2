#!/usr/bin/env tsx
/**
 * scripts/normalise-publishers.ts
 *
 * Normalises verbose publisher names from Open Library / Google Books into
 * the clean display names used on product pages and the homepage.
 *
 * Open Library often returns legal entity names like "Marvel Worldwide, Incorporated"
 * instead of the consumer-facing brand name "Marvel". This script collapses them.
 *
 * Rules: only remap if the current DB value STARTS WITH or CONTAINS the verbose form.
 * Never overwrite a value that is already the clean form.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/normalise-publishers.ts           # dry-run
 *   npx dotenv -e .env.local -- npx tsx scripts/normalise-publishers.ts --write   # apply
 */

import { prisma } from '../lib/prisma'

const WRITE = process.argv.includes('--write')

/**
 * Normalisation map — built from the agent's full publisher audit.
 * Key   = regex that matches the raw DB publisher value (tested against full string)
 * Value = the clean display name to store instead
 *
 * Order matters: more specific patterns must come before broader ones.
 * Patterns that are already the canonical form are included as ^exact$ matches
 * so they return null (no-op) from the normalise() function below.
 */
const NORMALISE: Array<{ match: RegExp; canonical: string }> = [
  // ── Marvel ──────────────────────────────────────────────────────────────────
  { match: /marvel worldwide/i,                       canonical: 'Marvel' },
  { match: /marvel comics/i,                          canonical: 'Marvel' },
  // "Marvel" alone is already correct — no rule needed

  // ── DC ──────────────────────────────────────────────────────────────────────
  { match: /dc comics/i,                              canonical: 'DC Comics' },
  { match: /^dc$/i,                                   canonical: 'DC Comics' },

  // ── Viz Media — 9 variants found in DB ─────────────────────────────────────
  // Must handle: "VIZ Media LLC", "VIZ Media, LLC", "Viz Media LLC",
  //              "Viz Media, LLC.", "VIZ  Media" (double space), "Viz MediA"
  { match: /viz\s+medi/i,                             canonical: 'Viz Media' }, // catches all spacing/case variants
  { match: /^viz$/i,                                  canonical: 'Viz Media' },
  { match: /shogakukan manga/i,                       canonical: 'Viz Media' }, // Shogakukan is Viz's JP parent for manga

  // ── Yen Press — 3 variants ──────────────────────────────────────────────────
  { match: /yen press\s*(llc)?\.?$/i,                 canonical: 'Yen Press' },
  { match: /^yen pr$/i,                               canonical: 'Yen Press' },

  // ── Seven Seas — 3 variants ─────────────────────────────────────────────────
  { match: /seven seas (entertainment|comics),?\s*(llc)?\.?$/i, canonical: 'Seven Seas' },
  { match: /^seven seas$/i,                           canonical: 'Seven Seas' },

  // ── Kodansha — 7 variants ───────────────────────────────────────────────────
  { match: /kodansha\s*(america|comics|usa|international)\s*(publishing)?,?\s*(inc(orporated)?|llc)?\.?$/i,
                                                      canonical: 'Kodansha' },
  { match: /^kodansha\.?$/i,                          canonical: 'Kodansha' },

  // ── Dark Horse — 4 variants ─────────────────────────────────────────────────
  { match: /dark horse (comics|books|manga)/i,        canonical: 'Dark Horse Comics' },
  { match: /^dark horse$/i,                           canonical: 'Dark Horse Comics' },

  // ── Image Comics ────────────────────────────────────────────────────────────
  { match: /image comics/i,                           canonical: 'Image Comics' },
  { match: /^image$/i,                                canonical: 'Image Comics' },

  // ── TOKYOPOP — 4 variants ───────────────────────────────────────────────────
  { match: /tokyopop,?\s*(inc(orporated)?)?\.?$/i,    canonical: 'Tokyopop' },

  // ── Square Enix — 3 variants ────────────────────────────────────────────────
  { match: /square enix manga/i,                      canonical: 'Square Enix Manga' },
  { match: /square enix books/i,                      canonical: 'Square Enix' },
  { match: /square enix/i,                            canonical: 'Square Enix' },

  // ── IDW ─────────────────────────────────────────────────────────────────────
  { match: /idw publishing/i,                         canonical: 'IDW Publishing' },
  { match: /^idw$/i,                                  canonical: 'IDW Publishing' },

  // ── BOOM! Studios ───────────────────────────────────────────────────────────
  { match: /boom!?\s*studios/i,                       canonical: 'BOOM! Studios' },
  { match: /^boom$/i,                                 canonical: 'BOOM! Studios' },

  // ── Vertical ────────────────────────────────────────────────────────────────
  { match: /vertical,?\s*(inc(orporated)?|inc\.?)?$/i, canonical: 'Vertical' },

  // ── SuBLime (Seven Seas BL imprint) ─────────────────────────────────────────
  { match: /sublime/i,                                canonical: 'SuBLime' },

  // ── Del Rey ──────────────────────────────────────────────────────────────────
  { match: /del rey manga/i,                          canonical: 'Del Rey Manga' },
  { match: /del rey/i,                                canonical: 'Del Rey' },

  // ── Fantagraphics ────────────────────────────────────────────────────────────
  { match: /fantagraphics/i,                          canonical: 'Fantagraphics' },

  // ── Drawn & Quarterly ────────────────────────────────────────────────────────
  { match: /drawn\s*(and|&)\s*quarterly/i,            canonical: 'Drawn & Quarterly' },

  // ── Oni Press ────────────────────────────────────────────────────────────────
  { match: /oni press/i,                              canonical: 'Oni Press' },

  // ── Dynamite ─────────────────────────────────────────────────────────────────
  { match: /dynamite entertainment/i,                 canonical: 'Dynamite' },
  { match: /^dynamite$/i,                             canonical: 'Dynamite' },

  // ── Titan Comics ─────────────────────────────────────────────────────────────
  { match: /titan comics/i,                           canonical: 'Titan Comics' },

  // ── Ablaze ───────────────────────────────────────────────────────────────────
  { match: /ablaze/i,                                 canonical: 'Ablaze' },

  // ── Ghost Ship (Seven Seas adult imprint) ────────────────────────────────────
  { match: /ghost ship/i,                             canonical: 'Ghost Ship' },

  // ── Valiant ──────────────────────────────────────────────────────────────────
  { match: /valiant (entertainment|comics)/i,         canonical: 'Valiant' },

  // ── Archie Comics ────────────────────────────────────────────────────────────
  { match: /archie comics/i,                          canonical: 'Archie Comics' },

  // ── "Unknown" publisher values → null out (handled separately below) ─────────
  // Not in the NORMALISE map — handled in normalise() function directly
]

/** Extra: values to NULL out rather than normalise to a clean name. */
const NULL_OUT = /^unknown(\s+publisher)?$/i

/** Returns the canonical name, '' to null-out, or null (no change). */
function normalise(raw: string): string | null | '' {
  if (NULL_OUT.test(raw.trim())) return ''   // sentinel: set to NULL in DB
  for (const rule of NORMALISE) {
    if (rule.match.test(raw)) {
      if (rule.canonical === raw) return null  // already the canonical form
      return rule.canonical
    }
  }
  return null   // no match — leave as-is
}

async function main() {
  console.log(`\nPublisher normalisation — ${WRITE ? '⚡ WRITE' : 'DRY RUN'}\n`)

  // Load all distinct publishers
  const rows = await prisma.$queryRaw<Array<{ publisher: string; count: bigint }>>`
    SELECT publisher, COUNT(*) AS count
    FROM canonical_products
    WHERE publisher IS NOT NULL
    GROUP BY publisher
    ORDER BY count DESC
  `

  console.log(`  Distinct publisher values: ${rows.length}\n`)

  type Change = { from: string; to: string | null; count: number; nullOut: boolean }
  const changes:   Change[] = []
  const unchanged: string[] = []

  for (const row of rows) {
    const target = normalise(row.publisher)
    if (target === null) {
      unchanged.push(row.publisher)
    } else if (target === '') {
      // null-out — "Unknown" etc.
      changes.push({ from: row.publisher, to: null, count: Number(row.count), nullOut: true })
    } else {
      changes.push({ from: row.publisher, to: target, count: Number(row.count), nullOut: false })
    }
  }

  if (changes.length === 0) {
    console.log('  ✓ All publisher values already normalised — nothing to do.')
    return
  }

  console.log(`  Will normalise ${changes.length} publisher values (${changes.reduce((s, c) => s + c.count, 0)} rows):\n`)
  for (const c of changes) {
    const arrow = c.nullOut ? '→ NULL' : `→ "${c.to}"`
    console.log(`    "${c.from}" ${arrow}  (${c.count} products)`)
  }

  console.log(`\n  Unchanged (${unchanged.length}):`)
  for (const p of unchanged.slice(0, 30)) {
    console.log(`    "${p}"`)
  }
  if (unchanged.length > 30) console.log(`    … and ${unchanged.length - 30} more`)

  if (!WRITE) {
    console.log('\n  [dry-run] No changes written.')
    return
  }

  // Apply changes
  let totalUpdated = 0
  for (const c of changes) {
    if (c.nullOut) {
      const result = await prisma.canonicalProduct.updateMany({
        where: { publisher: c.from },
        data:  { publisher: null },
      })
      totalUpdated += result.count
      console.log(`  Nulled : "${c.from}" (${result.count} rows)`)
    } else {
      const result = await prisma.canonicalProduct.updateMany({
        where: { publisher: c.from },
        data:  { publisher: c.to! },
      })
      totalUpdated += result.count
      console.log(`  Updated: "${c.from}" → "${c.to}" (${result.count} rows)`)
    }
  }

  console.log(`\n  ✓ Total rows updated: ${totalUpdated}`)
}

main()
  .catch(err => { console.error('\n❌ Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
