# @fillapp/pdf-sdk

[![npm](https://img.shields.io/npm/v/@fillapp/pdf-sdk.svg)](https://www.npmjs.com/package/@fillapp/pdf-sdk)
[![license](https://img.shields.io/npm/l/@fillapp/pdf-sdk.svg)](LICENSE)

Isomorphic PDF form-filling SDK. One package, one API, runs identically in Node and modern browsers. Pure JavaScript — no native bindings.

> **Status:** 0.2.0 ships full fill + generate + overlay support with a cross-runtime byte-equality contract. API surface is stabilizing; see the [roadmap](#roadmap) for what's left before 1.0.

## What works today

- Load a PDF from `Uint8Array`, `ArrayBuffer`, `Blob`, or base64 string.
- Parse every native AcroForm field (text, checkbox, radio, dropdown, listbox), including radio groups with per-widget positions and hierarchical field names.
- **Fill field values** via `setFieldValue(id, value)` with variant-correct validation, `maxLength` truncation, and rejection of unknown options.
- **Add overlay content** — text (with size + RGB color), PNG/JPEG images, vector checkmark and cross glyphs at arbitrary PDF coordinates, on flat PDFs or on top of AcroForm output.
- **Generate output** — `generate()` preserves the AcroForm; `generate({ flatten: true })` bakes values into page content and safely removes signature fields that would otherwise crash pdf-lib's flatten.
- **Bundled Noto Sans subset** covering Latin, Latin Extended, and Cyrillic — non-Latin field values and overlay text render out of the box. Pass `{ font: ... }` to ship your own.
- **Byte-for-byte determinism** — Node and browser produce identical output bytes for the same `Template` (asserted by the test suite).
- Refuse encrypted documents by default (`allowEncrypted: true` to opt in).
- Structured diagnostics channel — parse, fill, and generate issues surface without silent swallowing.
- Visual regression suite: every generate path produces a committed PNG baseline rendered through `pdfjs-dist`.

## Install

```bash
npm install @fillapp/pdf-sdk
```

## Usage

### Fill and generate

```ts
import { PdfSdk } from "@fillapp/pdf-sdk";

const sdk = await PdfSdk.load(pdfBytes); // Uint8Array | ArrayBuffer | Blob | base64 string

// Inspect the parsed form.
for (const field of sdk.getFields()) {
  console.log(field.id, field.source, field.source === "acroform" ? field.type : field.kind);
}

// Fill values. Value shape must match the field variant.
sdk.setFieldValue("acro:plain_text:0", "Jane Doe");
sdk.setFieldValue("acro:single_check:0", true);
sdk.setFieldValue("acro:shipping:0", "express");
sdk.setFieldValue("acro:country:0", "Armenia");
sdk.setFieldValue("acro:fruit_multi:0", ["Apple", "Cherry"]);

// Default output keeps the AcroForm editable.
const filled = await sdk.generate();

// Flatten for archival output.
const flat = await sdk.generate({ flatten: true });
```

### Overlay content

```ts
// Draw overlay text, images, and glyphs at any PDF-point coordinate.
sdk.addOverlay({
  source: "overlay",
  kind: "text",
  page: 0,
  position: { xPt: 72, yPt: 680, widthPt: 400, heightPt: 20 },
  text: { value: "Signed on 2026-04-18", fontSizePt: 12, color: { r: 0, g: 0, b: 0 } },
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

Kinds surfaced today: `no-widgets`, `orphan-widget`, `value-extraction-failed`, `options-extraction-failed`, `value-truncated`, `signature-flatten-skipped`.

## The `Template` shape

`Template` is plain JSON. Backend and frontend exchange it verbatim — no translation layer.

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

Coordinates are always PDF points, bottom-left origin. Unit-conversion helpers: `ptToMm`, `mmToPt`, `pxToPt`, `ptToPx`, `flipY` — either from the main entry or from `@fillapp/pdf-sdk/utils` for a smaller import (no pdf-lib dependency pulled in).

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
  updateOverlay(id: string, partial: Partial<OverlayField>): void;
  removeOverlay(id: string): void;

  generate(opts?: {
    flatten?: boolean;
    font?: Uint8Array | ArrayBuffer; // override the bundled Noto Sans subset
  }): Promise<Uint8Array>;

  readonly diagnostics: readonly ParseDiagnostic[];
}
```

All getters return independent copies — mutating them does not affect the SDK instance.

## Roadmap

- Cloudflare Workers smoke test in CI.
- CI-generated Linux visual baselines (current committed baselines are darwin).
- Publish to npm.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
npm run build

# Visual regression + cross-runtime determinism (requires Playwright browsers once):
npx playwright install chromium
npm run test:visual          # diff against committed baselines
npm run test:visual:update   # refresh baselines after an intentional change
```

## License

MIT
