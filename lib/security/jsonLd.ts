/**
 * Safe serialization for JSON-LD embedded via dangerouslySetInnerHTML.
 *
 * `JSON.stringify` does NOT escape `<`, `>`, `&`, or the JS line terminators
 * U+2028 / U+2029. A DB / Comic Vine / retailer-sourced string containing
 * `</script>` (e.g. a poisoned product title) would therefore break out of the
 * surrounding `<script type="application/ld+json">` element and execute in the
 * visitor's browser (stored XSS).
 *
 * Escaping those characters to their `\uXXXX` JSON escapes keeps the output a
 * valid JSON string — parsers (and Google's structured-data crawler) decode it
 * back to the original characters — while making script-tag breakout impossible.
 *
 * Reference: OWASP XSS Prevention Cheat Sheet, "Safely embedding JSON in HTML".
 */

// U+2028 / U+2029 are built with fromCharCode so no literal line-terminator
// characters appear in this source file (they would break parsing).
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)
const UNSAFE_JSONLD_CHARS = new RegExp(
  '[<>&' + LINE_SEPARATOR + PARAGRAPH_SEPARATOR + ']',
  'g',
)

export function jsonLdScriptString(data: unknown): string {
  return JSON.stringify(data).replace(UNSAFE_JSONLD_CHARS, (ch) => {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  })
}
