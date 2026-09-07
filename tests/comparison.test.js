import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateRelationship, compareFacts } from "../services/comparison.service.js";

const factA = {
  _id: "fact-a",
  documentId: "document-a",
  normalizedSubject: "company",
  normalizedPredicate: "revenue",
  valueType: "number",
  normalizedUnit: "currency",
  normalizedCurrency: "USD",
  periodLabel: "FY2024",
  normalizedScope: "global",
  confidence: 0.95,
  sourceText: "Revenue was $120 million.",
};

const factB = {
  _id: "fact-b",
  documentId: "document-b",
  normalizedSubject: "company",
  normalizedPredicate: "revenue",
  valueType: "number",
  normalizedUnit: "currency",
  normalizedCurrency: "USD",
  periodLabel: "FY2023",
  normalizedScope: "us",
  confidence: 0.9,
  sourceText: "The company generated USD 120M in sales.",
};

test("equivalent wording creates a candidate relationship", () => {
  const relationship = buildCandidateRelationship(factA, factB, 0.92);
  assert.equal(relationship.relationshipType, "candidate");
  assert.equal(relationship.similarityScore, 0.92);
  assert.match(relationship.reason, /predicate matches/);
  assert.match(relationship.reason, /period differs/);
  assert.match(relationship.reason, /scope differs/);
});

test("different metrics are rejected despite semantic similarity", () => {
  const differentMetric = { ...factB, normalizedPredicate: "employees" };
  assert.equal(buildCandidateRelationship(factA, differentMetric, 0.99), null);
  assert.equal(compareFacts(factA, differentMetric).compatible, false);
});

test("period and scope differences remain candidate signals", () => {
  const result = compareFacts(factA, factB);
  assert.equal(result.compatible, true);
  assert.match(result.reason, /period differs/);
  assert.match(result.reason, /scope differs/);
});

test("self matches are rejected", () => {
  assert.equal(buildCandidateRelationship(factA, factA, 0.99), null);
});

test("facts from the same document are rejected", () => {
  assert.equal(buildCandidateRelationship(factA, { ...factB, documentId: factA.documentId }, 0.99), null);
});

test("inverse pairs resolve to one canonical ordering", () => {
  const forward = buildCandidateRelationship(factA, factB, 0.9);
  const reverse = buildCandidateRelationship(factB, factA, 0.9);
  assert.equal(forward.factA, reverse.factA);
  assert.equal(forward.factB, reverse.factB);
});

test("low similarity does not create a candidate", () => {
  assert.equal(buildCandidateRelationship(factA, factB, 0.5), null);
});