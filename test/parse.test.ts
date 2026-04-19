import { describe, it, expect, beforeAll } from "vitest";
import {
  PdfSdk,
  parseToTemplate,
  type AcroFormField,
  type Template,
} from "../src/index.js";
import {
  FIXTURES,
  getTestEngine,
  loadFixture,
  loadSdk,
} from "./helpers/fixtures.js";

describe("parse: f1040 (primary legal-form fixture)", () => {
  let sdk: PdfSdk;
  let template: Template;
  let fields: AcroFormField[];

  beforeAll(async () => {
    sdk = await loadSdk(FIXTURES.f1040);
    template = sdk.toTemplate();
    fields = template.fields.filter(
      (f): f is AcroFormField => f.source === "acroform",
    );
  });

  describe("document metadata", () => {
    it("reports 2 pages at US Letter size", () => {
      expect(template.metadata.pageCount).toBe(2);
      for (const p of template.metadata.pages) {
        expect(p.widthPt).toBe(612);
        expect(p.heightPt).toBe(792);
      }
    });

    it("flags hasAcroForm: true", () => {
      expect(template.metadata.hasAcroForm).toBe(true);
    });
  });

  describe("field extraction", () => {
    it("extracts every text and checkbox field", () => {
      const textCount = fields.filter((f) => f.type === "text").length;
      const checkboxCount = fields.filter((f) => f.type === "checkbox").length;
      expect(textCount).toBeGreaterThan(100);
      expect(checkboxCount).toBeGreaterThan(50);
      // f1040 does not carry radio / dropdown / listbox fields.
      expect(fields.filter((f) => f.type === "radio")).toHaveLength(0);
      expect(fields.filter((f) => f.type === "dropdown")).toHaveLength(0);
      expect(fields.filter((f) => f.type === "listbox")).toHaveLength(0);
    });

    it("assigns every field to a valid page", () => {
      for (const f of fields) {
        expect(f.page).toBeGreaterThanOrEqual(0);
        expect(f.page).toBeLessThan(template.metadata.pageCount);
      }
    });

    it("gives every field a distinct, URL-safe id prefixed with acro:", () => {
      const ids = new Set(fields.map((f) => f.id));
      expect(ids.size).toBe(fields.length);
      for (const f of fields) {
        expect(f.id).toMatch(/^acro:[A-Za-z0-9_-]+:\d+$/);
      }
    });

    it("preserves hierarchical PDF field names as-is in acroFieldName", () => {
      // f1040 uses topmostSubform[0].Page1[0].f1_NN[0] everywhere — a good
      // stress test for the parser's name handling.
      expect(
        fields.some((f) => f.acroFieldName.includes("topmostSubform[0]")),
      ).toBe(true);
    });

    it("extracts rectangles in PDF points with positive dimensions", () => {
      for (const f of fields) {
        expect(f.position.widthPt).toBeGreaterThan(0);
        expect(f.position.heightPt).toBeGreaterThan(0);
      }
    });
  });
});

describe("parse: choices (supplementary fixture for radio/dropdown/listbox)", () => {
  let fields: AcroFormField[];
  let sdk: PdfSdk;

  beforeAll(async () => {
    sdk = await loadSdk(FIXTURES.choices);
    fields = sdk
      .toTemplate()
      .fields.filter((f): f is AcroFormField => f.source === "acroform");
  });

  it("parses exactly one of each of radio, dropdown, listbox", () => {
    expect(fields.filter((f) => f.type === "radio")).toHaveLength(1);
    expect(fields.filter((f) => f.type === "dropdown")).toHaveLength(1);
    expect(fields.filter((f) => f.type === "listbox")).toHaveLength(1);
  });

  it("extracts radio options and per-widget positions", () => {
    const f = fields.find((x) => x.type === "radio");
    if (f?.type !== "radio") throw new Error();
    expect(f.options).toEqual(["standard", "express", "overnight"]);
    expect(f.widgets).toHaveLength(3);
    expect(f.widgets.map((w) => w.value).sort()).toEqual(
      ["standard", "express", "overnight"].sort(),
    );
    for (const w of f.widgets) {
      expect(w.position.widthPt).toBeGreaterThan(0);
      expect(w.position.heightPt).toBeGreaterThan(0);
    }
  });

  it("extracts dropdown options", () => {
    const f = fields.find((x) => x.type === "dropdown");
    if (f?.type !== "dropdown") throw new Error();
    expect(f.options).toEqual([
      "United States",
      "Canada",
      "Japan",
      "Armenia",
      "Germany",
    ]);
    expect(f.isMultiSelect).toBe(false);
  });

  it("extracts listbox options and multiSelect flag", () => {
    const f = fields.find((x) => x.type === "listbox");
    if (f?.type !== "listbox") throw new Error();
    expect(f.options).toEqual([
      "Apple",
      "Banana",
      "Cherry",
      "Date",
      "Elderberry",
    ]);
    expect(f.isMultiSelect).toBe(true);
  });

  it("reports zero diagnostics on a well-formed fixture", () => {
    expect(sdk.diagnostics).toEqual([]);
  });
});

