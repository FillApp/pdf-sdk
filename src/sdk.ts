import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  rgb,
  type Color,
  type PDFField,
  type PDFFont,
  type PDFForm,
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
import { classifyField, parseToTemplate } from "./parse.js";
import { base64ToBytes, normalizeInput } from "./utils.js";
import { NOTO_SANS_REGULAR_TTF_BASE64 } from "./fonts/noto-sans.js";

export type LoadOptions = {
  /** Allow parsing encrypted documents. Default false — refuses and throws. */
  allowEncrypted?: boolean;
};

/**
 * Distributive Omit — preserves the discriminated union so callers can pass a
 * literal keyed on `kind` and have TS narrow to the matching variant. Using
 * plain `Omit<OverlayField, "id">` collapses the union into a single type
 * whose keys are the intersection, which breaks variant-specific fields like
 * `text` and `image`.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

export type OverlayInit = DistributiveOmit<OverlayField, "id">;

export type GenerateOptions = {
  /**
   * Bake field values into page content and strip the AcroForm. Output is not
   * editable downstream but renders identically in every viewer. Default false.
   */
  flatten?: boolean;
  /**
   * Override the font used to render field appearances. If omitted, the
   * bundled Noto Sans subset (Latin + Latin Extended + Cyrillic) is used so
   * common European scripts render out of the box.
   *
   * Pass a TrueType / OpenType font (as raw bytes) to support other scripts —
   * CJK, Arabic, Devanagari, etc. The font is embedded subsetted.
   */
  font?: Uint8Array | ArrayBuffer;
};

/** Fixed timestamp used during generate() to keep output deterministic. */
const DETERMINISTIC_DATE = new Date("2000-01-01T00:00:00.000Z");

export class PdfSdk {
  /**
   * Append-only log of non-fatal issues encountered during parse, fill, or
   * generate. Consumers can inspect this to surface warnings to users.
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
   * matches the field's type. Throws on type mismatch or (for choice fields
   * with a known option list) a value not in the options.
   *
   * Mutates internal state; subsequent `getField` / `toTemplate` calls and
   * `generate()` reflect the new value.
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
   * Render the (possibly modified) document to PDF bytes.
   *
   * Default: keeps the AcroForm intact so fields remain editable downstream.
   * `flatten: true` bakes the values into page content and removes the form —
   * best for archival output.
   */
  async generate(opts: GenerateOptions = {}): Promise<Uint8Array> {
    const font = await this.embedFieldFont(opts.font);
    const form = this.doc.getForm();
    form.updateFieldAppearances(font);

    await this.drawOverlays(font);

    if (opts.flatten) {
      this.flattenSafely(form);
    }

    this.doc.setModificationDate(DETERMINISTIC_DATE);
    // Keep default object streams. Setting useObjectStreams: false was
    // evaluated for determinism but silently breaks hierarchical field names
    // (values vanish on reparse).
    return await this.doc.save();
  }

  /**
   * Paint overlay fields onto their target pages. Runs after AcroForm
   * appearances are updated but before any optional flatten. Text uses the
   * same font the form fields use so fills and overlays share one embedded
   * font subset.
   */
  private async drawOverlays(font: PDFFont): Promise<void> {
    const pages = this.doc.getPages();
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
          await this.drawOverlayImage(page, field);
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
    // Position the baseline inside the bounding box. Most TTFs have ascent
    // around 75% of the em — subtract a small margin so ascenders don't
    // clip against the top of the box.
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
    page: PDFPage,
    field: Extract<OverlayField, { kind: "image" }>,
  ): Promise<void> {
    const { position, image } = field;
    const embedded =
      image.mime === "image/png"
        ? await this.doc.embedPng(image.bytes)
        : await this.doc.embedJpg(image.bytes);
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
    // Two line segments: bottom-left of the V, then rising to the top-right.
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

  /**
   * Register fontkit and embed either the caller's font or the bundled
   * Noto Sans subset. pdf-lib caches embedded fonts on the document, so
   * repeated calls to `generate()` on the same instance reuse the embed.
   */
  private async embedFieldFont(
    override?: Uint8Array | ArrayBuffer,
  ): Promise<PDFFont> {
    // registerFontkit is idempotent under @cantoo/pdf-lib — safe to call each
    // time; calling it lazily means the dependency cost only shows up when
    // generate() actually runs.
    this.doc.registerFontkit(fontkit);
    const bytes = override ?? base64ToBytes(NOTO_SANS_REGULAR_TTF_BASE64);
    return await this.doc.embedFont(bytes, { subset: true });
  }

  /**
   * Flatten with a workaround for pdf-lib's known signature-field crash.
   * Pre-emptively remove any field we don't recognize (signatures, plain
   * buttons) before calling flatten, since those produce "Unexpected N type"
   * errors in the flatten path.
   */
  private flattenSafely(form: PDFForm): void {
    const unknownFields = form
      .getFields()
      .filter((f) => classifyField(f) === null);
    for (const f of unknownFields) {
      this.pushDiagnostic({
        fieldName: f.getName(),
        kind: "signature-flatten-skipped",
        message:
          "Non-fillable field (likely signature/button) removed before flatten to avoid upstream crash.",
      });
      form.removeField(f);
    }
    form.flatten();
  }

  /**
   * Add an overlay field to the template. Returns the generated id.
   *
   * Overlays are drawn by `generate()` in insertion order; later overlays
   * paint over earlier ones. The returned id is stable for the lifetime of
   * this SDK instance.
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

  /** Access the underlying pdf-lib document. Advanced use only. */
  getPdfDocument(): PDFDocument {
    return this.doc;
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
