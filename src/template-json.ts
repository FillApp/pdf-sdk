/**
 * JSON serialization for `Template`. The runtime shape carries a `Uint8Array`
 * (`basePdf`) plus image overlay byte buffers, neither of which survives a
 * naive `JSON.stringify`. These helpers wrap an envelope around the template
 * so the on-the-wire representation is plain JSON: byte buffers go to base64,
 * everything else stays structural.
 *
 * Pure JSON in / pure Template out — no PDF parsing, no engine, no fs, no
 * Buffer. The functions here are isomorphic and rely on the base64 helpers in
 * `./utils.ts` for the only platform-sensitive step.
 */

import type {
  AcroFormField,
  CheckboxField,
  DropdownField,
  Field,
  ListboxField,
  OverlayCheckmark,
  OverlayCross,
  OverlayEllipse,
  OverlayField,
  OverlayImage,
  OverlayInk,
  OverlayLine,
  OverlayPolygon,
  OverlayPolyline,
  OverlayRect,
  OverlayText,
  Point,
  RadioField,
  RadioWidget,
  RGB,
  Template,
  TextField,
} from "./types.js";
import { base64ToBytes, bytesToBase64 } from "./utils.js";

/**
 * Schema version. Bump when an incompatible shape change ships and add a
 * migration in `templateFromJSON`. Keeping the field present from day one
 * means even v1 documents declare themselves loudly.
 */
const SCHEMA_VERSION = 1;

type Position = { xPt: number; yPt: number; widthPt: number; heightPt: number };

type SerializedRGB = { r: number; g: number; b: number };

type SerializedRadioWidget = {
  value: string;
  page: number;
  position: Position;
};

type SerializedTextField = {
  id: string;
  source: "acroform";
  type: "text";
  acroFieldName: string;
  page: number;
  position: Position;
  readOnly: boolean;
  value: string;
  multiline: boolean;
  /** Omitted when undefined to mirror the runtime shape exactly. */
  maxLength?: number;
};

type SerializedCheckboxField = {
  id: string;
  source: "acroform";
  type: "checkbox";
  acroFieldName: string;
  page: number;
  position: Position;
  readOnly: boolean;
  value: boolean;
};

type SerializedRadioField = {
  id: string;
  source: "acroform";
  type: "radio";
  acroFieldName: string;
  page: number;
  position: Position;
  readOnly: boolean;
  value: string;
  widgets: SerializedRadioWidget[];
  options?: string[];
};

type SerializedDropdownField = {
  id: string;
  source: "acroform";
  type: "dropdown";
  acroFieldName: string;
  page: number;
  position: Position;
  readOnly: boolean;
  value: string[];
  isMultiSelect: boolean;
  options?: string[];
};

type SerializedListboxField = {
  id: string;
  source: "acroform";
  type: "listbox";
  acroFieldName: string;
  page: number;
  position: Position;
  readOnly: boolean;
  value: string[];
  isMultiSelect: boolean;
  options?: string[];
};

type SerializedAcroFormField =
  | SerializedTextField
  | SerializedCheckboxField
  | SerializedRadioField
  | SerializedDropdownField
  | SerializedListboxField;

type SerializedOverlayText = {
  id: string;
  source: "overlay";
  kind: "text";
  page: number;
  position: Position;
  text: {
    value: string;
    fontSizePt: number;
    color?: SerializedRGB;
  };
};

type SerializedOverlayImage = {
  id: string;
  source: "overlay";
  kind: "image";
  page: number;
  position: Position;
  image: {
    bytesBase64: string;
    mime: "image/png" | "image/jpeg";
  };
};

type SerializedOverlayCheckmark = {
  id: string;
  source: "overlay";
  kind: "checkmark";
  page: number;
  position: Position;
  color?: SerializedRGB;
};

type SerializedOverlayCross = {
  id: string;
  source: "overlay";
  kind: "cross";
  page: number;
  position: Position;
  color?: SerializedRGB;
};

type SerializedPoint = { xPt: number; yPt: number };

type SerializedOverlayRect = {
  id: string;
  source: "overlay";
  kind: "rect";
  page: number;
  position: Position;
  stroke?: SerializedRGB;
  strokeWidthPt?: number;
  fill?: SerializedRGB;
  opacity?: number;
};

