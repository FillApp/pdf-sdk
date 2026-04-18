import { describe, it, expect, beforeAll } from "vitest";
import {
  PdfSdk,
  parseToTemplate,
  type AcroFormField,
  type Template,
} from "../src/index.js";
import { PDFDocument } from "@cantoo/pdf-lib";
import { FIXTURES, loadFixture } from "./helpers/fixtures.js";

describe("parse: form with all AcroForm types", () => {
  let template: Template;
  let acroFields: AcroFormField[];
  let sdk: PdfSdk;

  beforeAll(async () => {
    sdk = await PdfSdk.load(loadFixture(FIXTURES.allTypes));
    template = sdk.toTemplate();
    acroFields = template.fields;
  });

  describe("document metadata", () => {
    it("detects page count", () => {
      expect(template.metadata.pageCount).toBe(3);
    });

    it("extracts per-page dimensions", () => {
      expect(template.metadata.pages).toHaveLength(3);
      for (const p of template.metadata.pages) {
        expect(p.widthPt).toBe(612);
        expect(p.heightPt).toBe(792);
      }
    });

    it("flags that the document has an AcroForm", () => {
      expect(template.metadata.hasAcroForm).toBe(true);
    });
  });

  describe("field extraction", () => {
    it("extracts the expected total of fillable fields", () => {
      expect(acroFields).toHaveLength(38);
    });

    it.each([
      ["text", 23],
      ["checkbox", 10],
      ["radio", 1],
      ["dropdown", 2],
      ["listbox", 2],
    ] as const)("extracts %i %s field(s)", (type, expected) => {
      const count = acroFields.filter((f) => f.type === type).length;
      expect(count).toBe(expected);
    });

    it("gives every field a distinct id", () => {
      const ids = new Set(acroFields.map((f) => f.id));
      expect(ids.size).toBe(acroFields.length);
    });

    it("prefixes ids with 'acro:'", () => {
      for (const f of acroFields) expect(f.id.startsWith("acro:")).toBe(true);
    });

    it("preserves the original acroFieldName", () => {
      expect(acroFields.some((f) => f.acroFieldName === "plain_text")).toBe(
        true,
      );
    });
  });

  describe("discriminated union on `type`", () => {
    it("narrows text fields to string value + maxLength + multiline", () => {
      const f = acroFields.find((x) => x.acroFieldName === "plain_text")!;
      if (f.type !== "text") throw new Error("wrong type");
      expect(typeof f.value).toBe("string");
      expect(typeof f.multiline).toBe("boolean");
      expect(typeof f.maxLength === "number" || f.maxLength === undefined).toBe(
        true,
      );
    });

    it("narrows checkbox fields to boolean value", () => {
      const f = acroFields.find((x) => x.type === "checkbox")!;
      if (f.type !== "checkbox") throw new Error("wrong type");
      expect(typeof f.value).toBe("boolean");
    });

    it("narrows dropdown/listbox values to string[]", () => {
      const f = acroFields.find((x) => x.type === "dropdown")!;
      if (f.type !== "dropdown") throw new Error("wrong type");
      expect(Array.isArray(f.value)).toBe(true);
    });
  });

  describe("field positions", () => {
    it("extracts position in PDF points", () => {
      const f = acroFields.find((x) => x.acroFieldName === "plain_text")!;
      expect(f.position.xPt).toBeCloseTo(200, 0);
      expect(f.position.yPt).toBeCloseTo(678, 0);
      expect(f.position.widthPt).toBeCloseTo(300, 0);
      expect(f.position.heightPt).toBeCloseTo(18, 0);
    });

    it("assigns every field to a valid page", () => {
      for (const f of acroFields) {
        expect(f.page).toBeGreaterThanOrEqual(0);
        expect(f.page).toBeLessThan(template.metadata.pageCount);
      }
    });
  });

  describe("field flags", () => {
    it("detects maxLength on text fields", () => {
      const f = acroFields.find((x) => x.acroFieldName === "maxlen_5");
      if (f?.type !== "text") throw new Error();
      expect(f.maxLength).toBe(5);
    });

    it("detects the multiline flag", () => {
      const f = acroFields.find((x) => x.acroFieldName === "multiline_field");
      if (f?.type !== "text") throw new Error();
      expect(f.multiline).toBe(true);
    });

    it("does not mark single-line text fields as multiline", () => {
      const f = acroFields.find((x) => x.acroFieldName === "plain_text");
      if (f?.type !== "text") throw new Error();
      expect(f.multiline).toBe(false);
    });

    it("detects the readOnly flag", () => {
      const f = acroFields.find((x) => x.acroFieldName === "readonly_field");
      expect(f?.readOnly).toBe(true);
    });

    it("detects multiSelect on choice fields", () => {
      const f = acroFields.find((x) => x.acroFieldName === "fruit_multi");
      if (f?.type !== "listbox") throw new Error();
      expect(f.isMultiSelect).toBe(true);
    });
  });

  describe("options for choice fields", () => {
    it("extracts radio group options", () => {
      const f = acroFields.find((x) => x.type === "radio");
      if (f?.type !== "radio") throw new Error();
      expect(f.options).toEqual(["standard", "express", "overnight"]);
    });

    it("extracts dropdown options", () => {
      const f = acroFields.find((x) => x.acroFieldName === "country");
      if (f?.type !== "dropdown") throw new Error();
      expect(f.options).toContain("Armenia");
    });

    it("extracts listbox options", () => {
      const f = acroFields.find((x) => x.acroFieldName === "fruit_single");
      if (f?.type !== "listbox") throw new Error();
      expect(f.options).toContain("Apple");
    });
  });

  describe("diagnostics", () => {
    it("reports zero diagnostics on a well-formed fixture", () => {
      expect(sdk.diagnostics).toEqual([]);
    });
  });
});

