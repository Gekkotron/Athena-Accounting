# PDF test fixtures

This folder is intentionally empty in the repo. If you want to add a fixture
test against a real bank PDF, **anonymize it first**:

1. Open the PDF in any editor (e.g. macOS Preview, qpdf, pdftk).
2. Redact every personally-identifying value with a black rectangle on top of
   the text layer (cover, don't delete — we want the text layer's *position*
   preserved so the heuristic still sees the column geometry):
   - account number, IBAN, BIC
   - your name, address, phone
   - any third-party names that appear as transaction labels
3. Save as a new file `<bank>-anonymized.pdf` in this folder.
4. Add a Vitest case that loads this file and asserts the heuristic + apply
   paths produce the row count and amounts you expect.

Why no committed fixtures by default: anonymization is per-user; we don't want
one person's bank layout to silently become the project's reference truth.
