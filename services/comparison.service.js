import Fact from "../models/fact.models.js";
import Relationship from "../models/relationship.models.js";
import { queryFactVectors } from "./embedding.service.js";
import {
  FACT_COMPATIBILITY_THRESHOLD,
  FACT_MATCH_TOP_K,
  FACT_SIMILARITY_THRESHOLD,
  MATCH_CONFIDENCE_THRESHOLD,
} from "../utils/constants.js";

const asString = (value) => (value === null || value === undefined ? "" : String(value));

const compareFacts = (fact, candidate) => {
  const signals = [];
  const comparisonSignals = {
    sameSubject: Boolean(fact.normalizedSubject && fact.normalizedSubject === candidate.normalizedSubject),
    samePredicate: Boolean(fact.normalizedPredicate && fact.normalizedPredicate === candidate.normalizedPredicate),
    samePeriod: fact.periodLabel && candidate.periodLabel ? fact.periodLabel === candidate.periodLabel : null,
    sameScope: fact.normalizedScope && candidate.normalizedScope ? fact.normalizedScope === candidate.normalizedScope : null,
    sameUnit: fact.normalizedUnit || candidate.normalizedUnit
      ? fact.normalizedUnit === candidate.normalizedUnit
      : true,
    sameCurrency: fact.normalizedCurrency || candidate.normalizedCurrency
      ? fact.normalizedCurrency === candidate.normalizedCurrency
      : true,
  };
  if (fact.normalizedSubject && candidate.normalizedSubject && fact.normalizedSubject === candidate.normalizedSubject) {
    signals.push("subject matches");
  } else {
    return { compatible: false, score: 0, reason: "subject differs", signals: comparisonSignals };
  }

  if (fact.normalizedPredicate && fact.normalizedPredicate === candidate.normalizedPredicate) {
    signals.push("predicate matches");
  } else {
    return { compatible: false, score: 0, reason: "predicate differs", signals: comparisonSignals };
  }

  if (fact.normalizedObject !== null && candidate.normalizedObject !== null
    && asString(fact.normalizedObject) !== asString(candidate.normalizedObject)) {
    return { compatible: false, score: 0, reason: "object differs", signals: comparisonSignals };
  }
  signals.push("object compatible");

  if (fact.valueType && candidate.valueType && fact.valueType !== candidate.valueType) {
    return { compatible: false, score: 0, reason: "value type differs", signals: comparisonSignals };
  }
  signals.push("value type compatible");

  if (fact.normalizedUnit && candidate.normalizedUnit && fact.normalizedUnit !== candidate.normalizedUnit) {
    signals.push("unit differs; preserved for reconciliation");
  } else {
    signals.push("unit compatible");
  }
  if (fact.normalizedCurrency && candidate.normalizedCurrency && fact.normalizedCurrency !== candidate.normalizedCurrency) {
    signals.push("currency differs; preserved for reconciliation");
  } else {
    signals.push("currency compatible");
  }
  signals.push("unit and currency compatible");

  if (fact.periodLabel && candidate.periodLabel && fact.periodLabel !== candidate.periodLabel) signals.push("period differs; preserved for later analysis");
  if (fact.normalizedScope && candidate.normalizedScope && fact.normalizedScope !== candidate.normalizedScope) signals.push("scope differs; preserved for later analysis");
  return { compatible: true, score: signals.length >= 4 ? 1 : 0.8, reason: signals.join("; "), signals: comparisonSignals };
};

const canonicalPair = (factA, factB) => {
  const first = asString(factA._id);
  const second = asString(factB._id);
  return first < second ? [factA, factB] : [factB, factA];
};

const buildCandidateRelationship = (fact, candidate, similarityScore) => {
  if (!candidate || asString(fact._id) === asString(candidate._id)) return null;
  if (asString(fact.documentId) === asString(candidate.documentId)) return null;
  if (similarityScore < FACT_SIMILARITY_THRESHOLD) return null;
  const compatibility = compareFacts(fact, candidate);
  const matchingScore = similarityScore * compatibility.score;
  const confidence = Math.min(fact.confidence ?? 0, candidate.confidence ?? 0, matchingScore);
  if (!compatibility.compatible || matchingScore < MATCH_CONFIDENCE_THRESHOLD || compatibility.score < FACT_COMPATIBILITY_THRESHOLD) return null;
  const [factA, factB] = canonicalPair(fact, candidate);
  return {
    factA: factA._id,
    factB: factB._id,
    relationshipType: "candidate",
    similarityScore,
    matchingScore,
    confidence,
    reason: compatibility.reason,
    comparisonSignals: {
      sameSubject: compatibility.signals.sameSubject,
      samePredicate: compatibility.signals.samePredicate,
      samePeriod: compatibility.signals.samePeriod,
      sameScope: compatibility.signals.sameScope,
      sameUnit: compatibility.signals.sameUnit,
      sameCurrency: compatibility.signals.sameCurrency,
      semanticSimilarity: similarityScore,
    },
    evidence: {
      factA: { documentId: factA.documentId, pageId: factA.pageId, chunkId: factA.chunkId, sourceText: factA.sourceText },
      factB: { documentId: factB.documentId, pageId: factB.pageId, chunkId: factB.chunkId, sourceText: factB.sourceText },
    },
    status: "pending",
  };
};

const findCandidateRelationships = async (fact, search = queryFactVectors) => {
  const result = await search(fact.sourceText, FACT_MATCH_TOP_K);
  const matches = result?.matches || [];
  const candidateIds = matches
    .map((match) => match.metadata?.factId)
    .filter(Boolean);
  const candidates = await Fact.find({ _id: { $in: candidateIds } }).lean();
  const byId = new Map(candidates.map((candidate) => [candidate._id.toString(), candidate]));
  return matches
    .map((match) => buildCandidateRelationship(fact, byId.get(match.metadata?.factId), match.score || 0))
    .filter(Boolean);
};

const createCandidateRelationships = async (facts, search = queryFactVectors) => {
  const relationships = new Map();
  for (const fact of facts) {
    const candidates = await findCandidateRelationships(fact, search);
    for (const candidate of candidates) {
      relationships.set(`${candidate.factA.toString()}:${candidate.factB.toString()}`, candidate);
    }
  }
  const records = [...relationships.values()];
  if (records.length) await Relationship.bulkWrite(records.map((record) => ({
    updateOne: {
      filter: { factA: record.factA, factB: record.factB },
      update: { $set: record },
      upsert: true,
    },
  })));
  return records;
};

const deleteRelationshipsForFacts = async (factIds) => {
  if (!factIds.length) return;
  await Relationship.deleteMany({ $or: [{ factA: { $in: factIds } }, { factB: { $in: factIds } }] });
};

export { buildCandidateRelationship, compareFacts, createCandidateRelationships, deleteRelationshipsForFacts, findCandidateRelationships };