describe("parse: flat PDF with no AcroForm", () => {
  it("reports hasAcroForm: false and empty fields", async () => {
    const sdk = await PdfSdk.load(loadFixture(FIXTURES.flat));
    const t = sdk.toTemplate();
    expect(t.metadata.hasAcroForm).toBe(false);
    expect(t.fields).toEqual([]);
  });
});

describe("load input types", () => {
  it("accepts Uint8Array", async () => {
    const sdk = await PdfSdk.load(loadFixture(FIXTURES.allTypes));
    expect(sdk.getFields().length).toBeGreaterThan(0);
  });

  it("accepts ArrayBuffer", async () => {
    const bytes = loadFixture(FIXTURES.allTypes);
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const sdk = await PdfSdk.load(ab);
    expect(sdk.getFields().length).toBeGreaterThan(0);
  });

  it("accepts base64 string", async () => {
    const bytes = loadFixture(FIXTURES.allTypes);
    const bin = String.fromCharCode(...bytes);
    const b64 = btoa(bin);
    const sdk = await PdfSdk.load(b64);
    expect(sdk.getFields().length).toBeGreaterThan(0);
  });

  it("accepts Blob", async () => {
    const bytes = loadFixture(FIXTURES.allTypes);
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const blob = new Blob([ab]);
    const sdk = await PdfSdk.load(blob);
    expect(sdk.getFields().length).toBeGreaterThan(0);
  });
});

describe("malformed input", () => {
  it("throws on bytes that aren't a PDF", async () => {
    await expect(
      PdfSdk.load(new Uint8Array([1, 2, 3, 4, 5])),
    ).rejects.toThrow();
  });
});

describe("getField / getFields / toTemplate return copies", () => {
  it("getFields returns a fresh array per call", async () => {
    const sdk = await PdfSdk.load(loadFixture(FIXTURES.allTypes));
    expect(sdk.getFields()).not.toBe(sdk.getFields());
  });

  it("mutating getFields() does not mutate SDK state", async () => {
    const sdk = await PdfSdk.load(loadFixture(FIXTURES.allTypes));
    const before = sdk.getFields().length;
    sdk.getFields().pop();
    expect(sdk.getFields().length).toBe(before);
  });

  it("toTemplate() returns an independent copy of fields and pages", async () => {
    const sdk = await PdfSdk.load(loadFixture(FIXTURES.allTypes));
    const t1 = sdk.toTemplate();
    const t2 = sdk.toTemplate();
    expect(t1).not.toBe(t2);
    expect(t1.fields).not.toBe(t2.fields);
    expect(t1.metadata.pages).not.toBe(t2.metadata.pages);
  });

  it("getField returns null for unknown id", async () => {
    const sdk = await PdfSdk.load(loadFixture(FIXTURES.allTypes));
    expect(sdk.getField("does-not-exist")).toBeNull();
  });
});

describe("parseToTemplate standalone", () => {
  it("is exported and operates on a pdf-lib PDFDocument", async () => {
    const bytes = loadFixture(FIXTURES.allTypes);
    const doc = await PDFDocument.load(bytes);
    const { template, diagnostics } = parseToTemplate(doc, bytes);
    expect(template.fields.length).toBe(38);
    expect(diagnostics).toEqual([]);
  });
});
