/**
 * Coordinate and byte utilities. The SDK stores everything in PDF points
 * (bottom-left origin). Consumers convert at the edge when they need other units.
 */

// Derived from exact ratios so the values cannot drift.
const MM_PER_PT = 25.4 / 72; // 1 pt = 1/72 inch; 1 inch = 25.4 mm
const PX_PER_PT = 96 / 72; // 96 CSS px per inch, 72 pt per inch

export function ptToMm(pt: number): number {
  return pt * MM_PER_PT;
}

export function mmToPt(mm: number): number {
  return mm / MM_PER_PT;
}

export function pxToPt(px: number): number {
  return px / PX_PER_PT;
}

export function ptToPx(pt: number): number {
  return pt * PX_PER_PT;
}

/**
 * Flip Y between PDF (bottom-left origin) and UI (top-left origin).
 * `heightPt` is the widget height; omitting it would give the *point's* flip,
 * not the widget's top edge, so it is required.
 */
export function flipY(
  yPt: number,
  pageHeightPt: number,
  heightPt: number,
): number {
  return pageHeightPt - yPt - heightPt;
}

/** Runtime-safe base64 decode. Works in Node ≥18 and browsers (atob). */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^,]+,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Runtime-safe base64 encode. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Normalize any supported input into a Uint8Array. */
export async function normalizeInput(
  input: Uint8Array | ArrayBuffer | Blob | string,
): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  if (typeof input === "string") return base64ToBytes(input);
  throw new Error("Unsupported input type");
}