type SerializedOverlayEllipse = {
  id: string;
  source: "overlay";
  kind: "ellipse";
  page: number;
  position: Position;
  stroke?: SerializedRGB;
  strokeWidthPt?: number;
  fill?: SerializedRGB;
  opacity?: number;
};

type SerializedOverlayLine = {
  id: string;
  source: "overlay";
  kind: "line";
  page: number;
  position: Position;
  start: SerializedPoint;
  end: SerializedPoint;
  stroke?: SerializedRGB;
  strokeWidthPt?: number;
  arrowEnd?: boolean;
  opacity?: number;
};

type SerializedOverlayPolyline = {
  id: string;
  source: "overlay";
  kind: "polyline";
  page: number;
  position: Position;
  points: SerializedPoint[];
  stroke?: SerializedRGB;
  strokeWidthPt?: number;
  opacity?: number;
};

type SerializedOverlayPolygon = {
  id: string;
  source: "overlay";
  kind: "polygon";
  page: number;
  position: Position;
  points: SerializedPoint[];
  stroke?: SerializedRGB;
  strokeWidthPt?: number;
  fill?: SerializedRGB;
  opacity?: number;
};

type SerializedOverlayInk = {
  id: string;
  source: "overlay";
  kind: "ink";
  page: number;
  position: Position;
  strokes: SerializedPoint[][];
  stroke?: SerializedRGB;
  strokeWidthPt?: number;
  opacity?: number;
  intent?: "highlight";
};

type SerializedOverlayField =
  | SerializedOverlayText
  | SerializedOverlayImage
  | SerializedOverlayCheckmark
  | SerializedOverlayCross
  | SerializedOverlayRect
  | SerializedOverlayEllipse
  | SerializedOverlayLine
  | SerializedOverlayPolyline
  | SerializedOverlayPolygon
  | SerializedOverlayInk;

type SerializedField = SerializedAcroFormField | SerializedOverlayField;

type SerializedTemplate = {
  version: typeof SCHEMA_VERSION;
  basePdfBase64: string;
  metadata: {
    pageCount: number;
    pages: Array<{ widthPt: number; heightPt: number }>;
    hasAcroForm: boolean;
  };
  fields: SerializedField[];
};

// ---- helpers ----------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function copyPosition(p: Position): Position {
  return {
    xPt: p.xPt,
    yPt: p.yPt,
    widthPt: p.widthPt,
    heightPt: p.heightPt,
  };
}

function copyRGB(c: RGB): SerializedRGB {
  return { r: c.r, g: c.g, b: c.b };
}

function copyPoint(p: Point): SerializedPoint {
  return { xPt: p.xPt, yPt: p.yPt };
}

// ---- serialization ----------------------------------------------------------

function serializeField(field: Field): SerializedField {
  if (field.source === "acroform") return serializeAcroFormField(field);
  return serializeOverlayField(field);
}

function serializeAcroFormField(field: AcroFormField): SerializedAcroFormField {
  switch (field.type) {
    case "text": {
      const out: SerializedTextField = {
        id: field.id,
        source: "acroform",
        type: "text",
        acroFieldName: field.acroFieldName,
        page: field.page,
        position: copyPosition(field.position),
        readOnly: field.readOnly,
        value: field.value,
        multiline: field.multiline,
      };
      if (field.maxLength !== undefined) out.maxLength = field.maxLength;
      return out;
    }
    case "checkbox":
      return {
        id: field.id,
        source: "acroform",
        type: "checkbox",
        acroFieldName: field.acroFieldName,
        page: field.page,
        position: copyPosition(field.position),
        readOnly: field.readOnly,
        value: field.value,
      };
    case "radio": {
      const out: SerializedRadioField = {
        id: field.id,
        source: "acroform",
        type: "radio",
        acroFieldName: field.acroFieldName,
        page: field.page,
        position: copyPosition(field.position),
        readOnly: field.readOnly,
        value: field.value,
        widgets: field.widgets.map((w) => ({
          value: w.value,
          page: w.page,
          position: copyPosition(w.position),
        })),
      };
      if (field.options !== undefined) out.options = [...field.options];
      return out;
    }
    case "dropdown": {
      const out: SerializedDropdownField = {
        id: field.id,
        source: "acroform",
        type: "dropdown",
        acroFieldName: field.acroFieldName,
        page: field.page,
        position: copyPosition(field.position),
        readOnly: field.readOnly,
        value: [...field.value],
        isMultiSelect: field.isMultiSelect,
      };
      if (field.options !== undefined) out.options = [...field.options];
      return out;
    }
    case "listbox": {
      const out: SerializedListboxField = {
        id: field.id,
        source: "acroform",
        type: "listbox",
        acroFieldName: field.acroFieldName,
        page: field.page,
        position: copyPosition(field.position),
        readOnly: field.readOnly,
        value: [...field.value],
        isMultiSelect: field.isMultiSelect,
      };
      if (field.options !== undefined) out.options = [...field.options];
      return out;
    }
  }
}

