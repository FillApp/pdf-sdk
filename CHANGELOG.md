# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0]

### Added

- Overlay content pipeline. `addOverlay`, `updateOverlay`, `removeOverlay` on
  `PdfSdk`, plus a new `OverlayField` variant in `Template.fields` keyed on
  `source: "overlay"`. Supported kinds: `text` (value + size + optional RGB
  color), `image` (PNG/JPEG bytes), `checkmark` and `cross` (vector strokes,
  optional color). Drawn onto target pages during `generate()`.
- Bundled Noto Sans subset. Latin, Latin Extended, and Cyrillic coverage
  (~67 KB TTF, ~90 KB base64 in the source tree). Registered via `fontkit` at
  `generate()` time so non-Latin field values and overlay text render
  correctly out of the box.
- `GenerateOptions.font`. Pass a custom TTF/OTF buffer to cover scripts
  beyond the bundled subset (CJK, Arabic, etc.).
- Radio widget exposure. `RadioField.widgets: RadioWidget[]` surfaces every
  on-value with its own position and page so consumers can render each
  radio button hit target rather than just the first.
- Hierarchical field name support. AcroForm fields with dotted names
  (`billing.address.line1`) now round-trip cleanly. Regression: v0.1.0 was
  saving with `useObjectStreams: false`, which silently dropped hierarchical
  field values. Switched to the pdf-lib default.
- Cross-runtime determinism test. The Playwright suite now spins an ESM
  browser bundle of the SDK, runs the same fill+generate pipeline there, and
  asserts `sha256(nodeBytes) === sha256(browserBytes)` for the AcroForm-fill
  path. Pin for the isomorphic contract.
- Performance baseline. `test/perf.test.ts` pins parse/fill/generate times
  on a 100-page / 1000-field fixture. Observed on macOS / Node 22: parse
  ~100 ms, fill × 100 ~160 ms, generate ~220 ms.
- Encrypted PDF fixture and `allowEncrypted` coverage. Explicit tests that
  the default path refuses encrypted input and the opt-in path loads.
- Visual regression for overlays and Unicode. Playwright specs plus baseline
  PNGs: every f1040 field filled with overlays over the Sign Here section,
  text/image/checkmark/cross on a flat PDF, radio/dropdown/listbox on the
  SDK-authored `choices.pdf`.

### Changed

- `generate()` sets `/NeedAppearances true` on the AcroForm dict rather than
  regenerating appearance streams. Modern viewers (Acrobat, Chrome, Firefox)
  honor the flag and regenerate widget chrome on open. Avoids the pdf-lib
  rendering artifacts hit trying to drive appearance updates ourselves and
  keeps the PDF standards-compliant.
- `Field` is now `AcroFormField | OverlayField`. Consumers that handled only
  AcroForm fields should narrow on `field.source === "acroform"` before
  accessing type-specific props.
- `ParseDiagnostic.kind` union extended with `value-truncated`.

### Fixed

- Hierarchical field names lost their values on reparse because of a
  `useObjectStreams: false` save option. Removed. The default object-stream
  save is used.

## [0.1.0-alpha] unreleased staging (folded into 0.2.0)

- Initial `setFieldValue` / `generate` release. See [0.2.0] for the full
  shipped scope.

## [0.0.1]

### Added

- `PdfSdk.load(input, { allowEncrypted })`. Load PDFs from `Uint8Array`,
  `ArrayBuffer`, `Blob`, or base64 string.
- `parseToTemplate(doc, bytes)`. Standalone parser for advanced consumers.
- Canonical `Template` JSON model with discriminated-union `AcroFormField`
  variants (text, checkbox, radio, dropdown, listbox).
- Structured `ParseDiagnostic` channel. Non-fatal parse issues are surfaced,
  never silently swallowed.
- Unit conversion helpers: `ptToMm`, `mmToPt`, `pxToPt`, `ptToPx`, `flipY`.
- Base64 helpers: `base64ToBytes`, `bytesToBase64`, `normalizeInput`.
- Subpath export for `@fillapp/pdf-sdk/utils`.
- GitHub Actions CI: lint, typecheck, format check, test (Node 18/20/22),
  coverage gates, dist artifact verification.
- Dependabot config for weekly dependency updates.

### Security

- Encrypted PDFs are refused by default. Opt in with `{ allowEncrypted: true }`.
