/**
 * Walk every page of a PDFium-loaded document, collect widget annotations,
 * and emit the canonical `Template`.
 *
 * Collects a parallel `widgetIndex` keyed by the SDK field id so subsequent
 * `setFieldValue` calls can mutate the right widget without re-enumerating.
 */
import {
  PDF_FORM_FIELD_FLAG,
  PDF_FORM_FIELD_TYPE,
  type PdfDocumentObject,
  type PdfEngine,
  type PdfPageObject,
  type PdfWidgetAnnoField,
  type PdfWidgetAnnoObject,
} from "@embedpdf/models";
import type {
  AcroFormField,
  AcroFormFieldType,
  ParseDiagnostic,
  RadioWidget,
  Template,
} from "./types.js";

/**
 * Per-field record retained alongside the Template so mutation and flatten
 * paths don't have to rescan the document. `widgets` is ordered by appearance
 * (page, then widget index) so radio-option lookups stay stable.
 */
export interface WidgetRef {
  page: PdfPageObject;
  widget: PdfWidgetAnnoObject;
}

export interface WidgetIndex {
  /** Every widget for this field, ordered stably (page then widget index). */
  widgets: WidgetRef[];
  /** AcroForm name (unchanged through our lifecycle; kept for clarity). */
  fieldName: string;
}

export interface ParseOutput {
  template: Template;
  diagnostics: ParseDiagnostic[];
  /** Maps SDK field id → widget refs. */
  widgetIndex: Map<string, WidgetIndex>;
}

function classifyFieldType(
  field: PdfWidgetAnnoField,
): AcroFormFieldType | null {
  switch (field.type) {
    case PDF_FORM_FIELD_TYPE.TEXTFIELD:
      return "text";
    case PDF_FORM_FIELD_TYPE.CHECKBOX:
      return "checkbox";
    case PDF_FORM_FIELD_TYPE.RADIOBUTTON:
      return "radio";
    case PDF_FORM_FIELD_TYPE.COMBOBOX:
      return "dropdown";
    case PDF_FORM_FIELD_TYPE.LISTBOX:
      return "listbox";
    default:
      return null; // buttons, signatures, XFA — not fillable by this SDK
  }
}

function makeFieldId(fieldName: string, widgetIndex: number): string {
  const safe = fieldName.replace(/[^A-Za-z0-9_-]/g, "_");
  return `acro:${safe}:${widgetIndex}`;
}

/**
 * PDFium reports annotation rect in top-left-origin page coordinates (page
 * points). Our Template exposes bottom-left-origin PDF points, matching the
 * file format, so we flip Y here.
 */
function widgetRectToPosition(
  widget: PdfWidgetAnnoObject,
  pageHeightPt: number,
): { xPt: number; yPt: number; widthPt: number; heightPt: number } {
  const { origin, size } = widget.rect;
  return {
    xPt: origin.x,
    yPt: pageHeightPt - origin.y - size.height,
    widthPt: size.width,
    heightPt: size.height,
  };
}

function readMultilineFlag(flag: number): boolean {
  return (flag & PDF_FORM_FIELD_FLAG.TEXT_MULTIPLINE) !== 0;
}
function readMultiSelectFlag(flag: number): boolean {
  return (flag & PDF_FORM_FIELD_FLAG.CHOICE_MULTL_SELECT) !== 0;
}
function readReadOnlyFlag(flag: number): boolean {
  return (flag & PDF_FORM_FIELD_FLAG.READONLY) !== 0;
}

function optionLabels(field: PdfWidgetAnnoField): string[] | undefined {
  if (
    field.type === PDF_FORM_FIELD_TYPE.RADIOBUTTON ||
    field.type === PDF_FORM_FIELD_TYPE.COMBOBOX ||
    field.type === PDF_FORM_FIELD_TYPE.LISTBOX
  ) {
    return field.options.map((o) => o.label);
  }
  return undefined;
}

function selectedLabels(field: PdfWidgetAnnoField): string[] {
  if (
    field.type === PDF_FORM_FIELD_TYPE.COMBOBOX ||
    field.type === PDF_FORM_FIELD_TYPE.LISTBOX
  ) {
    return field.options.filter((o) => o.isSelected).map((o) => o.label);
  }
  return [];
}

