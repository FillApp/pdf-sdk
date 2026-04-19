export {
  PdfSdk,
  type GenerateOptions,
  type LoadOptions,
  type OverlayInit,
} from "./sdk.js";
export { parseToTemplate } from "./parse.js";
export { templateToJSON, templateFromJSON } from "./template-json.js";
export type {
  Template,
  Field,
  AcroFormField,
  AcroFormFieldType,
  TextField,
  CheckboxField,
  RadioField,
  RadioWidget,
  DropdownField,
  ListboxField,
  OverlayField,
  OverlayKind,
  OverlayText,
  OverlayImage,
  OverlayCheckmark,
  OverlayCross,
  OverlayRect,
  OverlayEllipse,
  OverlayLine,
  OverlayPolyline,
  OverlayPolygon,
  OverlayInk,
  OverlayFontFamily,
  OverlayTextAlign,
  OverlayVerticalAlign,
  Point,
  RGB,
  ParseDiagnostic,
  ParseResult,
} from "./types.js";

export {
  ptToMm,
  mmToPt,
  pxToPt,
  ptToPx,
  flipY,
  base64ToBytes,
  bytesToBase64,
  normalizeInput,
} from "./utils.js";

// Also expose as a namespace for ergonomics.
export * as utils from "./utils.js";