describe("parse: flat PDF with no AcroForm", () => {
  it("reports hasAcroForm: false and empty fields", async () => {
    const sdk = await loadSdk(FIXTURES.flat);
    const t = sdk.toTemplate();
    expect(t.metadata.hasAcroForm).toBe(false);
    expect(t.fields).toEqual([]);
  });
});

describe("parse: encrypted PDF", () => {
  it("refuses encrypted input by default", async () => {
    // PDFium rejects password-protected documents outright. The SDK
    // surfaces the engine error via the load task's rejection.
    await expect(loadSdk(FIXTURES.encrypted)).rejects.toThrow();
  });
});

describe("load input types", () => {
  it("accepts Uint8Array", async () => {
    const sdk = await loadSdk(FIXTURES.choices);
    expect(sdk.getFields().length).toBeGreaterThan(0);
  });

  it("accepts ArrayBuffer", async () => {
    const engine = await getTestEngine();
    const bytes = loadFixture(FIXTURES.choices);
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const sdk = await PdfSdk.load(ab, { engine });
    expect(sdk.getFields().length).toBeGreaterThan(0);
  });

  it("accepts base64 string", async () => {
    const engine = await getTestEngine();
    const bytes = loadFixture(FIXTURES.choices);
    const bin = String.fromCharCode(...bytes);
    const b64 = btoa(bin);
    const sdk = await PdfSdk.load(b64, { engine });
    expect(sdk.getFields().length).toBeGreaterThan(0);
  });

  it("accepts Blob", async () => {
    const engine = await getTestEngine();
    const bytes = loadFixture(FIXTURES.choices);
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const blob = new Blob([ab]);
    const sdk = await PdfSdk.load(blob, { engine });
    expect(sdk.getFields().length).toBeGreaterThan(0);
  });
});

describe("malformed input", () => {
  it("throws on bytes that aren't a PDF", async () => {
    const engine = await getTestEngine();
    await expect(
      PdfSdk.load(new Uint8Array([1, 2, 3, 4, 5]), { engine }),
    ).rejects.toThrow();
  });
});

describe("getField / getFields / toTemplate return copies", () => {
  it("getFields returns a fresh array per call", async () => {
    const sdk = await loadSdk(FIXTURES.choices);
    expect(sdk.getFields()).not.toBe(sdk.getFields());
  });

  it("mutating getFields() does not mutate SDK state", async () => {
    const sdk = await loadSdk(FIXTURES.choices);
    const before = sdk.getFields().length;
    sdk.getFields().pop();
    expect(sdk.getFields().length).toBe(before);
  });

  it("toTemplate() returns an independent copy of fields and pages", async () => {
    const sdk = await loadSdk(FIXTURES.choices);
    const t1 = sdk.toTemplate();
    const t2 = sdk.toTemplate();
    expect(t1).not.toBe(t2);
    expect(t1.fields).not.toBe(t2.fields);
    expect(t1.metadata.pages).not.toBe(t2.metadata.pages);
  });

  it("getField returns null for unknown id", async () => {
    const sdk = await loadSdk(FIXTURES.choices);
    expect(sdk.getField("does-not-exist")).toBeNull();
  });
});

describe("parseToTemplate standalone", () => {
  it("is exported and operates on an engine-opened PDFium document", async () => {
    const engine = await getTestEngine();
    const bytes = loadFixture(FIXTURES.choices);
    const content = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const doc = await engine
      .openDocumentBuffer({ id: "parseToTemplate-standalone", content })
      .toPromise();
    const { template, diagnostics } = await parseToTemplate(engine, doc, bytes);
    expect(template.fields.length).toBe(3);
    expect(diagnostics).toEqual([]);
  });
});
