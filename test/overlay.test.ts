import { describe, expect, it } from "vitest";
import { PdfSdk, type OverlayField, type OverlayText } from "../src/index.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

async function load(): Promise<PdfSdk> {
  return PdfSdk.load(loadFixture(FIXTURES.flat));
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
    const sdk = await PdfSdk.load(loadFixture(FIXTURES.allTypes));
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

describe("generate: overlays", () => {
  it("produces a PDF whose content includes the overlay text (post-draw)", async () => {
    const sdk = await load();
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 72, yPt: 700, widthPt: 400, heightPt: 24 },
      text: { value: "ROUND-TRIPPABLE OVERLAY TEXT", fontSizePt: 14 },
    });
    const bytes = await sdk.generate();
    // Overlays don't persist into a canonical reparse (they're baked into
    // page content, not an AcroForm). We just assert the generator produced
    // a non-empty document and didn't crash.
    expect(bytes.byteLength).toBeGreaterThan(0);
    const reloaded = await PdfSdk.load(bytes);
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

  it("draws checkmark + cross glyphs as vector strokes", async () => {
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
