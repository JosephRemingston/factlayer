import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNumber, isNumericValue } from "../utils/normalizeUnits.js";
import { normalizeFact } from "../services/normalization.service.js";
import { reconcileFacts } from "../services/reconciliation.service.js";

test("identifiers are not reduced to a number", () => {
  // Two different CINs share the digit run 63090; treating them as numbers made them look equal.
  assert.equal(normalizeNumber("U63090DL2011PLC221234"), null);
  assert.equal(normalizeNumber("L63090DL2011PLC221234"), null);
  assert.equal(normalizeNumber("AAACD4471C"), null);
  assert.equal(isNumericValue("U63090DL2011PLC221234"), false);
  assert.equal(isNumericValue("8,142 crore"), true);
});

test("quantities still normalize, including Indian magnitudes", () => {
  assert.equal(normalizeNumber("$120 million").value, 120000000);
  assert.equal(normalizeNumber("8,142 crore").value, 81420000000);
  assert.equal(normalizeNumber("5 lakh").value, 500000);
  assert.equal(normalizeNumber("45,977.98").value, 45977.98);
  assert.equal(normalizeNumber("twenty five").value, 25);
});

test("differing identifiers are not corroborated", () => {
  const base = { subject: "Delhivery", predicate: "corporate identity number", valueType: "text", sourceText: "CIN", confidence: 0.99, documentId: "a", pageId: "p", chunkId: "c" };
  const a = normalizeFact({ ...base, value: "U63090DL2011PLC221234", object: "U63090DL2011PLC221234" });
  const b = normalizeFact({ ...base, documentId: "b", value: "L63090DL2011PLC221234", object: "L63090DL2011PLC221234" });
  assert.equal(a.normalizedValue, null);
  const result = reconcileFacts(a, b, 0.99);
  assert.notEqual(result.relationshipType, "corroborated");
});

test("a missing unit is unknown, so differing values can still contradict", () => {
  const base = {
    documentId: "a", pageId: "p", chunkId: "c", pageNumber: 1,
    normalizedSubject: "delhivery", normalizedPredicate: "revenue",
    periodLabel: "FY2024", normalizedScope: "consolidated",
    normalizedCurrency: "INR", normalizedValue: 81420000000, confidence: 0.9, sourceText: "a",
  };
  // Fact A states a unit, Fact B does not: unknown must not be read as a context difference.
  const a = { ...base, normalizedUnit: "currency" };
  const b = { ...base, documentId: "b", normalizedUnit: null, normalizedValue: 91420000000, sourceText: "b" };
  const result = reconcileFacts(a, b, 0.95);
  assert.equal(result.comparisonSignals.sameUnit, null);
  assert.equal(result.relationshipType, "contradiction");
});
