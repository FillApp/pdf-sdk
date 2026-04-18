import { describe, it, expect } from "vitest";
import {
  PdfSdk,
  templateFromJSON,
  templateToJSON,
  type AcroFormField,
  type DropdownField,
  type Field,
  type ListboxField,
  type OverlayField,
  type RadioField,
  type Template,
  type TextField,
} from "../src/index.js";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

/**
 * Round-trip tests for `templateToJSON` / `templateFromJSON`. The contract is
 * that `templateFromJSON(templateToJSON(t))` produces a `Template` that is
 * deep-equal to `t` for every supported variant, with `basePdf` byte-identical.
 *
 * Tests deliberately exercise:
 *   - real fixtures (f1040, choices, flat) so every parser-emitted shape
 *     survives,
 *   - SDK-added overlays so every overlay variant is covered,
 *   - error paths so consumers get useful messages,
 *   - determinism so the JSON is safe to hash / cache.
 */

async function loadF1040(): Promise<PdfSdk> {
  return PdfSdk.load(loadFixture(FIXTURES.f1040));
}
async function loadChoices(): Promise<PdfSdk> {
  return PdfSdk.load(loadFixture(FIXTURES.choices));
}
async function loadFlat(): Promise<PdfSdk> {
  return PdfSdk.load(loadFixture(FIXTURES.flat));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function roundTrip(template: Template): Template {
  return templateFromJSON(templateToJSON(template));
}

describe("templateToJSON / templateFromJSON: happy-path round-trips", () => {
  it("round-trips the f1040 template (text + checkbox coverage)", async () => {
    const sdk = await loadF1040();
    const original = sdk.toTemplate();
    const restored = roundTrip(original);

    expect(restored.metadata).toEqual(original.metadata);
    expect(restored.fields).toEqual(original.fields);
    expect(bytesEqual(restored.basePdf, original.basePdf)).toBe(true);
  });

  it("round-trips the choices template (radio + dropdown + listbox)", async () => {
    const sdk = await loadChoices();
    const original = sdk.toTemplate();
    const restored = roundTrip(original);

    expect(restored.metadata).toEqual(original.metadata);
    expect(restored.fields).toEqual(original.fields);
    expect(bytesEqual(restored.basePdf, original.basePdf)).toBe(true);
  });

  it("round-trips the flat template (no fields)", async () => {
    const sdk = await loadFlat();
    const original = sdk.toTemplate();
    const restored = roundTrip(original);

    expect(restored.metadata).toEqual(original.metadata);
    expect(restored.fields).toEqual([]);
    expect(bytesEqual(restored.basePdf, original.basePdf)).toBe(true);
  });

  it("round-trips a template with all four overlay kinds", async () => {
    const sdk = await loadFlat();
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 50, yPt: 50, widthPt: 200, heightPt: 20 },
      text: {
        value: "round-trip me",
        fontSizePt: 14,
        color: { r: 0.2, g: 0.4, b: 0.6 },
      },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "image",
      page: 0,
      position: { xPt: 50, yPt: 100, widthPt: 60, heightPt: 60 },
      image: {
        bytes: loadFixture(FIXTURES.overlayImage),
        mime: "image/png",
      },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "checkmark",
      page: 0,
      position: { xPt: 200, yPt: 200, widthPt: 24, heightPt: 24 },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "cross",
      page: 0,
      position: { xPt: 250, yPt: 250, widthPt: 24, heightPt: 24 },
      color: { r: 0.8, g: 0.1, b: 0.1 },
    });

    const original = sdk.toTemplate();
    const restored = roundTrip(original);
    expect(restored.fields).toEqual(original.fields);
    expect(bytesEqual(restored.basePdf, original.basePdf)).toBe(true);
  });

  it("round-trips a template with mixed AcroForm + overlay fields", async () => {
    const sdk = await loadChoices();
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 12 },
      text: { value: "hi", fontSizePt: 10 },
    });
    const original = sdk.toTemplate();
    const restored = roundTrip(original);
    expect(restored.fields).toEqual(original.fields);
    // The mixture survived as a mixture, not collapsed.
    expect(restored.fields.some((f) => f.source === "acroform")).toBe(true);
    expect(restored.fields.some((f) => f.source === "overlay")).toBe(true);
  });
});

