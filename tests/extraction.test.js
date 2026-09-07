import test from "node:test";
import assert from "node:assert/strict";
import extractPdfPages from "../services/pdf.service.js";
import {
  buildExtractionPrompt,
  extractFactsFromChunk,
  parseExtractionResponse,
  validateFact,
} from "../services/extraction.service.js";
import { getFactVectorId } from "../services/embedding.service.js";

test("PDF extraction returns page-shaped output", async () => {
  const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length 44 >>\nstream\nBT /F1 24 Tf 72 720 Td (Fact Layer) Tj ET\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;
  const pages = await extractPdfPages(Buffer.from(pdf));
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0], { pageNumber: 1, text: "Fact Layer" });
});

const chunk = {
  _id: "chunk-1",
  documentId: "document-1",
  pageId: "page-1",
  text: "Revenue increased 25% to $100M in FY2024.",
};

const mockModel = async (messages) => {
  assert.match(messages[0].content, /metric value from a change or growth percentage/i);
  assert.match(buildExtractionPrompt(chunk), /Revenue increased 25% to \$100M/);
  return { content: JSON.stringify({
          facts: [
            {
              subject: "Company",
              predicate: "revenue",
              value: 100000000,
              valueType: "number",
              unit: "USD",
              currency: "USD",
              period: "FY2024",
              sourceText: "Revenue increased 25% to $100M in FY2024.",
              confidence: 0.95,
            },
            {
              subject: "Revenue",
              predicate: "growth",
              value: 25,
              valueType: "percentage",
              unit: "%",
              sourceText: "Revenue increased 25% to $100M in FY2024.",
              confidence: 0.9,
            },
          ],
        }) };
};

test("extracts metric and growth facts with evidence", async () => {
  const facts = await extractFactsFromChunk(chunk, mockModel);
  assert.equal(facts[0].value, 100000000);
  assert.equal(facts[1].value, 25);
  assert.equal(facts[1].valueType, "percentage");
  assert.equal(facts[0].chunkId, "chunk-1");
});

test("rejects malformed LLM responses", () => {
  assert.throws(() => parseExtractionResponse("not-json"));
  assert.throws(() => parseExtractionResponse({ facts: "not-an-array" }), /facts array/);
});

test("rejects missing or ungrounded evidence", () => {
  assert.throws(() => validateFact({ subject: "Company", predicate: "revenue", confidence: 0.8 }, chunk), /sourceText is required/);
  assert.throws(() => validateFact({ subject: "Company", predicate: "revenue", sourceText: "Invented text", confidence: 0.8 }, chunk), /not grounded/);
});

test("rejects invalid confidence", () => {
  const fact = { subject: "Company", predicate: "revenue", sourceText: chunk.text, confidence: 1.1 };
  assert.throws(() => validateFact(fact, chunk), /confidence must be a number/);
});

test("fact vector IDs are deterministic for retries", () => {
  assert.equal(getFactVectorId("fact-123"), "fact_fact-123");
  assert.equal(getFactVectorId("fact-123"), getFactVectorId("fact-123"));
});