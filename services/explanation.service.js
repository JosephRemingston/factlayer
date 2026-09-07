const display = (value) => value === null || value === undefined || value === "" ? "unavailable" : String(value);

const buildEvidenceReference = (fact, label) => ({
  fact: label,
  documentId: fact.documentId ?? null,
  pageId: fact.pageId ?? null,
  pageNumber: fact.pageNumber ?? null,
  chunkId: fact.chunkId ?? null,
  sourceText: fact.sourceText || null,
  evidenceAvailable: Boolean(fact.documentId && fact.pageId && fact.pageNumber !== null && fact.pageNumber !== undefined && fact.chunkId && fact.sourceText),
});

const buildRelationshipExplanation = ({ factA, factB, relationshipType, confidence, comparisonSignals = {} }) => {
  const evidence = [buildEvidenceReference(factA, "Fact A"), buildEvidenceReference(factB, "Fact B")];
  const evidenceAvailable = evidence.every((item) => item.evidenceAvailable);
  const keySimilarities = [];
  const keyDifferences = [];
  if (comparisonSignals.sameSubject) keySimilarities.push(`Both describe subject '${display(factA.normalizedSubject)}'.`);
  if (comparisonSignals.samePredicate) keySimilarities.push(`Both describe metric '${display(factA.normalizedPredicate)}'.`);
  if (comparisonSignals.samePeriod === true) keySimilarities.push(`Both refer to period '${display(factA.periodLabel)}'.`);
  if (comparisonSignals.sameScope === true) keySimilarities.push(`Both refer to scope '${display(factA.normalizedScope)}'.`);
  if (comparisonSignals.sameUnit === true) keySimilarities.push("Units are compatible.");
  if (comparisonSignals.sameCurrency === true) keySimilarities.push(`Currency is compatible: ${display(factA.normalizedCurrency)}.`);
  if (comparisonSignals.samePeriod === false) {
    keyDifferences.push(`Periods differ: Fact A is '${display(factA.periodLabel)}'; Fact B is '${display(factB.periodLabel)}'.`);
  }
  if (comparisonSignals.sameScope === false) {
    keyDifferences.push(`Scopes differ: Fact A is '${display(factA.normalizedScope)}'; Fact B is '${display(factB.normalizedScope)}'.`);
  }
  if (comparisonSignals.sameUnit === false) keyDifferences.push(`Units differ: '${display(factA.normalizedUnit)}' versus '${display(factB.normalizedUnit)}'.`);
  if (comparisonSignals.sameCurrency === false) keyDifferences.push(`Currencies differ: '${display(factA.normalizedCurrency)}' versus '${display(factB.normalizedCurrency)}'.`);
  if (comparisonSignals.valuesEqualWithinTolerance === false) {
    keyDifferences.push(`Normalized values differ by ${display(comparisonSignals.valueDifference)} (${display(comparisonSignals.percentageDifference)} relative difference).`);
  }
  if (!evidenceAvailable) keyDifferences.push("Evidence is unavailable for one or both facts.");

  const factStatements = `Fact A states: '${display(factA.sourceText)}' Fact B states: '${display(factB.sourceText)}'.`;
  let classificationReason;
  if (!evidenceAvailable) {
    classificationReason = "Evidence is unavailable, so the relationship cannot be fully explained.";
  } else if (relationshipType === "corroborated") {
    classificationReason = "The facts describe the same subject and metric in compatible context, and their normalized values are within tolerance.";
  } else if (relationshipType === "contradiction") {
    classificationReason = "The facts describe the same subject and metric for the same period and scope, but their normalized values differ materially.";
  } else if (relationshipType === "contextual_difference") {
    classificationReason = "The facts describe the same subject and metric, but their period, scope, unit, or currency context differs; this is not treated as a contradiction.";
  } else {
    classificationReason = "There is not enough compatible normalized metadata to determine whether the facts corroborate or conflict.";
  }

  return {
    summary: `${relationshipType}: ${classificationReason}`,
    detailedReason: `${factStatements} ${classificationReason}`,
    classification: relationshipType,
    confidence: Math.max(0, Math.min(1, confidence ?? 0)),
    keyDifferences,
    keySimilarities,
    evidence,
  };
};

export { buildEvidenceReference, buildRelationshipExplanation };