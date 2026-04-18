import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFField,
  type PDFForm,
} from "@cantoo/pdf-lib";
import type {
  AcroFormField,
  Field,
  ParseDiagnostic,
  Template,
} from "./types.js";
import { classifyField, parseToTemplate } from "./parse.js";
import { normalizeInput } from "./utils.js";

export type LoadOptions = {
  /** Allow parsing encrypted documents. Default false — refuses and throws. */
  allowEncrypted?: boolean;
};

export type GenerateOptions = {
  /**
   * Bake field values into page content and strip the AcroForm. Output is not
   * editable downstream but renders identically in every viewer. Default false.
   */
  flatten?: boolean;
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
    const form = this.doc.getForm();
    form.updateFieldAppearances();

    if (opts.flatten) {
      this.flattenSafely(form);
    }

    this.doc.setModificationDate(DETERMINISTIC_DATE);
    return await this.doc.save({ useObjectStreams: false });
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
