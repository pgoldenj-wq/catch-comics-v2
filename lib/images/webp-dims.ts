/**
 * Read a WebP's pixel dimensions from its RIFF header — the first 30 bytes are
 * enough, so a stored cover can be measured with an HTTP Range request instead
 * of a full download. Returns null for anything that is not a WebP.
 */
export function webpDims(b: Uint8Array): { w: number; h: number } | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunk = buf.toString('ascii', 12, 16)
  if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 }
  return null
}

/**
 * The width of the cover ARTWORK inside a stored image, in pixels. Covers are
 * rendered object-fit: cover in 2:3 frames, so a 200x200 letterboxed retailer
 * thumbnail only contributes ~133px of real cover width — the white bars are
 * cropped away. min(width, height/1.5) is that usable width for any shape.
 */
export function effectiveCoverWidth(w: number, h: number): number {
  return Math.round(Math.min(w, h / 1.5))
}
