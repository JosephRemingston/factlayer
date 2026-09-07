import test from "node:test";
import assert from "node:assert/strict";
import extractPdfPages from "../services/pdf.service.js";

test("PDF extraction returns page-shaped output", async () => {
  const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length 44 >>\nstream\nBT /F1 24 Tf 72 720 Td (Fact Layer) Tj ET\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;
  const pages = await extractPdfPages(Buffer.from(pdf));
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0], { pageNumber: 1, text: "Fact Layer" });
});