/**
 * Load every widget annotation on every page and group them by AcroForm field
 * name. The PDFium engine returns widgets per-page; a single logical field
 * (e.g. a radio group, or a text field spanning multiple pages) will surface
 * one widget per page it lives on.
 */
export async function parseToTemplate(
  engine: PdfEngine<Blob>,
  doc: PdfDocumentObject,
  basePdfBytes: Uint8Array,
): Promise<ParseOutput> {
  const diagnostics: ParseDiagnostic[] = [];
  const widgetsByField = new Map<string, WidgetRef[]>();

  // Walk every page's widget annotations in order.
  for (const page of doc.pages) {
    const widgets = await engine.getPageAnnoWidgets(doc, page).toPromise();
    for (const w of widgets) {
      const fieldName = w.field?.name;
      if (!fieldName) continue;
      let list = widgetsByField.get(fieldName);
      if (!list) {
        list = [];
        widgetsByField.set(fieldName, list);
      }
      list.push({ page, widget: w });
    }
  }

  const fields: AcroFormField[] = [];
  const widgetIndex = new Map<string, WidgetIndex>();

  for (const [fieldName, refs] of widgetsByField) {
    const head = refs[0].widget;
    const fieldMeta = head.field;
    const type = classifyFieldType(fieldMeta);
    if (!type) continue;

    const headPageHeight = refs[0].page.size.height;
    const basePosition = widgetRectToPosition(head, headPageHeight);
    const readOnly = readReadOnlyFlag(fieldMeta.flag);
    const options = optionLabels(fieldMeta);

    const id = makeFieldId(fieldName, 0);
    widgetIndex.set(id, { widgets: refs, fieldName });

    const base = {
      id,
      source: "acroform" as const,
      acroFieldName: fieldName,
      page: head.pageIndex,
      position: basePosition,
      readOnly,
    };

    if (type === "text") {
      const maxLen =
        fieldMeta.type === PDF_FORM_FIELD_TYPE.TEXTFIELD
          ? fieldMeta.maxLen
          : undefined;
      fields.push({
        ...base,
        type: "text",
        value: fieldMeta.value ?? "",
        maxLength: maxLen,
        multiline: readMultilineFlag(fieldMeta.flag),
      });
    } else if (type === "checkbox") {
      // A checkbox is "on" when the shared field value equals this widget's
      // export value ("Yes" / "On" / whatever the PDF chose).
      const checked =
        head.exportValue !== undefined && fieldMeta.value === head.exportValue;
      fields.push({ ...base, type: "checkbox", value: checked });
    } else if (type === "radio") {
      // Options are indexed parallel to widget order. Resolve the currently
      // selected *label* by finding the widget whose exportValue matches the
      // shared field.value, then reading options[that widget's index].
      const selectedValue = fieldMeta.value ?? "";
      let selectedLabel = "";
      const widgets: RadioWidget[] = refs.map((ref, i) => {
        const pageH = ref.page.size.height;
        const pos = widgetRectToPosition(ref.widget, pageH);
        const label = options?.[i] ?? "";
        if (ref.widget.exportValue === selectedValue && selectedValue !== "") {
          selectedLabel = label;
        }
        return {
          value: label,
          page: ref.widget.pageIndex,
          position: pos,
        };
      });
      fields.push({
        ...base,
        type: "radio",
        value: selectedLabel,
        options,
        widgets,
      });
    } else if (type === "dropdown") {
      const selected = selectedLabels(fieldMeta);
      const isMulti = readMultiSelectFlag(fieldMeta.flag);
      fields.push({
        ...base,
        type: "dropdown",
        value: selected,
        options,
        isMultiSelect: isMulti,
      });
    } else if (type === "listbox") {
      const selected = selectedLabels(fieldMeta);
      const isMulti = readMultiSelectFlag(fieldMeta.flag);
      fields.push({
        ...base,
        type: "listbox",
        value: selected,
        options,
        isMultiSelect: isMulti,
      });
    }
  }

  const template: Template = {
    basePdf: basePdfBytes,
    metadata: {
      pageCount: doc.pageCount,
      pages: doc.pages.map((p) => ({
        widthPt: p.size.width,
        heightPt: p.size.height,
      })),
      hasAcroForm: fields.length > 0,
    },
    fields,
  };

  return { template, diagnostics, widgetIndex };
}
