import {
  PdfAnnotationBorderStyle,
  PdfAnnotationLineEnding,
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type AnnotationCreateContext,
  type PdfAnnotationObject,
  type PdfCircleAnnoObject,
  type PdfDocumentObject,
  type PdfEngine,
  type PdfFreeTextAnnoObject,
  type PdfInkAnnoObject,
  type PdfLineAnnoObject,
  type PdfPageObject,
  type PdfPolygonAnnoObject,
  type PdfPolylineAnnoObject,
  type PdfSquareAnnoObject,
  type PdfStampAnnoObject,
  type Position,
} from "@embedpdf/models";
import type {
  AcroFormField,
  Field,
  OverlayEllipse,
  OverlayField,
  OverlayFontFamily,
  OverlayImage,
  OverlayInk,
  OverlayLine,
  OverlayPolygon,
  OverlayPolyline,
  OverlayRect,
  OverlayText,
  OverlayTextAlign,
  OverlayVerticalAlign,
  ParseDiagnostic,
  Point,
  RGB,
  Template,
} from "./types.js";
import { parseToTemplate, type WidgetIndex } from "./parse.js";
import { normalizeInput } from "./utils.js";

/**
 * Distributive Omit — preserves the discriminated union so callers can pass a
 * literal keyed on `kind` and have TS narrow to the matching variant.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

export type OverlayInit = DistributiveOmit<OverlayField, "id">;

export type LoadOptions = {
  /**
   * The PDFium-backed engine (from `@embedpdf/engines`). In the browser, share
   * the engine with the viewer (e.g. the one from `usePdfiumEngine()`) to
   * avoid loading the WASM twice. In Node, create one with `createNodeEngine`
   * from `@fillapp/pdf-sdk/engine/node`.
   */
  engine: PdfEngine<Blob>;

  /**
   * Reuse an already-opened PDFium document handle instead of having the SDK
   * open its own. Used when the viewer already has the same document open
   * and we want to avoid holding two copies in WASM memory.
   *
   * When omitted, the SDK opens its own document from `input`.
   */
  doc?: PdfDocumentObject;
};

export type GenerateOptions = Record<never, never>;

/** Fixed timestamp used during `generate()` so repeat runs stay byte-identical. */
const DETERMINISTIC_DATE = new Date("2000-01-01T00:00:00.000Z");

const DEFAULT_TEXT_COLOR = "#000000";

/**
 * Canonical namespace used to derive deterministic annotation UUIDs. Changing
 * this changes output bytes, so it's pinned.
 */
const OVERLAY_NAMESPACE = "fillapp-overlay";

/**
 * Convert an SDK `{r,g,b}` (0..1) to a web hex color. PDFium's annotation
 * objects take hex strings, not arrays.
 */
