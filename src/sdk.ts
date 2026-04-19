import {
  PDFBool,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  rgb,
  type Color,
  type PDFField,
  type PDFFont,
  type PDFPage,
} from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type {
  AcroFormField,
  Field,
  OverlayField,
  ParseDiagnostic,
  RGB,
  Template,
} from "./types.js";
import { parseToTemplate } from "./parse.js";
import { base64ToBytes, normalizeInput } from "./utils.js";
import { NOTO_SANS_REGULAR_TTF_BASE64 } from "./fonts/noto-sans.js";

/**
 * Distributive Omit — preserves the discriminated union so callers can pass a
 * literal keyed on `kind` and have TS narrow to the matching variant. Plain
 * `Omit<OverlayField, "id">` collapses the union into a single type whose
 * keys are the intersection, which breaks variant-specific fields like
 * `text` and `image`.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

export type OverlayInit = DistributiveOmit<OverlayField, "id">;

export type GenerateOptions = {
  /**
   * Override the font used to render overlay text. If omitted, the bundled
   * Noto Sans subset (Latin + Latin Extended + Cyrillic) is used.
   *
   * Pass a TrueType / OpenType font (as raw bytes) to support other scripts —
   * CJK, Arabic, Devanagari, etc. The font is embedded subsetted.
   */
  font?: Uint8Array | ArrayBuffer;
};

export type LoadOptions = {
  /** Allow parsing encrypted documents. Default false — refuses and throws. */
  allowEncrypted?: boolean;
};

/** Fixed timestamp used during generate() so repeat runs produce identical bytes. */
const DETERMINISTIC_DATE = new Date("2000-01-01T00:00:00.000Z");

/**
 * Minimal AcroForm filler. Loads a PDF, surfaces every supported field as a
 * discriminated-union entry on `Template.fields`, mutates field values via
 * `setFieldValue`, and emits a PDF whose AcroForm is preserved so downstream
 * viewers (Acrobat, pdf.js, etc.) can continue editing.
 *
 * Deliberately does NOT regenerate appearance streams — the canonical way to
 * tell a PDF viewer "values changed, please re-render the widget chrome" is
 * the `/NeedAppearances true` entry on the AcroForm dict, which we set on
 * save. That keeps the SDK's behavior within the PDF spec and avoids fighting
 * pdf-lib's renderer.
 */
export class PdfSdk {
  /**
   * Append-only log of non-fatal issues encountered during parse or fill.
   * Consumers can inspect this to surface warnings to users.
   */
  readonly diagnostics: readonly ParseDiagnostic[];
  private readonly doc: PDFDocument;
  private readonly template: Template;
  private overlayCounter = 0;

  private constructor(
    doc: PDFDocument,
    template: Template,
    diagnostics: readonly ParseDiagnostic[],
  ) {
    this.doc = doc;
    this.template = template;
    this.diagnostics = diagnostics;
  }