describe("templateToJSON / templateFromJSON: basePdf integrity", () => {
  it("restores basePdf byte-for-byte (every byte compared)", async () => {
    const sdk = await loadF1040();
    const original = sdk.toTemplate();
    const restored = roundTrip(original);
    expect(restored.basePdf.length).toBe(original.basePdf.length);
    for (let i = 0; i < original.basePdf.length; i++) {
      // Use a guarded check to avoid flooding output on a single mismatch.
      if (restored.basePdf[i] !== original.basePdf[i]) {
        throw new Error(
          `basePdf differs at byte ${i}: got ${restored.basePdf[i]}, expected ${original.basePdf[i]}`,
        );
      }
    }
  });

  it("preserves bytes > 0x7F (binary PDF content)", async () => {
    const sdk = await loadF1040();
    const original = sdk.toTemplate();
    const hasHighByte = original.basePdf.some((b) => b > 0x7f);
    expect(hasHighByte).toBe(true);
    const restored = roundTrip(original);
    expect(bytesEqual(restored.basePdf, original.basePdf)).toBe(true);
  });

  it("round-trips an empty basePdf to a zero-length Uint8Array", () => {
    const empty: Template = {
      basePdf: new Uint8Array(0),
      metadata: { pageCount: 0, pages: [], hasAcroForm: false },
      fields: [],
    };
    const restored = roundTrip(empty);
    expect(restored.basePdf).toBeInstanceOf(Uint8Array);
    expect(restored.basePdf.length).toBe(0);
  });
});

