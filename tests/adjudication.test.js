import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateRelationship, compareFacts } from "../services/comparison.service.js";
import { reconcileFacts } from "../services/reconciliation.service.js";

const base = { documentId: "doc-a", pageId: "p", pageNumber: 1, chunkId: "c", valueType: "currency", normalizedUnit: "currency", normalizedCurrency: "INR", periodLabel: "FY2024", normalizedScope: null, normalizedObject: null, confidence: 0.9 };
const factA = { ...base, _id: "fact-a", subject: "Delhivery", predicate: "revenue from services", normalizedSubject: "delhivery", normalizedPredicate: "revenue_from_services", normalizedValue: 81420000000, sourceText: "Revenue from services was ₹8,142 crore in FY24." };
const factB = { ...base, _id: "fact-b", documentId: "doc-b", subject: "the company", predicate: "revenue from operations", normalizedSubject: "company", normalizedPredicate: "revenue_from_operations", normalizedValue: 81420000000, sourceText: "Revenue from operations stood at Rs 8,142 crore." };

test("differently worded subject and metric are rejected without adjudication", () => {
  assert.equal(compareFacts(factA, factB).compatible, false);
  assert.equal(buildCandidateRelationship(factA, factB, 0.9), null);
});

test("an adjudicator verdict lets differently worded facts be compared and corroborated", () => {
  const verdict = { same: true, reason: "the company refers to Delhivery; revenue from operations is its services revenue" };
  const relationship = buildCandidateRelationship(factA, factB, 0.9, verdict);
  assert.ok(relationship);
  assert.equal(relationship.comparisonSignals.adjudicated.same, true);
  const reconciled = reconcileFacts(factA, factB, 0.9, { sameSubject: true, samePredicate: true, adjudicated: verdict });
  assert.equal(reconciled.relationshipType, "corroborated");
  assert.ok(reconciled.keySimilarities.some((line) => /judged equivalent/.test(line)));
});

test("number versus currency value types are compatible, percentage versus amount is not", () => {
  assert.equal(compareFacts(factA, { ...factA, _id: "x", documentId: "doc-b", valueType: "number" }).compatible, true);
  assert.equal(compareFacts(factA, { ...factA, _id: "x", documentId: "doc-b", valueType: "percentage" }).compatible, false);
});

test("descriptive facts with different objects in the same period are contradictions", () => {
  const ceoA = { ...base, _id: "ceo-a", valueType: "text", normalizedUnit: null, normalizedCurrency: null, subject: "Delhivery", predicate: "chief executive officer", normalizedSubject: "delhivery", normalizedPredicate: "chief_executive_officer", normalizedValue: null, normalizedObject: "sahil barua", object: "Sahil Barua", sourceText: "Sahil Barua is the CEO." };
  const ceoB = { ...ceoA, _id: "ceo-b", documentId: "doc-b", normalizedObject: "someone else", object: "Someone Else", sourceText: "Someone Else serves as CEO." };
  assert.equal(compareFacts(ceoA, ceoB).compatible, true);
  const result = reconcileFacts(ceoA, ceoB, 0.9);
  assert.equal(result.relationshipType, "contradiction");
  assert.ok(result.keyDifferences.some((line) => /Stated values differ/.test(line)));
  const unknownPeriod = reconcileFacts({ ...ceoA, periodLabel: null }, { ...ceoB, periodLabel: null }, 0.9);
  assert.equal(unknownPeriod.relationshipType, "uncertain");
  assert.match(unknownPeriod.reason, /change over time/);
});
