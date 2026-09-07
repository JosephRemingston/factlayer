import test from "node:test";
import assert from "node:assert/strict";
import { reconcileFacts } from "../services/reconciliation.service.js";

const baseFact = {
  documentId: "document-a",
  pageId: "page-a",
  pageNumber: 4,
  chunkId: "chunk-a",
  normalizedSubject: "company",
  normalizedPredicate: "revenue",
  normalizedUnit: "currency",
  normalizedCurrency: "USD",
  normalizedScope: "global",
  periodLabel: "FY2024",
  normalizedValue: 120000000,
  normalizedPercentage: null,
  confidence: 0.95,
  sourceText: "Revenue was $120M.",
};

test("equal facts are corroborated", () => {
  const result = reconcileFacts(baseFact, {
    ...baseFact,
    documentId: "document-b",
    pageId: "page-b",
    chunkId: "chunk-b",
    sourceText: "Revenue totaled USD 120 million.",
    confidence: 0.9,
  }, 0.94);
  assert.equal(result.relationshipType, "corroborated");
  assert.equal(result.comparisonSignals.valuesEqualWithinTolerance, true);
  assert.equal(result.classification, "corroborated");
  assert.equal(result.evidence[0].pageNumber, 4);
  assert.match(result.detailedReason, /Revenue was \$120M/);
});

test("materially different same-period values are contradictions", () => {
  const result = reconcileFacts(baseFact, {
    ...baseFact,
    documentId: "document-b",
    normalizedValue: 5100,
    normalizedPredicate: "employees",
    sourceText: "Employees totaled 5,100.",
  }, 0.9);
  assert.equal(result.relationshipType, "uncertain");

  const employeesA = { ...baseFact, normalizedPredicate: "employees", normalizedValue: 4200, sourceText: "Employees were 4,200." };
  const employeesB = { ...employeesA, documentId: "document-b", normalizedValue: 5100, sourceText: "Employees were 5,100." };
  assert.equal(reconcileFacts(employeesA, employeesB, 0.9).relationshipType, "contradiction");
});

test("different periods are contextual differences, not contradictions", () => {
  const result = reconcileFacts(baseFact, {
    ...baseFact,
    documentId: "document-b",
    periodLabel: "Q4 2024",
    normalizedValue: 32000000,
    sourceText: "Q4 revenue was $32M.",
  }, 0.88);
  assert.equal(result.relationshipType, "contextual_difference");
  assert.match(result.context, /period differs/);
  assert.match(result.summary, /contextual_difference/);
  assert.ok(result.keyDifferences.some((difference) => difference.includes("Periods differ")));
});

test("different scope, currency, or missing evidence remains explainable", () => {
  const scoped = reconcileFacts(baseFact, {
    ...baseFact,
    documentId: "document-b",
    normalizedScope: "us",
    sourceText: "US revenue was $120M.",
  }, 0.88);
  assert.equal(scoped.relationshipType, "contextual_difference");
  assert.match(scoped.context, /scope differs/);

  const uncertain = reconcileFacts({ ...baseFact, normalizedValue: null }, {
    ...baseFact,
    documentId: "document-b",
    normalizedValue: null,
  }, 0.8);
  assert.equal(uncertain.relationshipType, "uncertain");
  const missingEvidence = reconcileFacts({ ...baseFact, sourceText: null, pageNumber: null }, {
    ...baseFact,
    documentId: "document-b",
    sourceText: null,
    pageNumber: null,
  }, 0.8);
  assert.match(missingEvidence.detailedReason, /Evidence is unavailable/);
  assert.equal(missingEvidence.evidence[0].evidenceAvailable, false);
});