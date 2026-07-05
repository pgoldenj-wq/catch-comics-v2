/**
 * Small, dependency-free helpers for hardening public HTTP handlers.
 */

/**
 * Parse `raw` as a base-10 integer and clamp it into the inclusive range
 * [min, max]. Missing, non-numeric, NaN, or Infinity input returns `fallback`
 * (which is assumed to already sit within range).
 *
 * Used to cap unbounded pagination inputs so a request like `?pageSize=1000000`
 * cannot amplify a database query or response payload.
 */
export function clampInt(
  raw: string | null | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
