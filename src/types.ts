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
 * Overlay content — drawn directly onto page content streams. Intended for
 * flat / scanned PDFs that have no AcroForm structure to fill. Overlays do
 * NOT compete with AcroForm rendering; consumers should use `setFieldValue`
 * for AcroForm fields and reserve overlays for positions where no
 * interactive field exists.
 *
 * Rect-based overlays (text, image, checkmark, cross, rect, ellipse) are
 * positioned via `position: {xPt, yPt, widthPt, heightPt}` in PDF points,
 * bottom-left origin. Shape overlays (line, polyline, polygon, ink) carry
 * their own point arrays; `position` is the derived axis-aligned bounding
 * box around those points and stays in sync with them.
 */
export type OverlayKind =
  | "text"
  | "image"
  | "checkmark"
  | "cross"
  | "rect"
  | "ellipse"
  | "line"
  | "polyline"
  | "polygon"
  | "ink";

export type RGB = { r: number; g: number; b: number };

/** A single point in PDF native coordinates (points, bottom-left origin). */
export type Point = { xPt: number; yPt: number };

/**
 * The subset of `PdfStandardFont` (from `@embedpdf/models`) we expose on
 * overlay text. Named in the SDK so consumers don't need a peer import just
 * to pick a font. Mirrors PDFium's built-in 14-font set (minus `Unknown`,
 * `Symbol`, and `ZapfDingbats` which we reserve for internal glyph overlays).
 */
export type OverlayFontFamily =
  | "Courier"
  | "Courier-Bold"
  | "Courier-BoldOblique"
  | "Courier-Oblique"
  | "Helvetica"
  | "Helvetica-Bold"
  | "Helvetica-BoldOblique"
  | "Helvetica-Oblique"
  | "Times-Roman"
  | "Times-Bold"
  | "Times-BoldItalic"
  | "Times-Italic";

/** Horizontal text alignment for free-text overlays. */
export type OverlayTextAlign = "left" | "center" | "right";

/** Vertical text alignment for free-text overlays. */
export type OverlayVerticalAlign = "top" | "middle" | "bottom";

type BaseOverlay<K extends OverlayKind> = {
  id: string;
  source: "overlay";
  kind: K;
  page: number;
  position: { xPt: number; yPt: number; widthPt: number; heightPt: number };
  /**
   * Clockwise rotation in degrees applied around the overlay's center.
   * `position` remains the axis-aligned bounding box after rotation. Matches
   * PDFium's `PdfAnnotationObjectBase.rotation`. Defaults to 0 when omitted.
   */
  rotation?: number;
};

export type OverlayText = BaseOverlay<"text"> & {
  text: {
    value: string;
    /** Size in PDF points. */
    fontSizePt: number;
    /** Font color. 0..1 RGB. Defaults to black when omitted. */
    color?: RGB;
    /** Font family. Defaults to Helvetica. */
    fontFamily?: OverlayFontFamily;
    /** Horizontal alignment. Defaults to "left". */
    textAlign?: OverlayTextAlign;
    /** Vertical alignment within the rect. Defaults to "top". */
    verticalAlign?: OverlayVerticalAlign;
    /** Background fill color. Omit for transparent background. */
    backgroundColor?: RGB;
    /** Opacity 0..1. Defaults to 1 when omitted. */
    opacity?: number;
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

/**
 * Rectangle shape overlay. Uses `position` as the drawn rect. Unset `stroke`
 * means no border; unset `fill` means no interior fill (just the outline).
 * Stroke width in PDF points. Mirrors PDFium's `PdfSquareAnnoObject`.
 */
export type OverlayRect = BaseOverlay<"rect"> & {
  stroke?: RGB;
  strokeWidthPt?: number;
  fill?: RGB;
  opacity?: number;
};

/**
 * Ellipse shape overlay. Inscribed in `position` (same semantics as a PDF
 * Circle annotation). Mirrors PDFium's `PdfCircleAnnoObject`.
 */
export type OverlayEllipse = BaseOverlay<"ellipse"> & {
  stroke?: RGB;
  strokeWidthPt?: number;
  fill?: RGB;
  opacity?: number;
};

/**
 * Straight line between two points. `arrowEnd` draws an open arrowhead at
 * `end`. `position` is the axis-aligned bounding box of the two endpoints
 * and is kept in sync by the SDK on create / update. Mirrors PDFium's
 * `PdfLineAnnoObject.linePoints`.
 */
export type OverlayLine = BaseOverlay<"line"> & {
  start: Point;
  end: Point;
  stroke?: RGB;
  strokeWidthPt?: number;
  arrowEnd?: boolean;
  opacity?: number;
};

/**
 * Open polyline through N >= 2 points. Mirrors PDFium's `PdfPolylineAnnoObject`.
 */
export type OverlayPolyline = BaseOverlay<"polyline"> & {
  points: Point[];
  stroke?: RGB;
  strokeWidthPt?: number;
  opacity?: number;
};

/**
 * Closed polygon through N >= 3 points. Mirrors PDFium's `PdfPolygonAnnoObject`.
 */
export type OverlayPolygon = BaseOverlay<"polygon"> & {
  points: Point[];
  stroke?: RGB;
  strokeWidthPt?: number;
  fill?: RGB;
  opacity?: number;
};

/**
 * Free-form ink. One or more strokes, each a sequence of points. Mirrors
 * PDFium's `PdfInkAnnoObject.inkList` exactly. `intent: "highlight"` maps
 * to PDFium's `InkHighlight` intent (used by the ink-highlighter tool).
 */
export type OverlayInk = BaseOverlay<"ink"> & {
  strokes: Point[][];
  stroke?: RGB;
  strokeWidthPt?: number;
  opacity?: number;
  intent?: "highlight";
};

export type OverlayField =
  | OverlayText
  | OverlayImage
  | OverlayCheckmark
  | OverlayCross
  | OverlayRect
  | OverlayEllipse
  | OverlayLine
  | OverlayPolyline
  | OverlayPolygon
  | OverlayInk;

/**
 * Non-fatal issue encountered during parse or fill. The SDK never silently
 * swallows errors — anything that fails quietly at lower levels of PDFium
 * gets surfaced here so consumers can decide how to handle it.
 */
export type ParseDiagnostic = {
  /** Original AcroForm field name, if the issue is field-scoped. */
  fieldName?: string;
  kind:
    | "no-widgets"
    | "orphan-widget"
    | "value-extraction-failed"
    | "options-extraction-failed"
    | "value-truncated";
  message: string;
};

export type ParseResult = {
  template: Template;
  diagnostics: ParseDiagnostic[];
};
