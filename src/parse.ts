import {
  PDFCheckBox,
  PDFDropdown,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFDocument,
  type PDFField,
  type PDFWidgetAnnotation,
} from "@cantoo/pdf-lib";
import type {
  AcroFormField,
  AcroFormFieldType,
  ParseDiagnostic,
  ParseResult,
  Template,
} from "./types.js";

// AcroForm field flag bits (PDF 32000-1:2008 §12.7.3.1 and §12.7.4).
const FLAG_READ_ONLY = 1 << 0; // 1; written with shift for consistency with peers
const FLAG_MULTILINE = 1 << 12;
const FLAG_MULTI_SELECT = 1 << 21;

// These two helpers reach into pdf-lib's acroField.dict — the only stable way
// to read the `Ff` and `MaxLen` PDF dictionary entries. If this internal shape
// changes upstream the helpers below are the single place to repair.
type InternalAcroField = {
  acroField: { dict: { get(name: ReturnType<typeof PDFName.of>): unknown } };
};
function getAcroDict(field: PDFField) {
  return (field as unknown as InternalAcroField).acroField.dict;
}
function readFlags(field: PDFField): number {
  const ff = getAcroDict(field).get(PDFName.of("Ff"));
  return ff instanceof PDFNumber ? ff.asNumber() : 0;
}
function readMaxLength(field: PDFField): number | undefined {
  const ml = getAcroDict(field).get(PDFName.of("MaxLen"));
  return ml instanceof PDFNumber ? ml.asNumber() : undefined;
}

export function classifyField(field: PDFField): AcroFormFieldType | null {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "listbox";
  return null;
}

function defaultValueForType(
  type: AcroFormFieldType,
): string | string[] | boolean {
  if (type === "checkbox") return false;
  if (type === "dropdown" || type === "listbox") return [];
  return "";
}

function extractValue(
  field: PDFField,
  type: AcroFormFieldType,
  diagnostics: ParseDiagnostic[],
  fieldName: string,
): string | string[] | boolean {
  try {
    if (field instanceof PDFTextField) return field.getText() ?? "";
    if (field instanceof PDFCheckBox) return field.isChecked();
    if (field instanceof PDFRadioGroup) return field.getSelected() ?? "";
    if (field instanceof PDFDropdown) return field.getSelected();
    if (field instanceof PDFOptionList) return field.getSelected();
  } catch (err) {
    diagnostics.push({
      fieldName,
      kind: "value-extraction-failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return defaultValueForType(type);
}

function extractOptions(
  field: PDFField,
  diagnostics: ParseDiagnostic[],
  fieldName: string,
): string[] | undefined {
  try {
    if (
      field instanceof PDFRadioGroup ||
      field instanceof PDFDropdown ||
      field instanceof PDFOptionList
    ) {
      const opts = field.getOptions();
      return opts.length ? opts : undefined;
    }
  } catch (err) {
    diagnostics.push({
      fieldName,
      kind: "options-extraction-failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return undefined;
}

/**
 * Build a stable, URL-safe id from the acroFieldName and a widget
 * discriminator. Not derived from iteration order — survives reshuffles.
 */
function makeFieldId(acroFieldName: string, widgetIndex: number): string {
  const safe = acroFieldName.replace(/[^A-Za-z0-9_-]/g, "_");
  return `acro:${safe}:${widgetIndex}`;
}

/**
 * Read a PDF into the canonical Template shape. Exported so advanced consumers
 * can work from an already-loaded pdf-lib document. Diagnostics are collected,
 * never thrown — callers decide whether to fail on them.
 */
export function parseToTemplate(
  doc: PDFDocument,
  basePdfBytes: Uint8Array,
): ParseResult {
  const pages = doc.getPages();
  const diagnostics: ParseDiagnostic[] = [];

  // O(1) page lookup keyed by page ref.
  const pageIdxByRef = new Map<unknown, number>();
  for (let i = 0; i < pages.length; i++) pageIdxByRef.set(pages[i].ref, i);

  const fields: AcroFormField[] = [];

  for (const pdfField of doc.getForm().getFields()) {
    const acroFieldName = pdfField.getName();
    const type = classifyField(pdfField);
    if (!type) continue; // buttons, signatures, etc. — not in fillable scope

    const widgets: PDFWidgetAnnotation[] = (
      pdfField as unknown as {
        acroField: { getWidgets: () => PDFWidgetAnnotation[] };
      }
    ).acroField.getWidgets();

    if (widgets.length === 0) {
      diagnostics.push({
        fieldName: acroFieldName,
        kind: "no-widgets",
        message: "Field has no widget annotations; cannot determine position.",
      });
      continue;
    }

    const widget = widgets[0];
    const rect = widget.getRectangle();
    const widgetPageRef = widget.P();
    const pageIdx = pageIdxByRef.get(widgetPageRef);
    if (pageIdx === undefined) {
      diagnostics.push({
        fieldName: acroFieldName,
        kind: "orphan-widget",
        message: "Widget not attached to any page; field skipped.",
      });
      continue;
    }

    const flags = readFlags(pdfField);
    const value = extractValue(pdfField, type, diagnostics, acroFieldName);
    const options = extractOptions(pdfField, diagnostics, acroFieldName);

    const base = {
      id: makeFieldId(acroFieldName, 0),
      source: "acroform" as const,
      acroFieldName,
      page: pageIdx,
      position: {
        xPt: rect.x,
        yPt: rect.y,
        widthPt: rect.width,
        heightPt: rect.height,
      },
      readOnly: (flags & FLAG_READ_ONLY) !== 0,
    };

    if (type === "text") {
      fields.push({
        ...base,
        type: "text",
        value: value as string,
        maxLength: readMaxLength(pdfField),
        multiline: (flags & FLAG_MULTILINE) !== 0,
      });
    } else if (type === "checkbox") {
      fields.push({ ...base, type: "checkbox", value: value as boolean });
    } else if (type === "radio") {
      const radioWidgets = widgets
        .map((w, idx) => {
          const r = w.getRectangle();
          const widgetPageRef = w.P();
          const widgetPageIdx = pageIdxByRef.get(widgetPageRef);
          if (widgetPageIdx === undefined) return null;
          return {
            value: options?.[idx] ?? "",
            page: widgetPageIdx,
            position: {
              xPt: r.x,
              yPt: r.y,
              widthPt: r.width,
              heightPt: r.height,
            },
          };
        })
        .filter((w): w is NonNullable<typeof w> => w !== null);
      fields.push({
        ...base,
        type: "radio",
        value: value as string,
        options,
        widgets: radioWidgets,
      });
    } else if (type === "dropdown") {
      fields.push({
        ...base,
        type: "dropdown",
        value: value as string[],
        options,
        isMultiSelect: (flags & FLAG_MULTI_SELECT) !== 0,
      });
    } else if (type === "listbox") {
      fields.push({
        ...base,
        type: "listbox",
        value: value as string[],
        options,
        isMultiSelect: (flags & FLAG_MULTI_SELECT) !== 0,
      });
    }
  }

  const template: Template = {
    basePdf: basePdfBytes,
    metadata: {
      pageCount: pages.length,
      pages: pages.map((p) => ({
        widthPt: p.getWidth(),
        heightPt: p.getHeight(),
      })),
      hasAcroForm: fields.length > 0,
    },
    fields,
  };

  return { template, diagnostics };
}