  static async load(
    input: Uint8Array | ArrayBuffer | Blob | string,
    opts: LoadOptions = {},
  ): Promise<PdfSdk> {
    const bytes = await normalizeInput(input);
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: opts.allowEncrypted === true,
      throwOnInvalidObject: false,
    });
    const { template, diagnostics } = parseToTemplate(doc, bytes);
    return new PdfSdk(doc, template, diagnostics);
  }

  /** Snapshot of the Template. Safe to mutate the returned object. */
  toTemplate(): Template {
    return {
      ...this.template,
      metadata: {
        ...this.template.metadata,
        pages: this.template.metadata.pages.map((p) => ({ ...p })),
      },
      fields: this.template.fields.map((f) => ({ ...f })),
    };
  }

  /** Snapshot of fields. Safe to mutate the returned array. */
  getFields(): Field[] {
    return this.template.fields.map((f) => ({ ...f }));
  }

  getField(id: string): Field | null {
    const found = this.template.fields.find((f) => f.id === id);
    return found ? { ...found } : null;
  }

  /**
   * Write a value into the named field, validating that the value shape
   * matches the field's type.
   *
   *   - Text: string; `maxLength` enforced via truncation + diagnostic.
   *   - Checkbox: boolean.
   *   - Radio: string that matches one of `options[]`.
   *   - Dropdown / listbox: string or string[]; single-select listbox
   *     rejects arrays longer than one.
   *
   * Throws TypeError on shape mismatch, Error on unknown id / out-of-options
   * value. Mutates internal state; subsequent `getField` / `toTemplate` calls
   * and `generate()` reflect the new value.
   */
  setFieldValue(id: string, value: string | string[] | boolean): void {
    const field = this.template.fields.find((f) => f.id === id);
    if (!field) {
      throw new Error(`Unknown field id: ${id}`);
    }
    if (field.source !== "acroform") {
      throw new Error(
        `Field ${id} is an overlay; use updateOverlay() instead.`,
      );
    }
    const pdfField = this.doc.getForm().getField(field.acroFieldName);

    switch (field.type) {
      case "text":
        this.applyTextValue(field, pdfField, value);
        break;
      case "checkbox":
        this.applyCheckboxValue(field, pdfField, value);
        break;
      case "radio":
        this.applyRadioValue(field, pdfField, value);
        break;
      case "dropdown":
      case "listbox":
        this.applyChoiceValue(field, pdfField, value);
        break;
    }
  }

  private applyTextValue(
    field: Extract<AcroFormField, { type: "text" }>,
    pdfField: PDFField,
    value: string | string[] | boolean,
  ): void {
    if (typeof value !== "string") {
      throw new TypeError(
        `Text field "${field.acroFieldName}" requires a string; got ${describe(value)}.`,
      );
    }
    if (!(pdfField instanceof PDFTextField)) {
      throw new Error(
        `Field "${field.acroFieldName}" is not a text field in the PDF.`,
      );
    }
    let final = value;
    if (field.maxLength !== undefined && final.length > field.maxLength) {
      const before = final.length;
      final = final.slice(0, field.maxLength);
      this.pushDiagnostic({
        fieldName: field.acroFieldName,
        kind: "value-truncated",
        message: `Truncated value from ${before} to ${field.maxLength} characters (maxLength).`,
      });
    }
    pdfField.setText(final);
    this.replaceField({ ...field, value: final });
  }

  private applyCheckboxValue(
    field: Extract<AcroFormField, { type: "checkbox" }>,
    pdfField: PDFField,
    value: string | string[] | boolean,
  ): void {
    if (typeof value !== "boolean") {
      throw new TypeError(
        `Checkbox "${field.acroFieldName}" requires a boolean; got ${describe(value)}.`,
      );
    }
    if (!(pdfField instanceof PDFCheckBox)) {
      throw new Error(
        `Field "${field.acroFieldName}" is not a checkbox in the PDF.`,
      );
    }
    if (value) pdfField.check();
    else pdfField.uncheck();
    this.replaceField({ ...field, value });
  }

  private applyRadioValue(
    field: Extract<AcroFormField, { type: "radio" }>,
    pdfField: PDFField,
    value: string | string[] | boolean,
  ): void {
    if (typeof value !== "string") {
      throw new TypeError(
        `Radio "${field.acroFieldName}" requires a string; got ${describe(value)}.`,
      );
    }
    if (!(pdfField instanceof PDFRadioGroup)) {
      throw new Error(
        `Field "${field.acroFieldName}" is not a radio group in the PDF.`,
      );
    }
    if (field.options && !field.options.includes(value)) {
      throw new Error(
        `Radio "${field.acroFieldName}" has no option "${value}". Valid: ${field.options.join(", ")}.`,
      );
    }
    pdfField.select(value);
    this.replaceField({ ...field, value });
  }

  private applyChoiceValue(
    field: Extract<AcroFormField, { type: "dropdown" | "listbox" }>,
    pdfField: PDFField,
    value: string | string[] | boolean,
  ): void {
    const label = field.type === "dropdown" ? "Dropdown" : "Listbox";
    if (typeof value !== "string" && !Array.isArray(value)) {
      throw new TypeError(
        `${label} "${field.acroFieldName}" requires a string or string[]; got ${describe(value)}.`,
      );
    }
    const values = typeof value === "string" ? [value] : value;
    for (const v of values) {
      if (typeof v !== "string") {
        throw new TypeError(
          `${label} "${field.acroFieldName}" values must be strings; got ${describe(v)}.`,
        );
      }
    }
    if (!field.isMultiSelect && values.length > 1) {
      throw new Error(
        `${label} "${field.acroFieldName}" is single-select; cannot accept ${values.length} values.`,
      );
    }
    if (field.options) {
      for (const v of values) {
        if (!field.options.includes(v)) {
          throw new Error(
            `${label} "${field.acroFieldName}" has no option "${v}". Valid: ${field.options.join(", ")}.`,
          );
        }
      }
    }
    const isDropdown = pdfField instanceof PDFDropdown;
    const isListbox = pdfField instanceof PDFOptionList;
    if (!isDropdown && !isListbox) {
      throw new Error(
        `Field "${field.acroFieldName}" is not a dropdown or listbox in the PDF.`,
      );
    }
    (pdfField as PDFDropdown | PDFOptionList).select(values);
    this.replaceField({ ...field, value: values });
  }

  /**
   * Add an overlay field to the template. Overlays are drawn directly onto
   * page content by `generate()` — use them for flat / scanned PDFs where
   * no AcroForm widget exists. Returns the generated id.
   */
  addOverlay(field: OverlayInit): string {
    const id = `overlay:${this.overlayCounter++}`;
    this.template.fields.push({ ...field, id } as OverlayField);
    return id;
  }

  /**
   * Merge a partial update into the named overlay. The `kind` of an overlay
   * is immutable after creation — remove and re-add if you need to change it.
   */
  updateOverlay(
    id: string,
    partial: Partial<Omit<OverlayField, "id" | "source" | "kind">>,
  ): void {
    const i = this.findOverlayIndex(id);
    const existing = this.template.fields[i] as OverlayField;
    this.template.fields[i] = {
      ...existing,
      ...partial,
      id: existing.id,
      source: "overlay",
      kind: existing.kind,
    } as OverlayField;
  }

  removeOverlay(id: string): void {
    const i = this.findOverlayIndex(id);
    this.template.fields.splice(i, 1);
  }

  private findOverlayIndex(id: string): number {
    const i = this.template.fields.findIndex((f) => f.id === id);
    if (i < 0) throw new Error(`Unknown overlay id: ${id}`);
    if (this.template.fields[i].source !== "overlay") {
      throw new Error(`Field ${id} is not an overlay`);
    }
    return i;
  }

  /**
   * Serialize the (possibly modified) document to PDF bytes.
   *
   *   1. AcroForm values set via `setFieldValue` already live on the pdf-lib
   *      form; we set `/NeedAppearances true` so compliant viewers re-render
   *      each widget with its new value. The SDK does not pre-bake
   *      appearance streams itself — that path competes with pdf-lib's
   *      renderer and produces visible artifacts.
   *   2. Overlay fields are drawn onto page content streams of a scratch
   *      copy — never onto `this.doc` — so repeated `generate()` calls are
   *      idempotent and don't accumulate drawings.
   */
  async generate(opts: GenerateOptions = {}): Promise<Uint8Array> {
    const form = this.doc.getForm();
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    this.doc.setModificationDate(DETERMINISTIC_DATE);

    if (!this.hasOverlays()) {
      return await this.doc.save();
    }

    // Serialize AcroForm state, reload as a fresh scratch doc, and draw
    // overlays onto that. `this.doc` stays unmodified so the next call
    // starts from the same clean baseline.
    const intermediate = await this.doc.save();
    const scratch = await PDFDocument.load(intermediate);
    scratch.registerFontkit(fontkit);
    const overlayFont = await this.embedOverlayFontInto(scratch, opts.font);
    await this.drawOverlaysOnto(scratch, overlayFont);
    scratch.setModificationDate(DETERMINISTIC_DATE);
    return await scratch.save();
  }

  /** Access the underlying pdf-lib document. Advanced use only. */
  getPdfDocument(): PDFDocument {
    return this.doc;
  }

  private hasOverlays(): boolean {
    return this.template.fields.some((f) => f.source === "overlay");
  }

  private async embedOverlayFontInto(
    doc: PDFDocument,
    override?: Uint8Array | ArrayBuffer,
  ): Promise<PDFFont> {
    const bytes = override ?? base64ToBytes(NOTO_SANS_REGULAR_TTF_BASE64);
    return await doc.embedFont(bytes, { subset: true });
  }

  /**
   * Paint overlay fields onto the given document's pages. Writes to
   * `doc.getPages()` — pass a scratch copy, never `this.doc`.
   */
  private async drawOverlaysOnto(
    doc: PDFDocument,
    font: PDFFont,
  ): Promise<void> {
    const pages = doc.getPages();
    for (const field of this.template.fields) {
      if (field.source !== "overlay") continue;
      const page = pages[field.page];
      if (!page) {
        this.pushDiagnostic({
          kind: "orphan-widget",
          message: `Overlay ${field.id} targets page ${field.page} but the document has only ${pages.length} pages; skipped.`,
        });
        continue;
      }
      switch (field.kind) {
        case "text":
          this.drawOverlayText(page, font, field);
          break;
        case "image":
          await this.drawOverlayImage(doc, page, field);
          break;
        case "checkmark":
          this.drawOverlayCheckmark(page, field);
          break;
        case "cross":
          this.drawOverlayCross(page, field);
          break;
      }
    }
  }

  private drawOverlayText(
    page: PDFPage,
    font: PDFFont,
    field: Extract<OverlayField, { kind: "text" }>,
  ): void {
    const { position, text } = field;
    const baselineY = position.yPt + position.heightPt * 0.2;
    page.drawText(text.value, {
      x: position.xPt,
      y: baselineY,
      size: text.fontSizePt,
      font,
      color: rgbOrBlack(text.color),
    });
  }

  private async drawOverlayImage(
    doc: PDFDocument,
    page: PDFPage,
    field: Extract<OverlayField, { kind: "image" }>,
  ): Promise<void> {
    const { position, image } = field;
    const embedded =
      image.mime === "image/png"
        ? await doc.embedPng(image.bytes)
        : await doc.embedJpg(image.bytes);
    page.drawImage(embedded, {
      x: position.xPt,
      y: position.yPt,
      width: position.widthPt,
      height: position.heightPt,
    });
  }

  private drawOverlayCheckmark(
    page: PDFPage,
    field: Extract<OverlayField, { kind: "checkmark" }>,
  ): void {
    const { position, color } = field;
    const { xPt: x, yPt: y, widthPt: w, heightPt: h } = position;
    const stroke = rgbOrBlack(color);
    const thickness = Math.max(1, Math.min(w, h) * 0.12);
    page.drawLine({
      start: { x: x + w * 0.15, y: y + h * 0.5 },
      end: { x: x + w * 0.4, y: y + h * 0.2 },
      thickness,
      color: stroke,
    });
    page.drawLine({
      start: { x: x + w * 0.4, y: y + h * 0.2 },
      end: { x: x + w * 0.85, y: y + h * 0.8 },
      thickness,
      color: stroke,
    });
  }

  private drawOverlayCross(
    page: PDFPage,
    field: Extract<OverlayField, { kind: "cross" }>,
  ): void {
    const { position, color } = field;
    const { xPt: x, yPt: y, widthPt: w, heightPt: h } = position;
    const stroke = rgbOrBlack(color);
    const thickness = Math.max(1, Math.min(w, h) * 0.12);
    page.drawLine({
      start: { x: x + w * 0.15, y: y + h * 0.15 },
      end: { x: x + w * 0.85, y: y + h * 0.85 },
      thickness,
      color: stroke,
    });
    page.drawLine({
      start: { x: x + w * 0.15, y: y + h * 0.85 },
      end: { x: x + w * 0.85, y: y + h * 0.15 },
      thickness,
      color: stroke,
    });
  }

  private replaceField(next: AcroFormField): void {
    const i = this.template.fields.findIndex((f) => f.id === next.id);
    if (i >= 0) this.template.fields[i] = next;
  }

  private pushDiagnostic(d: ParseDiagnostic): void {
    (this.diagnostics as ParseDiagnostic[]).push(d);
  }
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return `array`;
  return typeof value;
}

function rgbOrBlack(color: RGB | undefined): Color {
  if (!color) return rgb(0, 0, 0);
  return rgb(color.r, color.g, color.b);
}
