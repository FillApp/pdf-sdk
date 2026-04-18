import { describe, it, expect } from "vitest";
import {
  ptToMm,
  mmToPt,
  pxToPt,
  ptToPx,
  flipY,
  base64ToBytes,
  bytesToBase64,
  normalizeInput,
} from "../src/utils.js";

describe("unit conversions", () => {
  it("converts pt ↔ mm with millimeter-level precision", () => {
    expect(ptToMm(72)).toBeCloseTo(25.4, 3); // 1 inch
    expect(mmToPt(25.4)).toBeCloseTo(72, 3);
  });

  it("round-trips pt → mm → pt without loss", () => {
    const pt = 123.456;
    expect(mmToPt(ptToMm(pt))).toBeCloseTo(pt, 5);
  });

  it("converts pt ↔ px at 96 DPI", () => {
    expect(ptToPx(72)).toBeCloseTo(96, 3);
    expect(pxToPt(96)).toBeCloseTo(72, 3);
  });
});

describe("flipY", () => {
  it("flips a point-height widget (heightPt=0)", () => {
    expect(flipY(100, 792, 0)).toBe(692);
  });

  it("is symmetric — flipping twice returns the original", () => {
    const pageHeight = 792;
    const h = 18;
    const y = 300;
    expect(flipY(flipY(y, pageHeight, h), pageHeight, h)).toBe(y);
  });

  it("accounts for field height when converting a widget rect", () => {
    expect(flipY(100, 792, 20)).toBe(672);
  });
});

describe("base64 encoding", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const b64 = bytesToBase64(bytes);
    const back = base64ToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it("strips data-URL prefix when decoding", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const b64 = bytesToBase64(bytes);
    const dataUrl = `data:application/pdf;base64,${b64}`;
    expect(Array.from(base64ToBytes(dataUrl))).toEqual([1, 2, 3]);
  });

  it("handles empty input", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
    expect(base64ToBytes("").length).toBe(0);
  });
});

describe("normalizeInput", () => {
  it("passes Uint8Array through unchanged", async () => {
    const u = new Uint8Array([1, 2, 3]);
    expect(await normalizeInput(u)).toBe(u);
  });

  it("converts ArrayBuffer to Uint8Array", async () => {
    const ab = new ArrayBuffer(3);
    new Uint8Array(ab).set([4, 5, 6]);
    const out = await normalizeInput(ab);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([4, 5, 6]);
  });

  it("decodes base64 string", async () => {
    const out = await normalizeInput(bytesToBase64(new Uint8Array([7, 8, 9])));
    expect(Array.from(out)).toEqual([7, 8, 9]);
  });

  it("converts Blob when available", async () => {
    if (typeof Blob === "undefined") return;
    const blob = new Blob([new Uint8Array([10, 11])]);
    const out = await normalizeInput(blob);
    expect(Array.from(out)).toEqual([10, 11]);
  });

  it("throws on unsupported input", async () => {
    await expect(
      // @ts-expect-error — testing runtime guard
      normalizeInput(42),
    ).rejects.toThrow(/Unsupported input/);
  });
});