function serializeOverlayField(field: OverlayField): SerializedOverlayField {
  switch (field.kind) {
    case "text": {
      const out: SerializedOverlayText = {
        id: field.id,
        source: "overlay",
        kind: "text",
        page: field.page,
        position: copyPosition(field.position),
        text: {
          value: field.text.value,
          fontSizePt: field.text.fontSizePt,
        },
      };
      if (field.text.color !== undefined) {
        out.text.color = copyRGB(field.text.color);
      }
      return out;
    }
    case "image":
      return {
        id: field.id,
        source: "overlay",
        kind: "image",
        page: field.page,
        position: copyPosition(field.position),
        image: {
          bytesBase64: bytesToBase64(field.image.bytes),
          mime: field.image.mime,
        },
      };
    case "checkmark": {
      const out: SerializedOverlayCheckmark = {
        id: field.id,
        source: "overlay",
        kind: "checkmark",
        page: field.page,
        position: copyPosition(field.position),
      };
      if (field.color !== undefined) out.color = copyRGB(field.color);
      return out;
    }
    case "cross": {
      const out: SerializedOverlayCross = {
        id: field.id,
        source: "overlay",
        kind: "cross",
        page: field.page,
        position: copyPosition(field.position),
      };
      if (field.color !== undefined) out.color = copyRGB(field.color);
      return out;
    }
    case "rect": {
      const out: SerializedOverlayRect = {
        id: field.id,
        source: "overlay",
        kind: "rect",
        page: field.page,
        position: copyPosition(field.position),
      };
      if (field.stroke !== undefined) out.stroke = copyRGB(field.stroke);
      if (field.strokeWidthPt !== undefined)
        out.strokeWidthPt = field.strokeWidthPt;
      if (field.fill !== undefined) out.fill = copyRGB(field.fill);
      if (field.opacity !== undefined) out.opacity = field.opacity;
      return out;
    }
    case "ellipse": {
      const out: SerializedOverlayEllipse = {
        id: field.id,
        source: "overlay",
        kind: "ellipse",
        page: field.page,
        position: copyPosition(field.position),
      };
      if (field.stroke !== undefined) out.stroke = copyRGB(field.stroke);
      if (field.strokeWidthPt !== undefined)
        out.strokeWidthPt = field.strokeWidthPt;
      if (field.fill !== undefined) out.fill = copyRGB(field.fill);
      if (field.opacity !== undefined) out.opacity = field.opacity;
      return out;
    }
    case "line": {
      const out: SerializedOverlayLine = {
        id: field.id,
        source: "overlay",
        kind: "line",
        page: field.page,
        position: copyPosition(field.position),
        start: copyPoint(field.start),
        end: copyPoint(field.end),
      };
      if (field.stroke !== undefined) out.stroke = copyRGB(field.stroke);
      if (field.strokeWidthPt !== undefined)
        out.strokeWidthPt = field.strokeWidthPt;
      if (field.arrowEnd !== undefined) out.arrowEnd = field.arrowEnd;
      if (field.opacity !== undefined) out.opacity = field.opacity;
      return out;
    }
    case "polyline": {
      const out: SerializedOverlayPolyline = {
        id: field.id,
        source: "overlay",
        kind: "polyline",
        page: field.page,
        position: copyPosition(field.position),
        points: field.points.map(copyPoint),
      };
      if (field.stroke !== undefined) out.stroke = copyRGB(field.stroke);
      if (field.strokeWidthPt !== undefined)
        out.strokeWidthPt = field.strokeWidthPt;
      if (field.opacity !== undefined) out.opacity = field.opacity;
      return out;
    }
    case "polygon": {
      const out: SerializedOverlayPolygon = {
        id: field.id,
        source: "overlay",
        kind: "polygon",
        page: field.page,
        position: copyPosition(field.position),
        points: field.points.map(copyPoint),
      };
      if (field.stroke !== undefined) out.stroke = copyRGB(field.stroke);
      if (field.strokeWidthPt !== undefined)
        out.strokeWidthPt = field.strokeWidthPt;
      if (field.fill !== undefined) out.fill = copyRGB(field.fill);
      if (field.opacity !== undefined) out.opacity = field.opacity;
      return out;
    }
    case "ink": {
      const out: SerializedOverlayInk = {
        id: field.id,
        source: "overlay",
        kind: "ink",
        page: field.page,
        position: copyPosition(field.position),
        strokes: field.strokes.map((s) => s.map(copyPoint)),
      };
      if (field.stroke !== undefined) out.stroke = copyRGB(field.stroke);
      if (field.strokeWidthPt !== undefined)
        out.strokeWidthPt = field.strokeWidthPt;
      if (field.opacity !== undefined) out.opacity = field.opacity;
      if (field.intent !== undefined) out.intent = field.intent;
      return out;
    }
  }
}

