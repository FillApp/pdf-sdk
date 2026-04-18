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

export type Field = AcroFormField;

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

export type RadioField = BaseAcroForm<"radio"> & {
  value: string;
  options?: string[];
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
