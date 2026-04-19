# @fillapp/pdf-sdk

[![npm](https://img.shields.io/npm/v/@fillapp/pdf-sdk.svg)](https://www.npmjs.com/package/@fillapp/pdf-sdk)
[![license](https://img.shields.io/npm/l/@fillapp/pdf-sdk.svg)](LICENSE)

Isomorphic PDF form-filling SDK. One package, one API, runs in Node and modern browsers. Pure JavaScript, no native bindings.

## Status

This is a new project. The API is not yet stable and will change before 1.0. Expect breaking changes between minor versions on the `0.x` line. If you pin a version and read the [CHANGELOG](CHANGELOG.md) before upgrading, it is usable today for AcroForm fill and simple overlays.

Feedback, bug reports, and PRs are welcome.

## What works today

- Load a PDF from `Uint8Array`, `ArrayBuffer`, `Blob`, or base64 string.
- Parse every native AcroForm field (text, checkbox, radio, dropdown, listbox), including radio groups with per-widget positions and hierarchical field names.
- Fill values via `setFieldValue(id, value)` with variant-correct validation, `maxLength` truncation, and rejection of unknown options.
- Draw overlay content: text with size and RGB color, PNG or JPEG images, vector checkmark and cross glyphs at arbitrary PDF coordinates. Works on flat PDFs or on top of AcroForm output.
- `generate()` preserves the AcroForm so Acrobat, Chrome, and Firefox continue to render and edit the form.
- Bundled Noto Sans subset (Latin, Latin Extended, Cyrillic). Pass `{ font }` to ship your own for other scripts.
- Byte-for-byte deterministic output across Node and browser for the same `Template`.
- Encrypted documents are refused by default (`{ allowEncrypted: true }` to opt in).
- Structured diagnostics channel for non-fatal parse, fill, and generate issues.
- Visual regression suite renders every generate path through `pdfjs-dist` and diffs committed PNG baselines.

## Install

```bash
npm install @fillapp/pdf-sdk
```

## Usage

### Fill and generate

```ts
import { PdfSdk } from "@fillapp/pdf-sdk";

const sdk = await PdfSdk.load(pdfBytes); // Uint8Array | ArrayBuffer | Blob | base64 string

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

Kinds surfaced today: `no-widgets`, `orphan-widget`, `value-extraction-failed`, `options-extraction-failed`, `value-truncated`.

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

Coordinates are PDF points, bottom-left origin. Conversion helpers (`ptToMm`, `mmToPt`, `pxToPt`, `ptToPx`, `flipY`) are available from the main entry or from `@fillapp/pdf-sdk/utils` for a smaller import that does not pull in pdf-lib.

## API

```ts
class PdfSdk {
  static load(
    input: Uint8Array | ArrayBuffer | Blob | string,
    opts?: { allowEncrypted?: boolean },
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

  generate(opts?: {
    font?: Uint8Array | ArrayBuffer; // override the bundled Noto Sans subset
  }): Promise<Uint8Array>;

  readonly diagnostics: readonly ParseDiagnostic[];
}
```

All getters return independent copies. Mutating them does not affect the SDK instance.

## Roadmap

Rough priority order. The 0.x line will keep moving until the must-haves ship.

### Must-have before 1.0

- **Reliable rendering across all viewers.** Today `generate()` sets `/NeedAppearances true`, which Acrobat, Chrome, Firefox, and pdf.js honor. iOS Preview, some print pipelines, and PDF-to-image rasterizers do not, and will show filled text and checkboxes as blank. Plan: regenerate appearance streams for text and checkbox fields using the bundled font so the output renders everywhere. Radios, dropdowns, and listboxes stay on the flag path.
- **Batch fill.** `setFieldValues(values)` in a single call, with unknown ids reported as diagnostics instead of throwing so a partial fill is not aborted.
- **Template serialization.** `templateToJSON(template)` and `templateFromJSON(json)` that base64 the `basePdf` so the whole `Template` survives a JSON round-trip. Needed to persist forms server-side and rehydrate in the browser.
- **Per-field font-size override** when the template's Default Appearance is too large for the value. Probably `setFieldValue(id, value, { fontSizePt })`.
- **Real password-protected PDFs.** Today `allowEncrypted: true` opens the file structurally but leaves field streams unreadable. Add a `{ password }` decryption path.
- **Multi-font fallback chain** for mixed-script documents. Accept `fonts: Uint8Array[]` on `GenerateOptions` and fall back in order per glyph.
- **Overlay text styling.** Font family, bold, italic, alignment, rotation, multiline wrap. Needed for legal forms that expect centered names or rotated margin notes.
- **Overlay image extras.** Opacity, aspect-fit, rotation. Signature stamps need aspect-preserve.
- **`clearFieldValue` and `resetForm`.** Ergonomics.
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