/**
 * Serialize a `Template` to a JSON string. `basePdf` (Uint8Array) is encoded
 * as base64 under `basePdfBase64`; image overlay byte buffers are encoded the
 * same way under `image.bytesBase64`. Everything else round-trips as plain
 * JSON. The output is deterministic — two calls with the same input produce
 * byte-identical strings (property iteration order is fixed by construction).
 */
export function templateToJSON(template: Template): string {
  const envelope: SerializedTemplate = {
    version: SCHEMA_VERSION,
    basePdfBase64: bytesToBase64(template.basePdf),
    metadata: {
      pageCount: template.metadata.pageCount,
      pages: template.metadata.pages.map((p) => ({
        widthPt: p.widthPt,
        heightPt: p.heightPt,
      })),
      hasAcroForm: template.metadata.hasAcroForm,
    },
    fields: template.fields.map(serializeField),
  };
  return JSON.stringify(envelope, null, 2);
}

// ---- deserialization --------------------------------------------------------

function fail(message: string): never {
  throw new Error(`templateFromJSON: ${message}`);
}

function requireKey<T extends string>(
  obj: Record<string, unknown>,
  key: T,
  context: string,
): unknown {
  if (!(key in obj)) fail(`${context} is missing required key "${key}".`);
  return obj[key];
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const v = requireKey(obj, key, context);
  if (typeof v !== "string") {
    fail(`${context}.${key} must be a string, got ${typeof v}.`);
  }
  return v;
}

function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): number {
  const v = requireKey(obj, key, context);
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(`${context}.${key} must be a finite number.`);
  }
  return v;
}

function requireBoolean(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): boolean {
  const v = requireKey(obj, key, context);
  if (typeof v !== "boolean") {
    fail(`${context}.${key} must be a boolean.`);
  }
  return v;
}

function requireObject(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const v = requireKey(obj, key, context);
  if (!isPlainObject(v)) {
    fail(`${context}.${key} must be an object.`);
  }
  return v;
}

function requireArray(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): unknown[] {
  const v = requireKey(obj, key, context);
  if (!Array.isArray(v)) {
    fail(`${context}.${key} must be an array.`);
  }
  return v;
}

function readPosition(obj: Record<string, unknown>, context: string): Position {
  const p = requireObject(obj, "position", context);
  return {
    xPt: requireNumber(p, "xPt", `${context}.position`),
    yPt: requireNumber(p, "yPt", `${context}.position`),
    widthPt: requireNumber(p, "widthPt", `${context}.position`),
    heightPt: requireNumber(p, "heightPt", `${context}.position`),
  };
}

function readRGB(value: unknown, context: string): RGB {
  if (!isPlainObject(value)) {
    fail(`${context} color must be an object with r,g,b numbers.`);
  }
  return {
    r: requireNumber(value, "r", context),
    g: requireNumber(value, "g", context),
    b: requireNumber(value, "b", context),
  };
}

function readStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) fail(`${context} must be a string array.`);
  return value.map((v, i) => {
    if (typeof v !== "string") {
      fail(`${context}[${i}] must be a string.`);
    }
    return v;
  });
}

function readAcroFormField(
  obj: Record<string, unknown>,
  context: string,
): AcroFormField {
  const id = requireString(obj, "id", context);
  const acroFieldName = requireString(obj, "acroFieldName", context);
  const page = requireNumber(obj, "page", context);
  const readOnly = requireBoolean(obj, "readOnly", context);
  const position = readPosition(obj, context);
  const type = requireString(obj, "type", context);

  const base = {
    id,
    source: "acroform" as const,
    acroFieldName,
    page,
    position,
    readOnly,
  };

  switch (type) {
    case "text": {
      const value = requireString(obj, "value", context);
      const multiline = requireBoolean(obj, "multiline", context);
      const text: TextField = {
        ...base,
        type: "text",
        value,
        multiline,
      };
      if ("maxLength" in obj && obj.maxLength !== undefined) {
        const ml = obj.maxLength;
        if (typeof ml !== "number" || !Number.isFinite(ml)) {
          fail(`${context}.maxLength must be a finite number when present.`);
        }
        text.maxLength = ml;
      }
      return text;
    }
    case "checkbox": {
      const value = requireBoolean(obj, "value", context);
      const cb: CheckboxField = { ...base, type: "checkbox", value };
      return cb;
    }
    case "radio": {
      const value = requireString(obj, "value", context);
      const widgetsRaw = requireArray(obj, "widgets", context);
      const widgets: RadioWidget[] = widgetsRaw.map((w, i) => {
        const wctx = `${context}.widgets[${i}]`;
        if (!isPlainObject(w)) fail(`${wctx} must be an object.`);
        return {
          value: requireString(w, "value", wctx),
          page: requireNumber(w, "page", wctx),
          position: readPosition(w, wctx),
        };
      });
      const radio: RadioField = {
        ...base,
        type: "radio",
        value,
        widgets,
      };
      if ("options" in obj && obj.options !== undefined) {
        radio.options = readStringArray(obj.options, `${context}.options`);
      }
      return radio;
    }
    case "dropdown": {
      const value = readStringArray(
        requireKey(obj, "value", context),
        `${context}.value`,
      );
      const isMultiSelect = requireBoolean(obj, "isMultiSelect", context);
      const dd: DropdownField = {
        ...base,
        type: "dropdown",
        value,
        isMultiSelect,
      };
      if ("options" in obj && obj.options !== undefined) {
        dd.options = readStringArray(obj.options, `${context}.options`);
      }
      return dd;
    }
    case "listbox": {
      const value = readStringArray(
        requireKey(obj, "value", context),
        `${context}.value`,
      );
      const isMultiSelect = requireBoolean(obj, "isMultiSelect", context);
      const lb: ListboxField = {
        ...base,
        type: "listbox",
        value,
        isMultiSelect,
      };
      if ("options" in obj && obj.options !== undefined) {
        lb.options = readStringArray(obj.options, `${context}.options`);
      }
      return lb;
    }
    default:
      return fail(`${context}.type "${type}" is not a known AcroForm type.`);
  }
}