describe("templateToJSON / templateFromJSON: AcroForm variant preservation", () => {
  it("preserves readOnly: true on a field that has it", async () => {
    const sdk = await loadF1040();
    const t = sdk.toTemplate();
    // Synthetically force readOnly on the first acroform field so we have a
    // deterministic case regardless of fixture flags.
    const firstAcro = t.fields.find(
      (f): f is AcroFormField => f.source === "acroform",
    );
    expect(firstAcro).toBeDefined();
    firstAcro!.readOnly = true;
    const restored = roundTrip(t);
    const restoredFirst = restored.fields.find(
      (f) => f.id === firstAcro!.id,
    ) as AcroFormField;
    expect(restoredFirst.readOnly).toBe(true);
  });

  it("preserves maxLength when present, omits it when undefined", async () => {
    const sdk = await loadF1040();
    const t = sdk.toTemplate();
    const texts = t.fields.filter(
      (f): f is TextField =>
        f.source === "acroform" && f.type === "text",
    );
    const withMax = texts.find((f) => f.maxLength !== undefined);
    const withoutMax = texts.find((f) => f.maxLength === undefined);
    expect(withMax).toBeDefined();
    expect(withoutMax).toBeDefined();

    const restored = roundTrip(t);
    const restoredWith = restored.fields.find(
      (f) => f.id === withMax!.id,
    ) as TextField;
    const restoredWithout = restored.fields.find(
      (f) => f.id === withoutMax!.id,
    ) as TextField;

    expect(restoredWith.maxLength).toBe(withMax!.maxLength);
    expect(restoredWithout.maxLength).toBeUndefined();
    expect("maxLength" in restoredWithout).toBe(false);
  });

  it("preserves multiline: true on a text field", async () => {
    const sdk = await loadF1040();
    const t = sdk.toTemplate();
    const text = t.fields.find(
      (f): f is TextField =>
        f.source === "acroform" && f.type === "text",
    )!;
    text.multiline = true;
    const restored = roundTrip(t);
    const r = restored.fields.find((f) => f.id === text.id) as TextField;
    expect(r.multiline).toBe(true);
  });

  it("preserves isMultiSelect on a listbox", async () => {
    const sdk = await loadChoices();
    const t = sdk.toTemplate();
    const lb = t.fields.find(
      (f): f is ListboxField =>
        f.source === "acroform" && f.type === "listbox",
    );
    expect(lb).toBeDefined();
    lb!.isMultiSelect = true;
    const restored = roundTrip(t);
    const r = restored.fields.find((f) => f.id === lb!.id) as ListboxField;
    expect(r.isMultiSelect).toBe(true);
  });

  it("preserves radio widgets[] (page, rect, onValue) and order", async () => {
    const sdk = await loadChoices();
    const t = sdk.toTemplate();
    const radio = t.fields.find(
      (f): f is RadioField =>
        f.source === "acroform" && f.type === "radio",
    );
    expect(radio).toBeDefined();
    expect(radio!.widgets.length).toBeGreaterThan(0);
    const restored = roundTrip(t);
    const r = restored.fields.find((f) => f.id === radio!.id) as RadioField;
    expect(r.widgets).toEqual(radio!.widgets);
  });

  it("preserves options[] order on dropdown", async () => {
    const sdk = await loadChoices();
    const t = sdk.toTemplate();
    const dd = t.fields.find(
      (f): f is DropdownField =>
        f.source === "acroform" && f.type === "dropdown",
    );
    expect(dd).toBeDefined();
    expect(dd!.options).toBeDefined();
    const restored = roundTrip(t);
    const r = restored.fields.find((f) => f.id === dd!.id) as DropdownField;
    expect(r.options).toEqual(dd!.options);
  });

  it("preserves options[] order on listbox", async () => {
    const sdk = await loadChoices();
    const t = sdk.toTemplate();
    const lb = t.fields.find(
      (f): f is ListboxField =>
        f.source === "acroform" && f.type === "listbox",
    );
    expect(lb).toBeDefined();
    expect(lb!.options).toBeDefined();
    const restored = roundTrip(t);
    const r = restored.fields.find((f) => f.id === lb!.id) as ListboxField;
    expect(r.options).toEqual(lb!.options);
  });

  it("preserves the value field for every variant", async () => {
    // Exercise text (string), checkbox (boolean), radio (string), listbox (string[]).
    const choices = await loadChoices();
    const f1040 = await loadF1040();

    const cTemplate = choices.toTemplate();
    const fTemplate = f1040.toTemplate();

    const text = fTemplate.fields.find(
      (f): f is TextField =>
        f.source === "acroform" && f.type === "text",
    )!;
    text.value = "specific text value";

    const checkbox = fTemplate.fields.find(
      (f): f is AcroFormField =>
        f.source === "acroform" && f.type === "checkbox",
    )!;
    (checkbox as Extract<AcroFormField, { type: "checkbox" }>).value = true;

    const radio = cTemplate.fields.find(
      (f): f is RadioField =>
        f.source === "acroform" && f.type === "radio",
    )!;
    if (radio.options && radio.options.length > 0) {
      radio.value = radio.options[0];
    }

    const listbox = cTemplate.fields.find(
      (f): f is ListboxField =>
        f.source === "acroform" && f.type === "listbox",
    )!;
    listbox.value =
      listbox.options && listbox.options.length > 0
        ? [listbox.options[0]]
        : [];

    const restoredF = roundTrip(fTemplate);
    const restoredC = roundTrip(cTemplate);

    const rText = restoredF.fields.find((f) => f.id === text.id) as TextField;
    expect(rText.value).toBe("specific text value");

    const rCheckbox = restoredF.fields.find(
      (f) => f.id === checkbox.id,
    ) as Extract<AcroFormField, { type: "checkbox" }>;
    expect(rCheckbox.value).toBe(true);

    const rRadio = restoredC.fields.find((f) => f.id === radio.id) as RadioField;
    expect(rRadio.value).toBe(radio.value);

    const rLb = restoredC.fields.find(
      (f) => f.id === listbox.id,
    ) as ListboxField;
    expect(rLb.value).toEqual(listbox.value);
  });
});

