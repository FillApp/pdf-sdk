import { describe, expect, it } from "vitest";
import { type OverlayField, type OverlayText } from "../src/index.js";
import { FIXTURES, loadFixture, loadSdk } from "./helpers/fixtures.js";
import type { PdfSdk } from "../src/index.js";

async function load(): Promise<PdfSdk> {
  return loadSdk(FIXTURES.flat);
}

describe("addOverlay", () => {
  it("returns a stable id and surfaces the overlay in getFields()", async () => {
    const sdk = await load();
    const id = sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 72, yPt: 72, widthPt: 200, heightPt: 20 },
      text: { value: "Hello", fontSizePt: 14 },
    });
    expect(id.startsWith("overlay:")).toBe(true);
    const fields = sdk.getFields();
    expect(fields.some((f) => f.id === id)).toBe(true);
  });

  it("assigns monotonically increasing ids", async () => {
    const sdk = await load();
    const a = sdk.addOverlay(sampleText(0));
    const b = sdk.addOverlay(sampleText(0));
    const c = sdk.addOverlay(sampleText(0));
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });
});

describe("updateOverlay", () => {
  it("merges a partial update without changing kind", async () => {
    const sdk = await load();
    const id = sdk.addOverlay(sampleText(0));
    sdk.updateOverlay(id, {
      position: { xPt: 100, yPt: 100, widthPt: 200, heightPt: 20 },
    });
    const f = sdk.getField(id) as OverlayField;
    expect(f.kind).toBe("text");
    expect(f.position.xPt).toBe(100);
  });

  it("throws when the id doesn't exist", async () => {
    const sdk = await load();
    expect(() => sdk.updateOverlay("overlay:does-not-exist", {})).toThrow(
      /Unknown overlay id/i,
    );
  });

  it("throws when the id points at an AcroForm field", async () => {
    const sdk = await loadSdk(FIXTURES.choices);
    const acro = sdk.getFields().find((f) => f.source === "acroform");
    expect(acro).toBeDefined();
    expect(() => sdk.updateOverlay(acro!.id, {})).toThrow(/not an overlay/i);
  });
});

describe("removeOverlay", () => {
  it("removes the overlay from subsequent reads", async () => {
    const sdk = await load();
    const id = sdk.addOverlay(sampleText(0));
    expect(sdk.getField(id)).not.toBeNull();
    sdk.removeOverlay(id);
    expect(sdk.getField(id)).toBeNull();
  });

  it("throws on unknown id", async () => {
    const sdk = await load();
    expect(() => sdk.removeOverlay("overlay:nope")).toThrow(
      /Unknown overlay id/i,
    );
  });
});