function readOverlayField(
  obj: Record<string, unknown>,
  context: string,
): OverlayField {
  const id = requireString(obj, "id", context);
  const page = requireNumber(obj, "page", context);
  const position = readPosition(obj, context);
  const kind = requireString(obj, "kind", context);
  const base = {
    id,
    source: "overlay" as const,
    page,
    position,
  };
  switch (kind) {
    case "text": {
      const t = requireObject(obj, "text", context);
      const text: OverlayText = {
        ...base,
        kind: "text",
        text: {
          value: requireString(t, "value", `${context}.text`),
          fontSizePt: requireNumber(t, "fontSizePt", `${context}.text`),
        },
      };
      if ("color" in t && t.color !== undefined) {
        text.text.color = readRGB(t.color, `${context}.text.color`);
      }
      return text;
    }
    case "image": {
      const im = requireObject(obj, "image", context);
      const bytesBase64 = requireString(im, "bytesBase64", `${context}.image`);
      const mime = requireString(im, "mime", `${context}.image`);
      if (mime !== "image/png" && mime !== "image/jpeg") {
        fail(
          `${context}.image.mime must be "image/png" or "image/jpeg", got "${mime}".`,
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(bytesBase64);
      } catch (err) {
        fail(
          `${context}.image.bytesBase64 is not valid base64: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      const image: OverlayImage = {
        ...base,
        kind: "image",
        image: { bytes, mime },
      };
      return image;
    }
    case "checkmark": {
      const cm: OverlayCheckmark = { ...base, kind: "checkmark" };
      if ("color" in obj && obj.color !== undefined) {
        cm.color = readRGB(obj.color, `${context}.color`);
      }
      return cm;
    }
    case "cross": {
      const cr: OverlayCross = { ...base, kind: "cross" };
      if ("color" in obj && obj.color !== undefined) {
        cr.color = readRGB(obj.color, `${context}.color`);
      }
      return cr;
    }
    case "rect": {
      const r: OverlayRect = { ...base, kind: "rect" };
      applyShapeStyle(r, obj, context);
      return r;
    }
    case "ellipse": {
      const e: OverlayEllipse = { ...base, kind: "ellipse" };
      applyShapeStyle(e, obj, context);
      return e;
    }
    case "line": {
      const start = readPoint(
        requireKey(obj, "start", context),
        `${context}.start`,
      );
      const end = readPoint(requireKey(obj, "end", context), `${context}.end`);
      const line: OverlayLine = { ...base, kind: "line", start, end };
      if ("stroke" in obj && obj.stroke !== undefined) {
        line.stroke = readRGB(obj.stroke, `${context}.stroke`);
      }
      if ("strokeWidthPt" in obj && obj.strokeWidthPt !== undefined) {
        line.strokeWidthPt = requireNumberVal(
          obj.strokeWidthPt,
          `${context}.strokeWidthPt`,
        );
      }
      if ("arrowEnd" in obj && obj.arrowEnd !== undefined) {
        if (typeof obj.arrowEnd !== "boolean") {
          fail(`${context}.arrowEnd must be a boolean when present.`);
        }
        line.arrowEnd = obj.arrowEnd;
      }
      if ("opacity" in obj && obj.opacity !== undefined) {
        line.opacity = requireNumberVal(obj.opacity, `${context}.opacity`);
      }
      return line;
    }
    case "polyline": {
      const pts = readPointArray(
        requireKey(obj, "points", context),
        `${context}.points`,
      );
      const p: OverlayPolyline = { ...base, kind: "polyline", points: pts };
      if ("stroke" in obj && obj.stroke !== undefined) {
        p.stroke = readRGB(obj.stroke, `${context}.stroke`);
      }
      if ("strokeWidthPt" in obj && obj.strokeWidthPt !== undefined) {
        p.strokeWidthPt = requireNumberVal(
          obj.strokeWidthPt,
          `${context}.strokeWidthPt`,
        );
      }
      if ("opacity" in obj && obj.opacity !== undefined) {
        p.opacity = requireNumberVal(obj.opacity, `${context}.opacity`);
      }
      return p;
    }
    case "polygon": {
      const pts = readPointArray(
        requireKey(obj, "points", context),
        `${context}.points`,
      );
      const p: OverlayPolygon = { ...base, kind: "polygon", points: pts };
      applyShapeStyle(p, obj, context);
      return p;
    }
    case "ink": {
      const strokesRaw = requireKey(obj, "strokes", context);
      if (!Array.isArray(strokesRaw)) {
        fail(`${context}.strokes must be an array of point arrays.`);
      }
      const strokes = strokesRaw.map((s, i) =>
        readPointArray(s, `${context}.strokes[${i}]`),
      );
      const ink: OverlayInk = { ...base, kind: "ink", strokes };
      if ("stroke" in obj && obj.stroke !== undefined) {
        ink.stroke = readRGB(obj.stroke, `${context}.stroke`);
      }
      if ("strokeWidthPt" in obj && obj.strokeWidthPt !== undefined) {
        ink.strokeWidthPt = requireNumberVal(
          obj.strokeWidthPt,
          `${context}.strokeWidthPt`,
        );
      }
      if ("opacity" in obj && obj.opacity !== undefined) {
        ink.opacity = requireNumberVal(obj.opacity, `${context}.opacity`);
      }
      if ("intent" in obj && obj.intent !== undefined) {
        if (obj.intent !== "highlight") {
          fail(
            `${context}.intent must be "highlight" when present; got ${JSON.stringify(obj.intent)}.`,
          );
        }
        ink.intent = "highlight";
      }
      return ink;
    }
    default:
      return fail(`${context}.kind "${kind}" is not a known overlay kind.`);
  }
}

function requireNumberVal(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${context} must be a finite number.`);
  }
  return value;
}

function readPoint(value: unknown, context: string): Point {
  if (!isPlainObject(value))
    fail(`${context} must be an object with xPt, yPt.`);
  return {
    xPt: requireNumber(value, "xPt", context),
    yPt: requireNumber(value, "yPt", context),
  };
}

function readPointArray(value: unknown, context: string): Point[] {
  if (!Array.isArray(value)) fail(`${context} must be an array of points.`);
  return value.map((v, i) => readPoint(v, `${context}[${i}]`));
}

function applyShapeStyle(
  target: {
    stroke?: RGB;
    strokeWidthPt?: number;
    fill?: RGB;
    opacity?: number;
  },
  obj: Record<string, unknown>,
  context: string,
): void {
  if ("stroke" in obj && obj.stroke !== undefined) {
    target.stroke = readRGB(obj.stroke, `${context}.stroke`);
  }
  if ("strokeWidthPt" in obj && obj.strokeWidthPt !== undefined) {
    target.strokeWidthPt = requireNumberVal(
      obj.strokeWidthPt,
      `${context}.strokeWidthPt`,
    );
  }
  if ("fill" in obj && obj.fill !== undefined) {
    target.fill = readRGB(obj.fill, `${context}.fill`);
  }
  if ("opacity" in obj && obj.opacity !== undefined) {
    target.opacity = requireNumberVal(obj.opacity, `${context}.opacity`);
  }
}

function readField(value: unknown, context: string): Field {
  if (!isPlainObject(value)) fail(`${context} must be an object.`);
  const source = requireString(value, "source", context);
  if (source === "acroform") return readAcroFormField(value, context);
  if (source === "overlay") return readOverlayField(value, context);
  return fail(`${context}.source "${source}" must be "acroform" or "overlay".`);
}

/**
 * Inverse of `templateToJSON`. Throws `Error` with a message naming the
 * offending key on any structural violation. Does NOT re-parse the PDF;
 * `basePdf` is restored byte-for-byte from `basePdfBase64`.
 */
export function templateFromJSON(json: string): Template {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    fail(
      `input is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!isPlainObject(parsed)) {
    fail("input must decode to an object.");
  }

  if (!("version" in parsed)) {
    fail('missing required key "version".');
  }
  const version = parsed.version;
  if (version !== SCHEMA_VERSION) {
    fail(
      `unsupported version ${JSON.stringify(version)}; expected ${SCHEMA_VERSION}.`,
    );
  }

  const basePdfBase64 = requireString(parsed, "basePdfBase64", "template");
  let basePdf: Uint8Array;
  try {
    basePdf = base64ToBytes(basePdfBase64);
  } catch (err) {
    fail(
      `basePdfBase64 is not valid base64: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const metadataRaw = requireObject(parsed, "metadata", "template");
  const pageCount = requireNumber(
    metadataRaw,
    "pageCount",
    "template.metadata",
  );
  const hasAcroForm = requireBoolean(
    metadataRaw,
    "hasAcroForm",
    "template.metadata",
  );
  const pagesRaw = requireArray(metadataRaw, "pages", "template.metadata");
  const pages = pagesRaw.map((p, i) => {
    const ctx = `template.metadata.pages[${i}]`;
    if (!isPlainObject(p)) fail(`${ctx} must be an object.`);
    return {
      widthPt: requireNumber(p, "widthPt", ctx),
      heightPt: requireNumber(p, "heightPt", ctx),
    };
  });

  const fieldsRaw = requireArray(parsed, "fields", "template");
  const fields = fieldsRaw.map((f, i) => readField(f, `template.fields[${i}]`));

  return {
    basePdf,
    metadata: { pageCount, pages, hasAcroForm },
    fields,
  };
}
