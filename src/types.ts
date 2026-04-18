/**
 * Canonical document model. Serializable; round-trips cleanly through JSON
 * once `basePdf` is base64-encoded by the consumer.
 *
 * Coordinates are PDF native: points, bottom-left origin.
 */

export type Template = {
  basePdf: Uint8Array;
  metadata: {
    pageCount: number;
    pages: Array<{ widthPt: number; heightPt: number }>;
    hasAcroForm: boolean;
  };
  fields: Field[];
};

export type Field = AcroFormField | OverlayField;

export type AcroFormFieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "listbox";

type BaseAcroForm<T extends AcroFormFieldType> = {
  id: string;
  source: "acroform";
  /** Original PDF field name. Used for round-trip writeback. */
  acroFieldName: string;
  type: T;
  /** 0-indexed page. */
  page: number;
  position: { xPt: number; yPt: number; widthPt: number; heightPt: number };
  readOnly: boolean;
};

export type TextField = BaseAcroForm<"text"> & {
  value: string;
  maxLength?: number;
  multiline: boolean;
};

export type CheckboxField = BaseAcroForm<"checkbox"> & {
  value: boolean;
};

export type RadioWidget = {
  /** The on-value this widget represents (same as one of `options[]`). */
  value: string;
  page: number;
  position: { xPt: number; yPt: number; widthPt: number; heightPt: number };
};

export type RadioField = BaseAcroForm<"radio"> & {
  value: string;
  options?: string[];
  /**
   * Every radio button in the group. `position` on the base field mirrors the
   * first widget for backwards compatibility; consumers that render the full
   * group (one hit target per option) should read `widgets` instead.
   */
  widgets: RadioWidget[];
};

export type DropdownField = BaseAcroForm<"dropdown"> & {
  value: string[];
  options?: string[];
  isMultiSelect: boolean;
};

export type ListboxField = BaseAcroForm<"listbox"> & {
  value: string[];
  options?: string[];
  isMultiSelect: boolean;
};

export type AcroFormField =
  | TextField
  | CheckboxField
  | RadioField
  | DropdownField
  | ListboxField;

/**
 * Content drawn directly onto page content streams — not part of any AcroForm
 * structure. Backend and frontend both add, edit, and remove overlays through
 * the same API; they serialize into `Template.fields` alongside AcroForm
 * entries and are discriminated by `source`.
 */
export type OverlayKind = "text" | "image" | "checkmark" | "cross";

export type RGB = { r: number; g: number; b: number };

type BaseOverlay<K extends OverlayKind> = {
  id: string;
  source: "overlay";
  kind: K;
  page: number;
  position: { xPt: number; yPt: number; widthPt: number; heightPt: number };
};

export type OverlayText = BaseOverlay<"text"> & {
  text: {
    value: string;
    /** Size in PDF points. */
    fontSizePt: number;
    /** 0..1 RGB. Defaults to black when omitted. */
    color?: RGB;
  };
};

export type OverlayImage = BaseOverlay<"image"> & {
  image: {
    bytes: Uint8Array;
    mime: "image/png" | "image/jpeg";
  };
};

export type OverlayCheckmark = BaseOverlay<"checkmark"> & {
  /** Stroke color. Defaults to black. */
  color?: RGB;
};

export type OverlayCross = BaseOverlay<"cross"> & {
  /** Stroke color. Defaults to black. */
  color?: RGB;
};

export type OverlayField =
  | OverlayText
  | OverlayImage
  | OverlayCheckmark
  | OverlayCross;

/**
 * Non-fatal issue encountered during parse, fill, or generate.
 * Historically called `ParseDiagnostic`; kept that name for back-compat.
 */
export type ParseDiagnostic = {
  /** Original AcroForm field name, if the issue is field-scoped. */
  fieldName?: string;
  kind:
    | "no-widgets"
    | "orphan-widget"
    | "value-extraction-failed"
    | "options-extraction-failed"
    | "value-truncated"
    | "signature-flatten-skipped";
  message: string;
};

export type ParseResult = {
  template: Template;
  diagnostics: ParseDiagnostic[];
};
