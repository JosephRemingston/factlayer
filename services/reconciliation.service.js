import Fact from "../models/fact.models.js";
import Relationship from "../models/relationship.models.js";
import { FACT_PERCENTAGE_TOLERANCE, FACT_VALUE_TOLERANCE } from "../utils/constants.js";
import { buildRelationshipExplanation } from "./explanation.service.js";

const toNumber = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

const sameValue = (left, right, tolerance) => {
  if (left === null || right === null) return null;
  const difference = Math.abs(left - right);
  const denominator = Math.max(Math.abs(left), Math.abs(right), 1);
  return { difference, percentageDifference: difference / denominator, matches: difference / denominator <= tolerance };
};

const samePeriod = (factA, factB) => {
  if (!factA.periodLabel || !factB.periodLabel) return null;
  return factA.periodLabel === factB.periodLabel;
};

const sameScope = (factA, factB) => {
  if (!factA.normalizedScope || !factB.normalizedScope) return null;
  return factA.normalizedScope === factB.normalizedScope;
};

const buildComparisonSignals = (factA, factB, semanticSimilarity = null) => {
  const valueA = toNumber(factA.normalizedValue);
  const valueB = toNumber(factB.normalizedValue);
  const valueComparison = sameValue(valueA, valueB, FACT_VALUE_TOLERANCE);
  const percentageA = toNumber(factA.normalizedPercentage);
  const percentageB = toNumber(factB.normalizedPercentage);
  const percentageComparison = sameValue(percentageA, percentageB, FACT_PERCENTAGE_TOLERANCE);
  return {
    sameSubject: Boolean(factA.normalizedSubject && factA.normalizedSubject === factB.normalizedSubject),
    samePredicate: Boolean(factA.normalizedPredicate && factA.normalizedPredicate === factB.normalizedPredicate),
    samePeriod: samePeriod(factA, factB),
    sameScope: sameScope(factA, factB),
    sameUnit: factA.normalizedUnit || factB.normalizedUnit
      ? factA.normalizedUnit === factB.normalizedUnit
      : true,
    sameCurrency: factA.normalizedCurrency || factB.normalizedCurrency
      ? factA.normalizedCurrency === factB.normalizedCurrency
      : true,
    valueDifference: valueComparison?.difference ?? null,
    percentageDifference: valueComparison?.percentageDifference ?? percentageComparison?.percentageDifference ?? null,
    valuesEqualWithinTolerance: valueComparison?.matches ?? percentageComparison?.matches ?? null,
    semanticSimilarity,
  };
};

const reconcileFacts = (factA, factB, semanticSimilarity = null) => {
  const comparisonSignals = buildComparisonSignals(factA, factB, semanticSimilarity);
  const evidence = [
    { fact: "Fact A", documentId: factA.documentId, pageId: factA.pageId, pageNumber: factA.pageNumber ?? null, chunkId: factA.chunkId, sourceText: factA.sourceText || null },
    { fact: "Fact B", documentId: factB.documentId, pageId: factB.pageId, pageNumber: factB.pageNumber ?? null, chunkId: factB.chunkId, sourceText: factB.sourceText || null },
  ];
  const confidence = Math.min(factA.confidence ?? 0, factB.confidence ?? 0, semanticSimilarity ?? 1);
  let relationshipType = "uncertain";
  let reason = "There is not enough normalized evidence to reconcile these facts.";
  let context = null;

  if (!comparisonSignals.sameSubject || !comparisonSignals.samePredicate) {
    reason = "Subject or predicate evidence is insufficient for reconciliation.";
  } else {
    const contextDifferences = [];
    if (comparisonSignals.samePeriod === false) contextDifferences.push("period differs");
    if (comparisonSignals.sameScope === false) contextDifferences.push("scope differs");
    if (comparisonSignals.sameUnit === false) contextDifferences.push("unit differs");
    if (comparisonSignals.sameCurrency === false) contextDifferences.push("currency differs");
    if (contextDifferences.length) {
      relationshipType = "contextual_difference";
      context = contextDifferences.join(", ");
      reason = `Facts share the same metric but ${context}.`;
    } else if (comparisonSignals.valuesEqualWithinTolerance === true) {
      relationshipType = "corroborated";
      reason = "Facts have matching subject, metric, context, and values within tolerance.";
    } else if (comparisonSignals.valuesEqualWithinTolerance === false && comparisonSignals.samePeriod === true && comparisonSignals.sameScope === true) {
      relationshipType = "contradiction";
      reason = "Facts have matching subject, metric, period, scope, and materially different values.";
    }
  }

  const explanation = buildRelationshipExplanation({ factA, factB, relationshipType, confidence, comparisonSignals });
  return {
    relationshipType,
    confidence,
    reason,
    context,
    comparisonSignals,
    evidence,
    ...explanation,
  };
};

const reconcileRelationships = async (relationships) => {
  if (!relationships.length) return [];
  const factIds = relationships.flatMap((relationship) => [relationship.factA, relationship.factB]);
  const facts = await Fact.find({ _id: { $in: factIds } }).lean();
  const factsById = new Map(facts.map((fact) => [fact._id.toString(), fact]));
  const updates = relationships.map((relationship) => {
    const factA = factsById.get(relationship.factA.toString());
    const factB = factsById.get(relationship.factB.toString());
    if (!factA || !factB) return null;
    return { relationship, result: reconcileFacts(factA, factB, relationship.similarityScore) };
  }).filter(Boolean);
  if (updates.length) {
    await Relationship.bulkWrite(updates.map(({ relationship, result }) => ({
      updateOne: {
        filter: { factA: relationship.factA, factB: relationship.factB },
        update: { $set: { ...result, status: "reviewed" } },
      },
    })));
  }
  return updates.map(({ relationship, result }) => ({ ...relationship, ...result, status: "reviewed" }));
};

export { buildComparisonSignals, reconcileFacts, reconcileRelationships };