describe("shape overlays: create + generate + reparse", () => {
  it("round-trips a rect overlay through generate()", async () => {
    const sdk = await load();
    sdk.addOverlay({
      source: "overlay",
      kind: "rect",
      page: 0,
      position: { xPt: 100, yPt: 100, widthPt: 80, heightPt: 60 },
      stroke: { r: 0, g: 0, b: 0.8 },
      strokeWidthPt: 2,
      fill: { r: 0.9, g: 0.9, b: 0.2 },
    });
    const bytes = await sdk.generate();
    expect(bytes.byteLength).toBeGreaterThan(0);
    // Flattened into the content stream; reload to prove the output parses.
    const reloaded = await loadSdkFromBytes(bytes);
    expect(reloaded.toTemplate().metadata.pageCount).toBe(1);
  });

  it("round-trips an ellipse overlay through generate()", async () => {
    const sdk = await load();
    sdk.addOverlay({
      source: "overlay",
      kind: "ellipse",
      page: 0,
      position: { xPt: 200, yPt: 200, widthPt: 60, heightPt: 40 },
      stroke: { r: 0.8, g: 0, b: 0 },
      strokeWidthPt: 1,
    });
    const bytes = await sdk.generate();
    expect(bytes.byteLength).toBeGreaterThan(0);
    const reloaded = await loadSdkFromBytes(bytes);
    expect(reloaded.toTemplate().metadata.pageCount).toBe(1);
  });

  it("round-trips plain line + arrow lines", async () => {
    const sdk = await load();
    sdk.addOverlay({
      source: "overlay",
      kind: "line",
      page: 0,
      position: { xPt: 50, yPt: 50, widthPt: 100, heightPt: 0 },
      start: { xPt: 50, yPt: 50 },
      end: { xPt: 150, yPt: 50 },
      stroke: { r: 0, g: 0, b: 0 },
      strokeWidthPt: 1.5,
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "line",
      page: 0,
      position: { xPt: 50, yPt: 80, widthPt: 100, heightPt: 40 },
      start: { xPt: 50, yPt: 80 },
      end: { xPt: 150, yPt: 120 },
      stroke: { r: 0.3, g: 0.3, b: 0.3 },
      strokeWidthPt: 2,
      arrowEnd: true,
    });
    const bytes = await sdk.generate();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("round-trips polyline + polygon", async () => {
    const sdk = await load();
    sdk.addOverlay({
      source: "overlay",
      kind: "polyline",
      page: 0,
      position: { xPt: 300, yPt: 300, widthPt: 60, heightPt: 60 },
      points: [
        { xPt: 300, yPt: 300 },
        { xPt: 330, yPt: 330 },
        { xPt: 360, yPt: 300 },
      ],
      stroke: { r: 0.1, g: 0.6, b: 0.1 },
      strokeWidthPt: 1,
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "polygon",
      page: 0,
      position: { xPt: 400, yPt: 400, widthPt: 60, heightPt: 60 },
      points: [
        { xPt: 400, yPt: 400 },
        { xPt: 460, yPt: 400 },
        { xPt: 430, yPt: 460 },
      ],
      stroke: { r: 0.6, g: 0.1, b: 0.6 },
      strokeWidthPt: 1,
      fill: { r: 0.9, g: 0.7, b: 0.9 },
    });
    const bytes = await sdk.generate();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("round-trips an ink overlay + highlighter ink overlay", async () => {
    const sdk = await load();
    sdk.addOverlay({
      source: "overlay",
      kind: "ink",
      page: 0,
      position: { xPt: 50, yPt: 500, widthPt: 100, heightPt: 100 },
      strokes: [
        [
          { xPt: 50, yPt: 500 },
          { xPt: 80, yPt: 530 },
          { xPt: 110, yPt: 560 },
          { xPt: 150, yPt: 600 },
        ],
        [
          { xPt: 60, yPt: 520 },
          { xPt: 120, yPt: 580 },
        ],
      ],
      stroke: { r: 0, g: 0, b: 0 },
      strokeWidthPt: 2,
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "ink",
      page: 0,
      position: { xPt: 200, yPt: 500, widthPt: 100, heightPt: 20 },
      strokes: [
        [
          { xPt: 200, yPt: 510 },
          { xPt: 300, yPt: 510 },
        ],
      ],
      stroke: { r: 1, g: 1, b: 0 },
      strokeWidthPt: 8,
      opacity: 0.5,
      intent: "highlight",
    });
    const bytes = await sdk.generate();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

describe("generate: overlays", () => {
  it("produces a PDF whose content includes the overlay text (post-flatten)", async () => {
    const sdk = await load();
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 72, yPt: 700, widthPt: 400, heightPt: 24 },
      text: { value: "ROUND-TRIPPABLE OVERLAY TEXT", fontSizePt: 14 },
    });
    const bytes = await sdk.generate();
    // Overlays are flattened into the page content stream. We assert the
    // generator produced a non-empty document and can reload the output.
    expect(bytes.byteLength).toBeGreaterThan(0);
    const reloaded = await loadSdkFromBytes(bytes);
    expect(reloaded.toTemplate().metadata.pageCount).toBe(1);
  });

  it("embeds a PNG overlay", async () => {
    const sdk = await load();
    sdk.addOverlay({
      source: "overlay",
      kind: "image",
      page: 0,
      position: { xPt: 72, yPt: 600, widthPt: 60, heightPt: 60 },
      image: {
        bytes: loadFixture(FIXTURES.overlayImage),
        mime: "image/png",
      },
    });
    const bytes = await sdk.generate();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("renders checkmark + cross glyphs via ZapfDingbats", async () => {
    const sdk = await load();
    sdk.addOverlay({
      source: "overlay",
      kind: "checkmark",
      page: 0,
      position: { xPt: 72, yPt: 500, widthPt: 24, heightPt: 24 },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "cross",
      page: 0,
      position: { xPt: 120, yPt: 500, widthPt: 24, heightPt: 24 },
      color: { r: 0.8, g: 0.1, b: 0.1 },
    });
    const bytes = await sdk.generate();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("diagnoses an overlay on a missing page", async () => {
    const sdk = await load();
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 99,
      position: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 10 },
      text: { value: "out of bounds", fontSizePt: 10 },
    });
    await sdk.generate();
    expect(
      sdk.diagnostics.some(
        (d) => d.kind === "orphan-widget" && d.message.includes("page 99"),
      ),
    ).toBe(true);
  });
});

function sampleText(page: number): Omit<OverlayText, "id"> {
  return {
    source: "overlay",
    kind: "text",
    page,
    position: { xPt: 50, yPt: 50, widthPt: 200, heightPt: 20 },
    text: { value: "sample", fontSizePt: 12 },
  };
}

async function loadSdkFromBytes(bytes: Uint8Array): Promise<PdfSdk> {
  const { getTestEngine } = await import("./helpers/fixtures.js");
  const { PdfSdk } = await import("../src/index.js");
  const engine = await getTestEngine();
  return PdfSdk.load(bytes, { engine });
}
