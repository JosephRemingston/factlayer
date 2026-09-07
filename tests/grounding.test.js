import test from "node:test";
import assert from "node:assert/strict";
import { isEvidenceGrounded, validateFact, collectValidFacts } from "../services/extraction.service.js";

const chunk = { _id: "chunk-1", documentId: "doc-1", pageId: "page-1", pageNumber: 2, text: "Revenue from services was ₹8,142 crore in FY24, up 13% year-on-year. The “Express Parcel” net-\nwork covered 18,500 pin codes." };

test("grounding tolerates quote style, hyphenation, punctuation, and number spacing", () => {
  assert.equal(isEvidenceGrounded("Revenue from services was ₹8 142 crore in FY24", chunk.text), true);
  assert.equal(isEvidenceGrounded('The "Express Parcel" network covered 18,500 pin codes', chunk.text), true);
  assert.equal(isEvidenceGrounded("up 13% year on year", chunk.text), true);
});

test("grounding still rejects invented or altered evidence", () => {
  assert.equal(isEvidenceGrounded("Revenue from services was ₹9,142 crore in FY24", chunk.text), false);
  assert.equal(isEvidenceGrounded("Net profit was positive", chunk.text), false);
  assert.equal(isEvidenceGrounded("", chunk.text), false);
});

test("facts without a value or object are rejected, others keep evidence links", () => {
  assert.throws(() => validateFact({ subject: "Delhivery", predicate: "outlook", sourceText: "up 13% year-on-year", confidence: 0.8 }, chunk), /neither a value nor an object/);
  const facts = collectValidFacts([
    { subject: "Delhivery", predicate: "revenue growth", value: 13, valueType: "percentage", sourceText: "up 13% year-on-year", confidence: 0.9 },
    { subject: "Delhivery", predicate: "revenue", value: 1, sourceText: "not in the chunk at all", confidence: 0.9 },
  ], chunk);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].pageNumber, 2);
  assert.equal(facts[0].chunkId, "chunk-1");
});
