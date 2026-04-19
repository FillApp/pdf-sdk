# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0]

### Added

- Six new overlay kinds on `OverlayField`, mirroring PDFium's native
  annotation shapes 1:1:
  - `rect` (`OverlayRect`) / `ellipse` (`OverlayEllipse`) — rect-positioned,
    optional `stroke`, `strokeWidthPt`, `fill`, `opacity`.
  - `line` (`OverlayLine`) — `start` / `end` endpoints plus optional
    `arrowEnd` (sets PDFium's `lineEndings.end = OpenArrow` and intent
    `"LineArrow"`). `position` is the axis-aligned bounding box of the two
    endpoints.
  - `polyline` (`OverlayPolyline`) / `polygon` (`OverlayPolygon`) — `points:
Point[]`, with polygon closing back to the first vertex.
  - `ink` (`OverlayInk`) — `strokes: Point[][]` maps directly onto PDFium's
    `PdfInkAnnoObject.inkList`. `intent: "highlight"` maps to PDFium's
    `"InkHighlight"` intent so the highlighter-pen tool round-trips as
    well as the plain pen.
- `Point` type export (`{ xPt, yPt }`) for shape overlays that carry vertex
  arrays.
- `templateToJSON` / `templateFromJSON` serialise every new kind with full
  coverage and deterministic key order; existing v1 documents load
  unchanged since the additions are all new discriminator values.
- Overlay tests cover create → `generate()` → reparse for every new kind
  and exercise both fill + no-fill paths on rect / ellipse / polygon.

### Changed

- `OverlayKind` is now a ten-member union. Consumers that exhaustively
  switch on `kind` must add cases for `rect`, `ellipse`, `line`,
  `polyline`, `polygon`, and `ink`. No existing variant changed shape.

## [0.3.0]

### Breaking

- `PdfSdk.load(input)` → `PdfSdk.load(input, { engine })`. An engine is now
  mandatory. Pass a `PdfEngine<Blob>` from `@embedpdf/engines` — either one
  you already own (e.g. from EmbedPDF's `usePdfiumEngine()`) or one created
  via the new `createNodeEngine` / `createBrowserEngine` helpers.
- `GenerateOptions.font` removed. Overlay text renders with PDFium's built-in
  standard fonts (Helvetica for text, ZapfDingbats for checkmark / cross);
  custom TTF embedding is not supported in this release. If you need Unicode
  beyond Latin-1 for overlays, stay on `0.2.x` for now.
- `LoadOptions.allowEncrypted` removed. Encrypted-PDF handling is delegated
  to PDFium, which surfaces its own error on `openDocumentBuffer`.
- `@embedpdf/engines`, `@embedpdf/models`, and `@embedpdf/pdfium` are now
  peer dependencies. Install them alongside the SDK.

### Added

- PDFium-backed rendering for every byte the SDK writes. The viewer
  (EmbedPDF) and `generate()` output now come from the same engine, the
  same standard fonts, and the same code path — WYSIWYG by construction.
- `createNodeEngine` / `createBrowserEngine` subpath helpers at
  `@fillapp/pdf-sdk/engine/node` and `@fillapp/pdf-sdk/engine/browser`.
- `LoadOptions.doc` — reuse an already-open PDFium document instead of
  opening a second copy. Useful when the viewer already owns the doc.
- `PdfSdk.getPdfiumDocument()` — expose the underlying PDFium handle for
  consumers that want to drive the engine directly alongside the SDK.
- Overlay annotations are tracked as real PDFium annotations between calls
  and flattened into page content streams at `generate()`. `updateOverlay`
  does a delete + recreate so a single call atomically covers text,
  color, size, and position changes.
- Cross-runtime byte-determinism test: a Playwright test now runs the
  identical fill pipeline in Node and in a headless Chromium build of the
  SDK and asserts `sha256` equality.

### Changed

- Overlay images use PDFium's stamp annotation API directly with raw PNG /
  JPEG bytes. Stream copying is handled inside the engine so the caller's
  buffer is safe to reclaim after `addOverlay`.
- `generate()` rewrites widget `/NM` entries in the saved bytes with
  deterministic ordinal-derived UUIDs, so repeat saves of the same template
  produce byte-identical output even though PDFium synthesizes random
  UUIDs for any widget without an `/NM` in the source PDF.

### Removed

- `pdf-lib` and `@pdf-lib/fontkit` dependencies.
- Bundled Noto Sans TTF subset and the `fontkit` registration path
  (~400 KB out of the package).
- `drawOverlayText`, `drawOverlayImage`, `drawOverlayCheckmark`,
  `drawOverlayCross`, baseline-ratio heuristics, and scratch-document
  font embedding plumbing.

### Fixed

- Overlays and AcroForm widgets render identically in a PDFium-backed
  viewer and in the downloaded PDF. The previous divergence came from
  pdf-lib drawing overlays with an embedded Noto Sans while PDFium drew
  them with Helvetica; both sides now share the one PDFium renderer.

## [0.2.1]

### Fixed

- `generate()` is now idempotent when overlays are present. Previously, a
  second call stacked duplicate text, images, and glyphs onto the pages
  because overlays were drawn onto the same loaded document. Overlays are
  now drawn onto a scratch copy of the document so `this.doc` stays a
  clean baseline across repeat calls.

### Docs

- Rewrote README for open-source release: new-project status banner,
  refreshed roadmap of features still to land before 1.0.
- Trimmed CLAUDE.md down to the stable context an agent needs (vision,
  `Template` contract, hard rules, quality gates, release flow).

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
