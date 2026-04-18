# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `PdfSdk.setFieldValue(id, value)` — variant-correct mutator for every
  supported AcroForm type. Rejects wrong value shapes, rejects out-of-options
  values on choice fields, refuses multiple values on a single-select listbox,
  and truncates over-long text fields to `maxLength` (emitting a
  `value-truncated` diagnostic rather than throwing).
- `PdfSdk.generate({ flatten? })` — renders the document back to bytes. Default
  preserves the AcroForm so fields remain editable downstream. `flatten: true`
  bakes values into page content and strips the form. Includes a pre-emptive
  removal of signature fields to work around a known `pdf-lib` flatten crash
  (emits a `signature-flatten-skipped` diagnostic).
- Playwright visual test suite under `test/visual/` — renders generated PDFs
  through `pdfjs-dist` in a controlled chromium harness and snapshots each
  page. Baselines live alongside the specs and the committed PNGs are the
  source of truth. Run `npm run test:visual` to verify, `npm run
  test:visual:update` to refresh after an intentional change.
- `ParseDiagnostic.kind` now additionally covers `value-truncated` and
  `signature-flatten-skipped` for fill- and generate-time issues.

### Changed

- `generate()` sets a fixed modification date so repeated runs produce
  byte-identical output for the same `Template`.

## [0.0.1]

### Added

- `PdfSdk.load(input, { allowEncrypted })` — load PDFs from `Uint8Array`,
  `ArrayBuffer`, `Blob`, or base64 string.
- `parseToTemplate(doc, bytes)` — standalone parser for advanced consumers.
- Canonical `Template` JSON model with discriminated-union `AcroFormField`
  variants (text, checkbox, radio, dropdown, listbox).
- Structured `ParseDiagnostic` channel — non-fatal parse issues are surfaced,
  never silently swallowed.
- Unit conversion helpers: `ptToMm`, `mmToPt`, `pxToPt`, `ptToPx`, `flipY`.
- Base64 helpers: `base64ToBytes`, `bytesToBase64`, `normalizeInput`.
- Subpath export for `@fillapp/pdf-sdk/utils`.
- GitHub Actions CI: lint, typecheck, format check, test (Node 18/20/22),
  coverage gates, dist artifact verification.
- Dependabot config for weekly dependency updates.

### Security

- Encrypted PDFs are refused by default. Opt in with `{ allowEncrypted: true }`.