function rgbToHex(
  c: RGB | undefined,
  fallback: string = DEFAULT_TEXT_COLOR,
): string {
  if (!c) return fallback;
  const toByte = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(c.r)}${toByte(c.g)}${toByte(c.b)}`.toUpperCase();
}

/**
 * Deterministic FNV-1a 32-bit hash. Used only to derive stable annotation
 * UUIDs from overlay ids — not security-sensitive.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Derive a stable v4-formatted UUID from an overlay id. EmbedPDF requires
 * UUID-v4 shape or it substitutes a random one on create, which would break
 * byte-deterministic output.
 */
function overlayIdToAnnotationUuid(overlayId: string): string {
  const seed = `${OVERLAY_NAMESPACE}:${overlayId}`;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 4; i++) {
    const chunk = fnv1a32(`${seed}:${i}`);
    bytes[i * 4] = (chunk >>> 24) & 0xff;
    bytes[i * 4 + 1] = (chunk >>> 16) & 0xff;
    bytes[i * 4 + 2] = (chunk >>> 8) & 0xff;
    bytes[i * 4 + 3] = chunk & 0xff;
  }
  // Force v4 / variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Convert a bottom-left SDK position to a top-left PDFium annotation rect.
 */
function sdkPositionToAnnotationRect(
  pos: { xPt: number; yPt: number; widthPt: number; heightPt: number },
  pageHeightPt: number,
): PdfAnnotationObject["rect"] {
  return {
    origin: {
      x: pos.xPt,
      y: pageHeightPt - pos.yPt - pos.heightPt,
    },
    size: { width: pos.widthPt, height: pos.heightPt },
  };
}

/**
 * Convert a bottom-left SDK point ({xPt, yPt}) to the PDFium-native top-left
 * screen-space `Position` shape used by line / polyline / polygon / ink
 * vertices. PDFium's engine expects these in the same frame as annotation
 * rects (top-left origin in page points), and inverts Y internally when
 * serialising to the PDF file.
 */
function sdkPointToPdfPoint(p: Point, pageHeightPt: number): Position {
  return { x: p.xPt, y: pageHeightPt - p.yPt };
}

/**
 * Shape interior color. Shapes in PDFium distinguish "no fill" from "black
 * fill"; the engine treats `"transparent"` as a sentinel and explicitly
 * clears the interior color when it sees it.
 */
function rgbToTransparent(c: RGB | undefined): string {
  if (!c) return "transparent";
  return rgbToHex(c);
}

/**
 * Map the SDK's typed font-family token to PDFium's `PdfStandardFont` enum.
 * Defaults to `Helvetica` when omitted — matches the viewer's default so
 * generate() produces identical output when the user never touches the
 * font-family picker.
 */
function fontFamilyToPdf(
  family: OverlayFontFamily | undefined,
): PdfStandardFont {
  switch (family) {
    case "Courier":
      return PdfStandardFont.Courier;
    case "Courier-Bold":
      return PdfStandardFont.Courier_Bold;
    case "Courier-BoldOblique":
      return PdfStandardFont.Courier_BoldOblique;
    case "Courier-Oblique":
      return PdfStandardFont.Courier_Oblique;
    case "Helvetica":
      return PdfStandardFont.Helvetica;
    case "Helvetica-Bold":
      return PdfStandardFont.Helvetica_Bold;
    case "Helvetica-BoldOblique":
      return PdfStandardFont.Helvetica_BoldOblique;
    case "Helvetica-Oblique":
      return PdfStandardFont.Helvetica_Oblique;
    case "Times-Roman":
      return PdfStandardFont.Times_Roman;
    case "Times-Bold":
      return PdfStandardFont.Times_Bold;
    case "Times-BoldItalic":
      return PdfStandardFont.Times_BoldItalic;
    case "Times-Italic":
      return PdfStandardFont.Times_Italic;
    default:
      return PdfStandardFont.Helvetica;
  }
}

function textAlignToPdf(align: OverlayTextAlign | undefined): PdfTextAlignment {
  switch (align) {
    case "center":
      return PdfTextAlignment.Center;
    case "right":
      return PdfTextAlignment.Right;
    case "left":
    default:
      return PdfTextAlignment.Left;
  }
}

function verticalAlignToPdf(
  align: OverlayVerticalAlign | undefined,
): PdfVerticalAlignment {
  switch (align) {
    case "middle":
      return PdfVerticalAlignment.Middle;
    case "bottom":
      return PdfVerticalAlignment.Bottom;
    case "top":
    default:
      return PdfVerticalAlignment.Top;
  }
}

/**
 * Normalize a rotation to the 0..359 range PDFium accepts. `undefined`
 * collapses to 0 so omitted rotation is lossless. Non-finite values and
 * multiples of 360 collapse to 0 as well.
 */
function normalizeRotation(rotation: number | undefined): number {
  if (rotation === undefined || !Number.isFinite(rotation)) return 0;
  const r = rotation % 360;
  return r < 0 ? r + 360 : r;
}

/**
 * Load a PDF, surface every supported AcroForm field as a discriminated-union
 * entry on `Template.fields`, mutate values via `setFieldValue`, draw overlays
 * via `addOverlay`, and bake everything into a new PDF with `generate()`.
 *
 * Internals are PDFium-all-the-way-down so the viewer (EmbedPDF) and the
 * download produced by this SDK render identically.
 *
 * Mutation methods (`setFieldValue`, `addOverlay`, `updateOverlay`,
 * `removeOverlay`) are synchronous from the caller's perspective — they
 * update the SDK's in-memory snapshot and enqueue the PDFium work on an
 * internal serial queue. `generate()` awaits every pending operation before
 * saving, so the output reflects the caller's final state regardless of
 * ordering between calls.
 */
export class PdfSdk {
  /** Append-only log of non-fatal issues surfaced during parse or fill. */
  readonly diagnostics: readonly ParseDiagnostic[];

  private readonly engine: PdfEngine<Blob>;
  private readonly doc: PdfDocumentObject;
  private readonly template: Template;
  private readonly widgetIndex: Map<string, WidgetIndex>;
  /** Overlay id → the PDFium annotation it's backed by. */
  private readonly overlayAnnotations = new Map<
    string,
    { annotation: PdfAnnotationObject; page: PdfPageObject }
  >();

  /** Serial tail for queued async engine work. See `enqueue`. */
  private pending: Promise<void> = Promise.resolve();
  private overlayCounter = 0;

  private constructor(
    engine: PdfEngine<Blob>,
    doc: PdfDocumentObject,
    template: Template,
    diagnostics: readonly ParseDiagnostic[],
    widgetIndex: Map<string, WidgetIndex>,
  ) {
    this.engine = engine;
    this.doc = doc;
    this.template = template;
    this.diagnostics = diagnostics;
    this.widgetIndex = widgetIndex;
  }

  /**
   * Open a PDF and return a ready SDK instance. The caller must provide an
   * engine; see `createBrowserEngine` / `createNodeEngine`.
   */
  static async load(
    input: Uint8Array | ArrayBuffer | Blob | string,
    opts: LoadOptions,
  ): Promise<PdfSdk> {
    if (!opts || !opts.engine) {
      throw new TypeError(
        "PdfSdk.load: opts.engine is required. Pass a PdfEngine from @embedpdf/engines (e.g. createNodeEngine() or the engine from usePdfiumEngine()).",
      );
    }
    const bytes = await normalizeInput(input);
    const engine = opts.engine;

    let doc: PdfDocumentObject;
    if (opts.doc) {
      doc = opts.doc;
    } else {
      const content = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const docId = `fillapp-sdk-${Math.random().toString(36).slice(2, 10)}`;
      doc = await engine.openDocumentBuffer({ id: docId, content }).toPromise();
    }

    const { template, diagnostics, widgetIndex } = await parseToTemplate(
      engine,
      doc,
      bytes,
    );
    return new PdfSdk(engine, doc, template, diagnostics, widgetIndex);
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

  /** The underlying PDFium document handle. Advanced use only. */
  getPdfiumDocument(): PdfDocumentObject {
    return this.doc;
  }

  /**
   * Write a value into the named field, validating that the value shape
   * matches the field's type.
   *
   *   - Text: `string`; `maxLength` enforced via truncation + diagnostic.
   *   - Checkbox: `boolean`.
   *   - Radio: `string` that matches one of `options[]`.
   *   - Dropdown / listbox: `string` or `string[]`; single-select listbox
   *     rejects arrays longer than one.
   *
   * Throws `TypeError` on shape mismatch and `Error` on unknown id /
   * out-of-options value. The engine work is queued and completes before
   * `generate()` returns.
   */
  setFieldValue(id: string, value: string | string[] | boolean): void {
    const field = this.template.fields.find((f) => f.id === id);
    if (!field) throw new Error(`Unknown field id: ${id}`);
    if (field.source !== "acroform") {
      throw new Error(
        `Field ${id} is an overlay; use updateOverlay() instead.`,
      );
    }
    const index = this.widgetIndex.get(id);
    if (!index) {
      throw new Error(`Internal: missing widget index for field ${id}`);
    }

    switch (field.type) {
      case "text":
        this.applyTextValue(field, index, value);
        break;
      case "checkbox":
        this.applyCheckboxValue(field, index, value);
        break;
      case "radio":
        this.applyRadioValue(field, index, value);
        break;
      case "dropdown":
      case "listbox":
        this.applyChoiceValue(field, index, value);
        break;
    }
  }

  /**
   * Add an overlay field to the template. PDFium creates a matching annotation
   * on the enqueue so downloads reflect it via `flattenAnnotation`.
   */
  addOverlay(init: OverlayInit): string {
    const id = `overlay:${this.overlayCounter++}`;
    const field = { ...init, id } as OverlayField;
    this.template.fields.push(field);
    this.enqueue(() => this.createOverlayAnnotation(field));
    return id;
  }

  /**
   * Merge a partial update into the named overlay. `kind` is immutable — the
   * underlying PDFium annotation is deleted and re-created with the new
   * payload, so a single `updateOverlay` call can change text, color, size,
   * or position in one shot without synchronization work at the caller.
   */
  updateOverlay(
    id: string,
    partial: Partial<Omit<OverlayField, "id" | "source" | "kind">>,
  ): void {
    const i = this.findOverlayIndex(id);
    const existing = this.template.fields[i] as OverlayField;
    const merged = {
      ...existing,
      ...partial,
      id: existing.id,
      source: "overlay",
      kind: existing.kind,
    } as OverlayField;
    this.template.fields[i] = merged;

    this.enqueue(async () => {
      const prev = this.overlayAnnotations.get(id);
      if (prev) {
        await this.engine
          .removePageAnnotation(this.doc, prev.page, prev.annotation)
          .toPromise();
        this.overlayAnnotations.delete(id);
      }
      await this.createOverlayAnnotation(merged);
    });
  }

  removeOverlay(id: string): void {
    const i = this.findOverlayIndex(id);
    this.template.fields.splice(i, 1);
    this.enqueue(async () => {
      const prev = this.overlayAnnotations.get(id);
      if (!prev) return;
      this.overlayAnnotations.delete(id);
      await this.engine
        .removePageAnnotation(this.doc, prev.page, prev.annotation)
        .toPromise();
    });
  }

  /**
   * Serialize the document to PDF bytes.
   *
   *   1. Every pending engine operation (field set, overlay create / update /
   *      delete) is awaited.
   *   2. `this.doc` is snapshotted into a scratch PDFium document; every
   *      overlay annotation is flattened on the scratch so the output renders
   *      identically in every PDF viewer. Flattening on the live doc would
   *      consume the annotations — a second `generate()` call would then
   *      reject with "annotation not found".
   *   3. Metadata dates are pinned to a fixed timestamp for byte-deterministic
   *      output.
   */
  async generate(_opts?: GenerateOptions): Promise<Uint8Array> {
    void _opts; // reserved for future parity options
    await this.pending;

    await this.engine
      .setMetadata(this.doc, {
        modificationDate: DETERMINISTIC_DATE,
        creationDate: DETERMINISTIC_DATE,
      })
      .toPromise();

    // Short path: nothing to flatten, save the live doc directly.
    if (this.overlayAnnotations.size === 0) {
      const widgetNms = await this.collectWidgetNms(this.doc);
      const ab = await this.engine.saveAsCopy(this.doc).toPromise();
      return normalizeNMs(new Uint8Array(ab), widgetNms);
    }

    // Snapshot the live doc into bytes and reopen as a scratch doc. Flatten
    // on the scratch so `this.doc` retains every overlay annotation for
    // subsequent mutations / generates.
    const snapshot = await this.engine.saveAsCopy(this.doc).toPromise();
    const scratchId = `fillapp-sdk-scratch-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const scratch = await this.engine
      .openDocumentBuffer({ id: scratchId, content: snapshot })
      .toPromise();

    try {
      // Our overlay annotations carry stable UUIDs — find matching
      // annotations on the scratch doc by id and flatten each.
      const wantedIds = new Set(
        Array.from(this.overlayAnnotations.keys()).map(
          overlayIdToAnnotationUuid,
        ),
      );
      for (const page of scratch.pages) {
        const annotations = await this.engine
          .getPageAnnotations(scratch, page)
          .toPromise();
        for (const a of annotations) {
          if (wantedIds.has(a.id)) {
            await this.engine.flattenAnnotation(scratch, page, a).toPromise();
          }
        }
      }

      const widgetNms = await this.collectWidgetNms(scratch);
      const ab = await this.engine.saveAsCopy(scratch).toPromise();
      return normalizeNMs(new Uint8Array(ab), widgetNms);
    } finally {
      await this.engine.closeDocument(scratch).toPromise();
    }
  }

  /**
   * Collect every widget NM across a document's pages. PDFium synthesizes a
   * random v4 UUID for any widget that didn't carry an `/NM` in the source
   * PDF; we normalize these in the output bytes so repeat saves of the same
   * template are byte-identical.
   */
  private async collectWidgetNms(doc: PdfDocumentObject): Promise<string[]> {
    const out: string[] = [];
    for (const page of doc.pages) {
      const widgets = await this.engine
        .getPageAnnoWidgets(doc, page)
        .toPromise();
      for (const w of widgets) out.push(w.id);
    }
    return out;
  }

  // ---- private mutation helpers ------------------------------------------

  private findOverlayIndex(id: string): number {
    const i = this.template.fields.findIndex((f) => f.id === id);
    if (i < 0) throw new Error(`Unknown overlay id: ${id}`);
    if (this.template.fields[i].source !== "overlay") {
      throw new Error(`Field ${id} is not an overlay`);
    }
    return i;
  }

  /**
   * Chain a task onto the internal pending queue. Swallowing rejection here
   * keeps one failed op from breaking the chain; the rejection itself is
   * rethrown when a future `generate()` awaits the tail, via a re-assignment
   * to `this.pending` that preserves the error.
   */
  private enqueue(task: () => Promise<void>): void {
    this.pending = this.pending.then(task, (prevErr) => {
      // If a prior task failed, still run this one so generate() has the
      // latest state — but resurface the earliest error on the tail.
      return task().finally(() => {
        throw prevErr;
      });
    });
  }

  private async regenerateFor(index: WidgetIndex): Promise<void> {
    // Regenerate appearance streams for every widget of this field, grouped
    // by page so we minimise engine round-trips.
    const byPage = new Map<PdfPageObject, string[]>();
    for (const { page, widget } of index.widgets) {
      let ids = byPage.get(page);
      if (!ids) {
        ids = [];
        byPage.set(page, ids);
      }
      ids.push(widget.id);
    }
    for (const [page, ids] of byPage) {
      await this.engine
        .regenerateWidgetAppearances(this.doc, page, ids)
        .toPromise();
    }
  }

  private applyTextValue(
    field: Extract<AcroFormField, { type: "text" }>,
    index: WidgetIndex,
    value: string | string[] | boolean,
  ): void {
    if (typeof value !== "string") {
      throw new TypeError(
        `Text field "${field.acroFieldName}" requires a string; got ${describe(value)}.`,
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
    this.replaceField({ ...field, value: final });
    this.enqueue(async () => {
      for (const { page, widget } of index.widgets) {
        await this.engine
          .setFormFieldValue(this.doc, page, widget, {
            kind: "text",
            text: final,
          })
          .toPromise();
      }
      await this.regenerateFor(index);
    });
  }

  private applyCheckboxValue(
    field: Extract<AcroFormField, { type: "checkbox" }>,
    index: WidgetIndex,
    value: string | string[] | boolean,
  ): void {
    if (typeof value !== "boolean") {
      throw new TypeError(
        `Checkbox "${field.acroFieldName}" requires a boolean; got ${describe(value)}.`,
      );
    }
    this.replaceField({ ...field, value });
    this.enqueue(async () => {
      for (const { page, widget } of index.widgets) {
        await this.engine
          .setFormFieldValue(this.doc, page, widget, {
            kind: "checked",
            checked: value,
          })
          .toPromise();
      }
      await this.regenerateFor(index);
    });
  }

  private applyRadioValue(
    field: Extract<AcroFormField, { type: "radio" }>,
    index: WidgetIndex,
    value: string | string[] | boolean,
  ): void {
    if (typeof value !== "string") {
      throw new TypeError(
        `Radio "${field.acroFieldName}" requires a string; got ${describe(value)}.`,
      );
    }
    if (field.options && !field.options.includes(value)) {
      throw new Error(
        `Radio "${field.acroFieldName}" has no option "${value}". Valid: ${field.options.join(", ")}.`,
      );
    }
    const widgetIdx = field.widgets.findIndex((w) => w.value === value);
    if (widgetIdx < 0) {
      throw new Error(
        `Radio "${field.acroFieldName}" has no widget for option "${value}".`,
      );
    }
    const target = index.widgets[widgetIdx];
    if (!target) {
      throw new Error(
        `Internal: widget index ${widgetIdx} out of range for field ${field.id}.`,
      );
    }
    this.replaceField({ ...field, value });
    this.enqueue(async () => {
      await this.engine
        .setFormFieldValue(this.doc, target.page, target.widget, {
          kind: "checked",
          checked: true,
        })
        .toPromise();
      await this.regenerateFor(index);
    });
  }

  private applyChoiceValue(
    field: Extract<AcroFormField, { type: "dropdown" | "listbox" }>,
    index: WidgetIndex,
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

    const options = field.options ?? [];
    const selectedIdx = new Set<number>();
    for (const v of values) {
      const i = options.indexOf(v);
      if (i >= 0) selectedIdx.add(i);
    }

    // Snapshot previously-selected indexes so we can compute deselects.
    const previouslySelected = new Set<number>();
    for (let i = 0; i < options.length; i++) {
      if (field.value.includes(options[i])) previouslySelected.add(i);
    }

    this.replaceField({ ...field, value: values });
    this.enqueue(async () => {
      for (const { page, widget } of index.widgets) {
        if (field.isMultiSelect) {
          // Deselect indexes that were selected but aren't any more.
          for (const i of previouslySelected) {
            if (selectedIdx.has(i)) continue;
            await this.engine
              .setFormFieldValue(this.doc, page, widget, {
                kind: "selection",
                index: i,
                isSelected: false,
              })
              .toPromise();
          }
        }
        // Select target indexes. PDFium auto-clears the rest for
        // single-select; for multi-select our explicit deselect above
        // already cleared the ones we no longer want.
        for (const i of selectedIdx) {
          await this.engine
            .setFormFieldValue(this.doc, page, widget, {
              kind: "selection",
              index: i,
              isSelected: true,
            })
            .toPromise();
        }
      }
      await this.regenerateFor(index);
    });
  }

  private async createOverlayAnnotation(field: OverlayField): Promise<void> {
    const page = this.doc.pages[field.page];
    if (!page) {
      this.pushDiagnostic({
        kind: "orphan-widget",
        message: `Overlay ${field.id} targets page ${field.page} but the document has only ${this.doc.pageCount} pages; skipped.`,
      });
      return;
    }
    const annotationId = overlayIdToAnnotationUuid(field.id);
    const rect = sdkPositionToAnnotationRect(field.position, page.size.height);

    switch (field.kind) {
      case "text": {
        const annotation: PdfFreeTextAnnoObject = {
          type: PdfAnnotationSubtype.FREETEXT,
          id: annotationId,
          pageIndex: field.page,
          rect,
          rotation: normalizeRotation(field.rotation),
          contents: field.text.value,
          fontFamily: fontFamilyToPdf(field.text.fontFamily),
          fontSize: field.text.fontSizePt,
          fontColor: rgbToHex(field.text.color),
          textAlign: textAlignToPdf(field.text.textAlign),
          verticalAlign: verticalAlignToPdf(field.text.verticalAlign),
          opacity: field.text.opacity ?? 1,
          color: field.text.backgroundColor
            ? rgbToHex(field.text.backgroundColor)
            : "transparent",
        };
        await this.engine
          .createPageAnnotation(this.doc, page, annotation)
          .toPromise();
        this.overlayAnnotations.set(field.id, { annotation, page });
        return;
      }
      case "image": {
        await this.createImageOverlay(field, page, rect, annotationId);
        return;
      }
      case "checkmark": {
        const annotation = this.buildGlyphAnnotation(
          annotationId,
          field.page,
          rect,
          "\u2714", // HEAVY CHECK MARK
          field.color,
          field.rotation,
        );
        await this.engine
          .createPageAnnotation(this.doc, page, annotation)
          .toPromise();
        this.overlayAnnotations.set(field.id, { annotation, page });
        return;
      }
      case "cross": {
        const annotation = this.buildGlyphAnnotation(
          annotationId,
          field.page,
          rect,
          "\u2718", // HEAVY BALLOT X
          field.color,
          field.rotation,
        );
        await this.engine
          .createPageAnnotation(this.doc, page, annotation)
          .toPromise();
        this.overlayAnnotations.set(field.id, { annotation, page });
        return;
      }
      case "rect": {
        const annotation = this.buildRectAnnotation(
          annotationId,
          field,
          page.size.height,
        );
        await this.engine
          .createPageAnnotation(this.doc, page, annotation)
          .toPromise();
        this.overlayAnnotations.set(field.id, { annotation, page });
        return;
      }
      case "ellipse": {
        const annotation = this.buildEllipseAnnotation(
          annotationId,
          field,
          page.size.height,
        );
        await this.engine
          .createPageAnnotation(this.doc, page, annotation)
          .toPromise();
        this.overlayAnnotations.set(field.id, { annotation, page });
        return;
      }
      case "line": {
        const annotation = this.buildLineAnnotation(
          annotationId,
          field,
          page.size.height,
        );
        await this.engine
          .createPageAnnotation(this.doc, page, annotation)
          .toPromise();
        this.overlayAnnotations.set(field.id, { annotation, page });
        return;
      }
      case "polyline": {
        const annotation = this.buildPolylineAnnotation(
          annotationId,
          field,
          page.size.height,
        );
        await this.engine
          .createPageAnnotation(this.doc, page, annotation)
          .toPromise();
        this.overlayAnnotations.set(field.id, { annotation, page });
        return;
      }
      case "polygon": {
        const annotation = this.buildPolygonAnnotation(
          annotationId,
          field,
          page.size.height,
        );
        await this.engine
          .createPageAnnotation(this.doc, page, annotation)
          .toPromise();
        this.overlayAnnotations.set(field.id, { annotation, page });
        return;
      }
      case "ink": {
        const annotation = this.buildInkAnnotation(
          annotationId,
          field,
          page.size.height,
        );
        await this.engine
          .createPageAnnotation(this.doc, page, annotation)
          .toPromise();
        this.overlayAnnotations.set(field.id, { annotation, page });
        return;
      }
    }
  }

  private buildRectAnnotation(
    annotationId: string,
    field: OverlayRect,
    pageHeightPt: number,
  ): PdfSquareAnnoObject {
    const rect = sdkPositionToAnnotationRect(field.position, pageHeightPt);
    return {
      type: PdfAnnotationSubtype.SQUARE,
      id: annotationId,
      pageIndex: field.page,
      rect,
      rotation: normalizeRotation(field.rotation),
      flags: [],
      color: rgbToTransparent(field.fill),
      strokeColor: rgbToHex(field.stroke),
      strokeWidth: field.strokeWidthPt ?? 1,
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
      opacity: field.opacity ?? 1,
    };
  }

  private buildEllipseAnnotation(
    annotationId: string,
    field: OverlayEllipse,
    pageHeightPt: number,
  ): PdfCircleAnnoObject {
    const rect = sdkPositionToAnnotationRect(field.position, pageHeightPt);
    return {
      type: PdfAnnotationSubtype.CIRCLE,
      id: annotationId,
      pageIndex: field.page,
      rect,
      rotation: normalizeRotation(field.rotation),
      flags: [],
      color: rgbToTransparent(field.fill),
      strokeColor: rgbToHex(field.stroke),
      strokeWidth: field.strokeWidthPt ?? 1,
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
      opacity: field.opacity ?? 1,
    };
  }

  private buildLineAnnotation(
    annotationId: string,
    field: OverlayLine,
    pageHeightPt: number,
  ): PdfLineAnnoObject {
    const rect = sdkPositionToAnnotationRect(field.position, pageHeightPt);
    return {
      type: PdfAnnotationSubtype.LINE,
      id: annotationId,
      pageIndex: field.page,
      rect,
      rotation: normalizeRotation(field.rotation),
      linePoints: {
        start: sdkPointToPdfPoint(field.start, pageHeightPt),
        end: sdkPointToPdfPoint(field.end, pageHeightPt),
      },
      lineEndings: field.arrowEnd
        ? {
            start: PdfAnnotationLineEnding.None,
            end: PdfAnnotationLineEnding.OpenArrow,
          }
        : undefined,
      intent: field.arrowEnd ? "LineArrow" : undefined,
      color: "transparent",
      strokeColor: rgbToHex(field.stroke),
      strokeWidth: field.strokeWidthPt ?? 1,
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
      opacity: field.opacity ?? 1,
    };
  }

  private buildPolylineAnnotation(
    annotationId: string,
    field: OverlayPolyline,
    pageHeightPt: number,
  ): PdfPolylineAnnoObject {
    const rect = sdkPositionToAnnotationRect(field.position, pageHeightPt);
    return {
      type: PdfAnnotationSubtype.POLYLINE,
      id: annotationId,
      pageIndex: field.page,
      rect,
      rotation: normalizeRotation(field.rotation),
      vertices: field.points.map((p) => sdkPointToPdfPoint(p, pageHeightPt)),
      color: "transparent",
      strokeColor: rgbToHex(field.stroke),
      strokeWidth: field.strokeWidthPt ?? 1,
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
      opacity: field.opacity ?? 1,
    };
  }

  private buildPolygonAnnotation(
    annotationId: string,
    field: OverlayPolygon,
    pageHeightPt: number,
  ): PdfPolygonAnnoObject {
    const rect = sdkPositionToAnnotationRect(field.position, pageHeightPt);
    return {
      type: PdfAnnotationSubtype.POLYGON,
      id: annotationId,
      pageIndex: field.page,
      rect,
      rotation: normalizeRotation(field.rotation),
      vertices: field.points.map((p) => sdkPointToPdfPoint(p, pageHeightPt)),
      color: rgbToTransparent(field.fill),
      strokeColor: rgbToHex(field.stroke),
      strokeWidth: field.strokeWidthPt ?? 1,
      strokeStyle: PdfAnnotationBorderStyle.SOLID,
      opacity: field.opacity ?? 1,
    };
  }

  private buildInkAnnotation(
    annotationId: string,
    field: OverlayInk,
    pageHeightPt: number,
  ): PdfInkAnnoObject {
    const rect = sdkPositionToAnnotationRect(field.position, pageHeightPt);
    return {
      type: PdfAnnotationSubtype.INK,
      id: annotationId,
      pageIndex: field.page,
      rect,
      rotation: normalizeRotation(field.rotation),
      intent: field.intent === "highlight" ? "InkHighlight" : undefined,
      inkList: field.strokes.map((stroke) => ({
        points: stroke.map((p) => sdkPointToPdfPoint(p, pageHeightPt)),
      })),
      strokeColor: rgbToHex(field.stroke),
      strokeWidth: field.strokeWidthPt ?? 1,
      opacity: field.opacity ?? 1,
    };
  }

  private buildGlyphAnnotation(
    annotationId: string,
    pageIndex: number,
    rect: PdfAnnotationObject["rect"],
    glyph: string,
    color: RGB | undefined,
    rotation: number | undefined,
  ): PdfFreeTextAnnoObject {
    // ZapfDingbats is one of the 14 standard PDF fonts (always available).
    // U+2714 / U+2718 are in its built-in glyph table, so no font embedding
    // or subset handling is required.
    const fontSize = Math.max(
      4,
      Math.min(rect.size.width, rect.size.height) * 0.8,
    );
    return {
      type: PdfAnnotationSubtype.FREETEXT,
      id: annotationId,
      pageIndex,
      rect,
      rotation: normalizeRotation(rotation),
      contents: glyph,
      fontFamily: PdfStandardFont.ZapfDingbats,
      fontSize,
      fontColor: rgbToHex(color),
      textAlign: PdfTextAlignment.Center,
      verticalAlign: PdfVerticalAlignment.Middle,
      opacity: 1,
    };
  }

  private async createImageOverlay(
    field: OverlayImage,
    page: PdfPageObject,
    rect: PdfAnnotationObject["rect"],
    annotationId: string,
  ): Promise<void> {
    const annotation: PdfStampAnnoObject = {
      type: PdfAnnotationSubtype.STAMP,
      id: annotationId,
      pageIndex: field.page,
      rect,
      rotation: normalizeRotation(field.rotation),
      contents: "",
    };
    // PDFium copies the image bytes out, so the ArrayBuffer we hand over can
    // be reclaimed after the call.
    const context: AnnotationCreateContext<PdfStampAnnoObject> = {
      data: field.image.bytes.buffer.slice(
        field.image.bytes.byteOffset,
        field.image.bytes.byteOffset + field.image.bytes.byteLength,
      ) as ArrayBuffer,
      mimeType: field.image.mime,
    };
    await this.engine
      .createPageAnnotation(this.doc, page, annotation, context)
      .toPromise();
    this.overlayAnnotations.set(field.id, { annotation, page });
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

/**
 * Rewrite every widget `/NM(<uuid>)` in the saved PDF bytes with a stable,
 * position-derived identifier. The replacement UUID is also 36 chars long so
 * byte offsets (and thus the `/xref` table) remain valid.
 *
 * This is a workaround for EmbedPDF's engine assigning a random UUID v4 to
 * any widget that lacks `/NM` in the source — which makes repeated saves of
 * the same template produce byte-different outputs without any other change.
 */
function normalizeNMs(bytes: Uint8Array, sourceNms: string[]): Uint8Array {
  if (sourceNms.length === 0) return bytes;

  // Build a stable-UUID mapping from the NMs PDFium reported, preserving
  // visit order so the i-th widget always gets the i-th stable UUID.
  const mapping = new Map<string, string>();
  for (let i = 0; i < sourceNms.length; i++) {
    if (!mapping.has(sourceNms[i])) {
      mapping.set(sourceNms[i], stableWidgetUuid(i));
    }
  }

  // Work on a mutable copy so we can do in-place byte rewrites. Because UUID
  // v4 strings are 36 ASCII bytes, the substitutions preserve every byte
  // offset — the PDF cross-reference table and stream lengths remain valid.
  const out = new Uint8Array(bytes);
  for (const [from, to] of mapping) {
    if (from.length !== to.length) continue;
    const fromBytes = asciiToBytes(from);
    const toBytes = asciiToBytes(to);
    replaceBytesInPlace(out, fromBytes, toBytes);
  }
  return out;
}

function asciiToBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

/**
 * Replace every occurrence of `from` with `to` inside `buf`. Assumes the two
 * patterns have the same length (caller guarantees). O(n * m) search — fine
 * for our sizes (a few hundred widgets × a 36-byte needle).
 */
function replaceBytesInPlace(
  buf: Uint8Array,
  from: Uint8Array,
  to: Uint8Array,
): void {
  const len = from.length;
  if (len === 0 || buf.length < len) return;
  outer: for (let i = 0; i <= buf.length - len; i++) {
    for (let j = 0; j < len; j++) {
      if (buf[i + j] !== from[j]) continue outer;
    }
    for (let j = 0; j < len; j++) buf[i + j] = to[j];
    i += len - 1;
  }
}

/**
 * Produce a stable v4-formatted UUID derived from an ordinal position. Used
 * only to rewrite widget NMs in the output — not security-sensitive.
 */
function stableWidgetUuid(index: number): string {
  // Deterministic hex string seeded with the index so different widgets get
  // different UUIDs (otherwise two widgets would collide after normalization).
  const hex = index.toString(16).padStart(32, "0");
  // Force v4 / variant bits on the fixed positions.
  const bytes = hex.split("");
  bytes[12] = "4";
  // The variant nibble (char at position 16 in the raw string) is always 8.
  bytes[16] = "8";
  const s = bytes.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

// Re-export for callers that want a single import.
export type { OverlayText };
