# Security Policy

## Reporting a vulnerability

Please email security reports to `contact@fillapp.ai` rather than opening a public issue. We aim to acknowledge reports within 3 business days.

## Threat model

This SDK parses untrusted PDF input. Potential concerns:

- **Malformed PDFs.** `PdfSdk.load` is expected to throw cleanly on invalid input, never hang or produce a corrupt `Template`. Reports of hangs or unbounded memory allocations are treated as security issues.
- **Encrypted PDFs.** Refused by default. The `allowEncrypted: true` opt-in relies on `@cantoo/pdf-lib`'s encryption handling. We do not attempt decryption beyond what the engine supports.
- **Widget position manipulation.** Coordinates come directly from the PDF. Consumers rendering fields on screen must validate coordinates fall within declared page bounds if they treat them as trustable.

This SDK does not execute any PDF-embedded JavaScript (`/AA`, `/A`, `/JS` entries). Form-format scripts are ignored entirely in v0.x.

## Supported versions

During the v0.x series, only the latest minor release receives security fixes.