describe("templateToJSON / templateFromJSON: discriminator preservation", () => {
  it("keeps `source`, `type`, and `kind` discriminators (RadioField stays RadioField)", async () => {
    const sdk = await loadChoices();
    sdk.addOverlay({
      source: "overlay",
      kind: "checkmark",
      page: 0,
      position: { xPt: 10, yPt: 10, widthPt: 12, heightPt: 12 },
    });
    const t = sdk.toTemplate();
    const restored = roundTrip(t);

    for (const original of t.fields) {
      const r = restored.fields.find((f) => f.id === original.id);
      expect(r).toBeDefined();
      expect(r!.source).toBe(original.source);
      if (original.source === "acroform" && r!.source === "acroform") {
        expect(r!.type).toBe(original.type);
      }
      if (original.source === "overlay" && r!.source === "overlay") {
        expect(r!.kind).toBe(original.kind);
      }
    }
  });
});

describe("templateToJSON / templateFromJSON: overlay variant preservation", () => {
  it("text overlay without `color` survives without `color`", async () => {
    const sdk = await loadFlat();
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 12 },
      text: { value: "no color", fontSizePt: 10 },
    });
    const t = sdk.toTemplate();
    const restored = roundTrip(t);
    const overlay = restored.fields[0] as Extract<
      OverlayField,
      { kind: "text" }
    >;
    expect(overlay.kind).toBe("text");
    expect(overlay.text.color).toBeUndefined();
    expect("color" in overlay.text).toBe(false);
  });

  it("text overlay with `color` round-trips exact numeric values", async () => {
    const sdk = await loadFlat();
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 12 },
      text: {
        value: "colored",
        fontSizePt: 10,
        color: { r: 0.123, g: 0.456, b: 0.789 },
      },
    });
    const t = sdk.toTemplate();
    const restored = roundTrip(t);
    const o = restored.fields[0] as Extract<OverlayField, { kind: "text" }>;
    expect(o.text.color).toEqual({ r: 0.123, g: 0.456, b: 0.789 });
  });

  it("image overlay bytes round-trip byte-identical", async () => {
    const sdk = await loadFlat();
    const png = loadFixture(FIXTURES.overlayImage);
    sdk.addOverlay({
      source: "overlay",
      kind: "image",
      page: 0,
      position: { xPt: 10, yPt: 10, widthPt: 60, heightPt: 60 },
      image: { bytes: png, mime: "image/png" },
    });
    const t = sdk.toTemplate();
    const restored = roundTrip(t);
    const o = restored.fields[0] as Extract<OverlayField, { kind: "image" }>;
    expect(o.image.mime).toBe("image/png");
    expect(bytesEqual(o.image.bytes, png)).toBe(true);
  });

  it("checkmark overlay survives with and without `color`", async () => {
    const sdk = await loadFlat();
    sdk.addOverlay({
      source: "overlay",
      kind: "checkmark",
      page: 0,
      position: { xPt: 0, yPt: 0, widthPt: 12, heightPt: 12 },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "checkmark",
      page: 0,
      position: { xPt: 20, yPt: 0, widthPt: 12, heightPt: 12 },
      color: { r: 0.5, g: 0.5, b: 0.5 },
    });
    const t = sdk.toTemplate();
    const restored = roundTrip(t);
    const a = restored.fields[0] as Extract<
      OverlayField,
      { kind: "checkmark" }
    >;
    const b = restored.fields[1] as Extract<
      OverlayField,
      { kind: "checkmark" }
    >;
    expect(a.color).toBeUndefined();
    expect("color" in a).toBe(false);
    expect(b.color).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });

  it("cross overlay survives with and without `color`", async () => {
    const sdk = await loadFlat();
    sdk.addOverlay({
      source: "overlay",
      kind: "cross",
      page: 0,
      position: { xPt: 0, yPt: 0, widthPt: 12, heightPt: 12 },
    });
    sdk.addOverlay({
      source: "overlay",
      kind: "cross",
      page: 0,
      position: { xPt: 20, yPt: 0, widthPt: 12, heightPt: 12 },
      color: { r: 0.1, g: 0.2, b: 0.3 },
    });
    const t = sdk.toTemplate();
    const restored = roundTrip(t);
    const a = restored.fields[0] as Extract<OverlayField, { kind: "cross" }>;
    const b = restored.fields[1] as Extract<OverlayField, { kind: "cross" }>;
    expect(a.color).toBeUndefined();
    expect("color" in a).toBe(false);
    expect(b.color).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
  });
});

