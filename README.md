# @fillapp/pdf-sdk

[![npm](https://img.shields.io/npm/v/@fillapp/pdf-sdk.svg)](https://www.npmjs.com/package/@fillapp/pdf-sdk)
[![license](https://img.shields.io/npm/l/@fillapp/pdf-sdk.svg)](LICENSE)

Isomorphic PDF form-filling SDK. One package, one API, runs identically in Node and modern browsers. Pure JavaScript — no native bindings.

> **Status:** early development. Core fill and generate work now ship alongside parsing (v0.1.0-alpha). Overlay content (text/images/glyphs) and a browser test suite are next — see the [roadmap](#roadmap).

## What works today

- Load a PDF from `Uint8Array`, `ArrayBuffer`, `Blob`, or base64 string.
- Parse every native AcroForm field (text, checkbox, radio, dropdown, listbox).
- Extract per-field: position (PDF points, bottom-left origin), page, options, `maxLength`, `multiline`, `multiSelect`, `readOnly`.
- **Write field values** — `setFieldValue(id, value)` with variant-correct validation, `maxLength` truncation, and rejection of unknown options.
- **Generate output** — `generate()` preserves the AcroForm; `generate({ flatten: true })` bakes values into page content and safely removes signature fields that would otherwise crash `pdf-lib`'s flatten.
- Reject encrypted documents by default (`allowEncrypted: true` to opt in).
- Report non-fatal issues as structured `diagnostics` — parsing, filling, and generating never silently hide wrong data.
- Visual regression suite: generated PDFs are rendered through `pdfjs-dist` in a chromium harness and diffed against committed baselines.

## Install

```bash
npm install @fillapp/pdf-sdk
```

## Usage

```ts
import { PdfSdk } from "@fillapp/pdf-sdk";

const sdk = await PdfSdk.load(pdfBytes); // Uint8Array | ArrayBuffer | Blob | base64 string

// Inspect the parsed form.
const template = sdk.toTemplate();
for (const field of template.fields) {
  console.log(field.id, field.type, field.acroFieldName);
}

// Fill values. Value shape must match the field variant.
sdk.setFieldValue("acro:plain_text:0", "Jane Doe");
sdk.setFieldValue("acro:single_check:0", true);
sdk.setFieldValue("acro:shipping:0", "express");
sdk.setFieldValue("acro:country:0", "Armenia");
sdk.setFieldValue("acro:fruit_multi:0", ["Apple", "Cherry"]);

// Render back to PDF bytes. Default keeps the AcroForm editable.
const filled = await sdk.generate();

// Or flatten for archival output.
const flat = await sdk.generate({ flatten: true });

// Surface non-fatal issues (parse, fill, and generate all feed this channel).
for (const diag of sdk.diagnostics) {
  console.warn(`[${diag.kind}] ${diag.fieldName ?? ""}: ${diag.message}`);
}
```

## The `Template` shape

The `Template` is a plain JSON value. Backend and frontend both read and write it — no translation layer.

```ts
type Template = {
  basePdf: Uint8Array;
  metadata: {
    pageCount: number;
    pages: { widthPt: number; heightPt: number }[];
    hasAcroForm: boolean;
  };
  fields: AcroFormField[];
};

type AcroFormField =
  | TextField
  | CheckboxField
  | RadioField
  | DropdownField
  | ListboxField;
```

Coordinates are in PDF points with bottom-left origin. Unit-conversion helpers are available as `ptToMm`, `mmToPt`, `pxToPt`, `ptToPx`, `flipY` — either from the main entry or from `@fillapp/pdf-sdk/utils` for a smaller import.

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
  generate(opts?: { flatten?: boolean }): Promise<Uint8Array>;

  readonly diagnostics: readonly ParseDiagnostic[];
}
```

All getters return independent copies — mutating them does not affect the SDK instance.

## Roadmap

- Overlay content: text, images, checkmark/cross glyphs at page coordinates.
- Bundled Unicode font so non-Latin field values render in the flattened output.
- Browser-run test suite (the current visual suite runs from Node; the fill/parse code is already isomorphic).

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
npm run build

# Visual regression (requires Playwright browsers installed once):
npx playwright install chromium
npm run test:visual          # diff against committed baselines
npm run test:visual:update   # refresh baselines after an intentional change
```

## License

MIT
