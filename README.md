# @fillapp/pdf-sdk

[![npm](https://img.shields.io/npm/v/@fillapp/pdf-sdk.svg)](https://www.npmjs.com/package/@fillapp/pdf-sdk)
[![license](https://img.shields.io/npm/l/@fillapp/pdf-sdk.svg)](LICENSE)

Isomorphic PDF form-filling SDK. One package, one API, runs in Node and modern browsers. Uses PDFium (via EmbedPDF's WASM engine) for every file read and every byte written, so the AcroForm rendering done in a viewer and the PDF produced by `generate()` come from the same code path — pixel-identical fills by construction.

## Status

This is a new project. The API is not yet stable and will change before 1.0. Expect breaking changes between minor versions on the `0.x` line. If you pin a version and read the [CHANGELOG](CHANGELOG.md) before upgrading, it is usable today for AcroForm fill and simple overlays.

Feedback, bug reports, and PRs are welcome.

## What works today

- Load a PDF from `Uint8Array`, `ArrayBuffer`, `Blob`, or base64 string.
- Parse every native AcroForm field (text, checkbox, radio, dropdown, listbox), including radio groups with per-widget positions and hierarchical field names.
- Fill values via `setFieldValue(id, value)` with variant-correct validation, `maxLength` truncation, and rejection of unknown options.
- Draw overlay content: text with size and RGB color, PNG or JPEG images, check and cross glyphs at arbitrary PDF coordinates. Works on flat PDFs or on top of AcroForm output. All overlays are flattened into the page content stream on generate, so every viewer shows them.
- `generate()` regenerates widget appearance streams for filled fields, so iOS Preview, print pipelines, and rasterizers that ignore `/NeedAppearances` still render correctly.
- Overlay text uses the 14 standard PDF fonts baked into PDFium (Helvetica, ZapfDingbats, etc.) — no font embedding, no bundle weight, no subset handling.
- Byte-for-byte deterministic output across Node and browser for the same `Template`.
- Structured diagnostics channel for non-fatal parse, fill, and generate issues.
- Visual regression suite renders every generate path through `pdfjs-dist` and diffs committed PNG baselines.

## Install

```bash
npm install @fillapp/pdf-sdk @embedpdf/engines @embedpdf/models @embedpdf/pdfium
```

The SDK declares the three `@embedpdf/*` packages as peer dependencies so consumers who already use EmbedPDF (for the viewer) don't end up with duplicate copies.

## Usage

### Create an engine and fill a form

```ts
import { PdfSdk } from "@fillapp/pdf-sdk";
import { createNodeEngine } from "@fillapp/pdf-sdk/engine/node";

const engine = await createNodeEngine();
const sdk = await PdfSdk.load(pdfBytes, { engine });

for (const field of sdk.getFields()) {
  console.log(
    field.id,
    field.source,
    field.source === "acroform" ? field.type : field.kind,
  );
}

sdk.setFieldValue("acro:plain_text:0", "Jane Doe");
sdk.setFieldValue("acro:single_check:0", true);
sdk.setFieldValue("acro:shipping:0", "express");
sdk.setFieldValue("acro:country:0", "Armenia");
sdk.setFieldValue("acro:fruit_multi:0", ["Apple", "Cherry"]);

const filled = await sdk.generate();
```

### Overlay content

```ts
sdk.addOverlay({
  source: "overlay",
  kind: "text",
  page: 0,
  position: { xPt: 72, yPt: 680, widthPt: 400, heightPt: 20 },
  text: {
    value: "Signed on 2026-04-18",
    fontSizePt: 12,
    color: { r: 0, g: 0, b: 0 },
  },
});

sdk.addOverlay({
  source: "overlay",
  kind: "image",
  page: 0,
  position: { xPt: 72, yPt: 560, widthPt: 120, heightPt: 120 },
  image: { bytes: signaturePngBytes, mime: "image/png" },
});

sdk.addOverlay({
  source: "overlay",
  kind: "checkmark",
  page: 0,
  position: { xPt: 220, yPt: 600, widthPt: 24, heightPt: 24 },
  color: { r: 0.15, g: 0.55, b: 0.2 },
});

const out = await sdk.generate(); // overlays are drawn on top of AcroForm fills
```

### Diagnostics

```ts
for (const diag of sdk.diagnostics) {
  console.warn(`[${diag.kind}] ${diag.fieldName ?? ""}: ${diag.message}`);
}
```

Kinds surfaced today: `orphan-widget`, `value-truncated`.

## The `Template` shape

`Template` is plain JSON. Backend and frontend exchange it verbatim, no translation layer.

```ts
type Template = {
  basePdf: Uint8Array;
  metadata: {
    pageCount: number;
    pages: { widthPt: number; heightPt: number }[];
    hasAcroForm: boolean;
  };
  fields: Field[]; // AcroFormField | OverlayField
};
```

Coordinates are PDF points, bottom-left origin. Conversion helpers (`ptToMm`, `mmToPt`, `pxToPt`, `ptToPx`, `flipY`) are available from the main entry or from `@fillapp/pdf-sdk/utils` for a smaller import.

## API

```ts
class PdfSdk {
  static load(
    input: Uint8Array | ArrayBuffer | Blob | string,
    opts: {
      engine: PdfEngine<Blob>; // required; from @embedpdf/engines
      doc?: PdfDocumentObject; // optional: reuse an already-open PDFium doc
    },
  ): Promise<PdfSdk>;

  toTemplate(): Template;
  getFields(): Field[];
  getField(id: string): Field | null;

  setFieldValue(id: string, value: string | string[] | boolean): void;

  addOverlay(field: OverlayInit): string;
  updateOverlay(
    id: string,
    partial: Partial<Omit<OverlayField, "id" | "source" | "kind">>,
  ): void;
  removeOverlay(id: string): void;

  generate(): Promise<Uint8Array>;

  readonly diagnostics: readonly ParseDiagnostic[];
}
```

The engine is injected so the SDK is free of any environment-specific bootstrapping. Two helpers wrap the official EmbedPDF setup if you aren't already running one:

- **Node:** `import { createNodeEngine } from "@fillapp/pdf-sdk/engine/node"` — loads the PDFium WASM bundled with `@embedpdf/pdfium` from disk.
- **Browser:** `import { createBrowserEngine } from "@fillapp/pdf-sdk/engine/browser"` — boots PDFium in a Web Worker, fetching the WASM from jsDelivr by default. Pass `{ wasmUrl }` to self-host.

When the app already owns an engine (e.g. React + EmbedPDF's `usePdfiumEngine()`), pass that one in instead of creating a second — it halves the PDFium memory footprint.

All getters return independent copies. Mutating them does not affect the SDK instance. Mutation methods are synchronous from the caller's perspective: engine work is queued and awaited inside `generate()`.

## Roadmap

Rough priority order. The 0.x line will keep moving until the must-haves ship.

### Must-have before 1.0

- **Custom overlay fonts.** PDFium's FreeText annotation is currently restricted to the 14 standard PDF fonts. For Unicode coverage beyond Latin-1 (CJK, Arabic, non-Latin European scripts) we need a path that embeds a TTF and uses it for overlay text — either upstream in EmbedPDF's annotation model or via a pre-flattened image-stamp fallback.
- **Batch fill.** `setFieldValues(values)` in a single call, with unknown ids reported as diagnostics instead of throwing so a partial fill is not aborted.
- **Per-field font-size override** when the template's Default Appearance is too large for the value. Probably `setFieldValue(id, value, { fontSizePt })`.
- **Password-protected PDFs.** Accept `{ password }` in `LoadOptions` and pass it through to PDFium.
- **Overlay text styling.** Bold, italic, alignment, rotation, multiline wrap. (Font size and color already work — they flow straight to PDFium's FreeText annotation.)
- **Overlay image extras.** Opacity, aspect-fit, rotation. Signature stamps need aspect-preserve.
- **`clearFieldValue` and `resetForm`.** Ergonomics.
- **`sdk.close()`.** Release the PDFium document without tearing down the whole engine. Today callers need to call `engine.closeAllDocuments()` / `engine.destroy()` themselves.
- **PDF metadata on `generate()`.** Optional title, author, producer, pdfVersion.
- **CI visual regression job** with committed Linux baselines alongside the current darwin ones.
- **Cloudflare Workers smoke test in CI** to back the isomorphic claim for Workers.
- **Code of conduct, issue and PR templates.**

### Explicitly out of scope

- XFA forms. If we see one, we flag it and degrade to the AcroForm fallback.
- True digital signatures (PKI, certificates, timestamping, long-term validation).
- Execution of PDF-embedded JavaScript actions.
- OCR on scanned pages.
- Page split, merge, reorder, compression, or format conversion.
- Rendering and viewing PDFs. Use `pdf.js` or similar on top.
- Real-time collaboration. `Template` is plain JSON; layer whatever sync model you want on top.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
npm run build

# Visual regression and cross-runtime determinism (requires Playwright browsers once):
npx playwright install chromium
npm run test:visual          # diff against committed baselines
npm run test:visual:update   # refresh baselines after an intentional change
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full PR checklist.

## License

MIT