describe("templateToJSON / templateFromJSON: error paths", () => {
  it("throws a useful error on non-JSON input", () => {
    expect(() => templateFromJSON("not json")).toThrow(/not valid JSON/i);
  });

  it("throws naming the version when version is unknown", () => {
    const json = JSON.stringify({ version: 2, basePdfBase64: "" });
    expect(() => templateFromJSON(json)).toThrow(/version/i);
    expect(() => templateFromJSON(json)).toThrow(/2/);
  });

  it("throws naming the missing version field on `{}`", () => {
    expect(() => templateFromJSON("{}")).toThrow(/version/);
  });

  it("throws naming basePdfBase64 when it is missing", () => {
    expect(() => templateFromJSON('{"version":1}')).toThrow(/basePdfBase64/);
  });

  it("throws cleanly on malformed base64 in basePdfBase64", () => {
    const json = JSON.stringify({
      version: 1,
      basePdfBase64: "!!!not base64!!!",
      metadata: { pageCount: 0, pages: [], hasAcroForm: false },
      fields: [],
    });
    expect(() => templateFromJSON(json)).toThrow(/base64/i);
  });

  it("throws naming the offending key when metadata is missing", () => {
    const json = JSON.stringify({ version: 1, basePdfBase64: "" });
    expect(() => templateFromJSON(json)).toThrow(/metadata/);
  });

  it("throws naming the offending field index when a field is malformed", () => {
    const json = JSON.stringify({
      version: 1,
      basePdfBase64: "",
      metadata: { pageCount: 0, pages: [], hasAcroForm: false },
      fields: [{ source: "acroform" }],
    });
    expect(() => templateFromJSON(json)).toThrow(/template\.fields\[0\]/);
  });

  it("rejects a top-level non-object payload", () => {
    expect(() => templateFromJSON("[]")).toThrow(/object/i);
  });
});

describe("templateToJSON / templateFromJSON: determinism + format", () => {
  it("produces identical strings on two consecutive calls with the same Template", async () => {
    const sdk = await loadChoices();
    sdk.addOverlay({
      source: "overlay",
      kind: "text",
      page: 0,
      position: { xPt: 1, yPt: 2, widthPt: 3, heightPt: 4 },
      text: { value: "x", fontSizePt: 12 },
    });
    const t = sdk.toTemplate();
    const a = templateToJSON(t);
    const b = templateToJSON(t);
    expect(a).toBe(b);
  });

  it("produces output that JSON.parse accepts", async () => {
    const sdk = await loadF1040();
    const json = templateToJSON(sdk.toTemplate());
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("produces multi-line, human-readable output (2-space indent)", async () => {
    const sdk = await loadFlat();
    const json = templateToJSON(sdk.toTemplate());
    expect(json.includes("\n")).toBe(true);
    expect(json.includes('\n  "version"')).toBe(true);
  });

  it("survives a second round-trip identically (toJSON ∘ fromJSON ∘ toJSON ≡ toJSON)", async () => {
    const sdk = await loadChoices();
    const t = sdk.toTemplate();
    const json1 = templateToJSON(t);
    const restored = templateFromJSON(json1);
    const json2 = templateToJSON(restored);
    expect(json2).toBe(json1);
  });
});

describe("templateToJSON / templateFromJSON: purity", () => {
  it("does not mutate the input Template on serialize", async () => {
    const sdk = await loadChoices();
    const t = sdk.toTemplate();
    const before = JSON.stringify(t.metadata) + "|" + t.fields.length;
    templateToJSON(t);
    const after = JSON.stringify(t.metadata) + "|" + t.fields.length;
    expect(after).toBe(before);
  });

  it("returns a fresh Template (mutating the result does not affect re-deserialization)", async () => {
    const sdk = await loadFlat();
    const json = templateToJSON(sdk.toTemplate());
    const a = templateFromJSON(json);
    a.fields.push({
      id: "overlay:injected",
      source: "overlay",
      kind: "checkmark",
      page: 0,
      position: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
    } as Field);
    const b = templateFromJSON(json);
    expect(b.fields.length).toBe(0);
  });
});
