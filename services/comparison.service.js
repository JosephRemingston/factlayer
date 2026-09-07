import Fact from "../models/fact.models.js";
import Relationship from "../models/relationship.models.js";
import { queryFactVectors, queryFactVectorsByVector } from "./embedding.service.js";
import { adjudicateFactPairs } from "./extraction.service.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import {
  FACT_ADJUDICATION_SIMILARITY,
  FACT_COMPATIBILITY_THRESHOLD,
  FACT_MATCH_TOP_K,
  FACT_SIMILARITY_THRESHOLD,
  MATCH_CONFIDENCE_THRESHOLD,
  MAX_ADJUDICATION_PAIRS_PER_DOCUMENT,
} from "../utils/constants.js";

const asString = (value) => (value === null || value === undefined ? "" : String(value));

// Models label the same metric "number" in one document and "currency" in another; only percentage
// versus absolute values is a real incompatibility.
const valueTypesCompatible = (left, right) => {
  if (!left || !right || left === right) return true;
  const family = (type) => (type === "percentage" ? "percentage" : type === "date" ? "date" : type === "text" ? "text" : "amount");
  return family(left) === family(right);
};

// `adjudication` carries an LLM verdict that the two facts describe the same subject and metric even
// though their normalized strings differ; the string checks are then skipped.
const compareFacts = (fact, candidate, adjudication = null) => {
  const signals = [];
  const sameSubject = Boolean(fact.normalizedSubject && fact.normalizedSubject === candidate.normalizedSubject);
  const samePredicate = Boolean(fact.normalizedPredicate && fact.normalizedPredicate === candidate.normalizedPredicate);
  const comparisonSignals = {
    sameSubject: sameSubject || Boolean(adjudication?.same),
    samePredicate: samePredicate || Boolean(adjudication?.same),
    samePeriod: fact.periodLabel && candidate.periodLabel ? fact.periodLabel === candidate.periodLabel : null,
    sameScope: fact.normalizedScope && candidate.normalizedScope ? fact.normalizedScope === candidate.normalizedScope : null,
    sameUnit: fact.normalizedUnit || candidate.normalizedUnit
      ? fact.normalizedUnit === candidate.normalizedUnit
      : true,
    sameCurrency: fact.normalizedCurrency || candidate.normalizedCurrency
      ? fact.normalizedCurrency === candidate.normalizedCurrency
      : true,
    ...(adjudication?.same ? { adjudicated: { same: true, reason: adjudication.reason || null } } : {}),
  };

  if (adjudication?.same) {
    signals.push(`subject and metric judged equivalent by adjudicator${adjudication.reason ? ` (${adjudication.reason})` : ""}`);
  } else {
    if (!sameSubject) return { compatible: false, score: 0, reason: "subject differs", signals: comparisonSignals };
    signals.push("subject matches");
    if (!samePredicate) return { compatible: false, score: 0, reason: "predicate differs", signals: comparisonSignals };
    signals.push("predicate matches");
  }

  if (!valueTypesCompatible(fact.valueType, candidate.valueType)) {
    return { compatible: false, score: 0, reason: "value type differs", signals: comparisonSignals };
  }
  signals.push("value type compatible");

  if (fact.normalizedObject !== null && fact.normalizedObject !== undefined
    && candidate.normalizedObject !== null && candidate.normalizedObject !== undefined
    && asString(fact.normalizedObject) !== asString(candidate.normalizedObject)) {
    signals.push("object differs; preserved for reconciliation");
  } else {
    signals.push("object compatible");
  }

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

  if (fact.periodLabel && candidate.periodLabel && fact.periodLabel !== candidate.periodLabel) signals.push("period differs; preserved for later analysis");
  if (fact.normalizedScope && candidate.normalizedScope && fact.normalizedScope !== candidate.normalizedScope) signals.push("scope differs; preserved for later analysis");
  const score = adjudication?.same ? 0.9 : 1;
  return { compatible: true, score, reason: signals.join("; "), signals: comparisonSignals };
};

const canonicalPair = (factA, factB) => {
  const first = asString(factA._id);
  const second = asString(factB._id);
  return first < second ? [factA, factB] : [factB, factA];
};

const pairKey = (factA, factB) => canonicalPair(factA, factB).map((fact) => asString(fact._id)).join(":");

const buildCandidateRelationship = (fact, candidate, similarityScore, adjudication = null) => {
  if (!candidate || asString(fact._id) === asString(candidate._id)) return null;
  if (asString(fact.documentId) === asString(candidate.documentId)) return null;
  if (similarityScore < FACT_SIMILARITY_THRESHOLD) return null;
  const compatibility = compareFacts(fact, candidate, adjudication);
  const matchingScore = similarityScore * compatibility.score;
  const confidence = Math.min(fact.confidence ?? 0, candidate.confidence ?? 0, matchingScore);
  if (!compatibility.compatible || matchingScore < MATCH_CONFIDENCE_THRESHOLD || compatibility.score < FACT_COMPATIBILITY_THRESHOLD) return null;
  const [factA, factB] = canonicalPair(fact, candidate);
  return {
    factA: factA._id,
    factB: factB._id,
    relationshipType: "candidate",
    similarityScore: Math.min(1, similarityScore),
    matchingScore: Math.min(1, matchingScore),
    confidence: Math.min(1, confidence),
    reason: compatibility.reason,
    comparisonSignals: { ...compatibility.signals, semanticSimilarity: similarityScore },
    evidence: [
      { fact: "Fact A", documentId: factA.documentId, pageId: factA.pageId, pageNumber: factA.pageNumber ?? null, chunkId: factA.chunkId, sourceText: factA.sourceText || null },
      { fact: "Fact B", documentId: factB.documentId, pageId: factB.pageId, pageNumber: factB.pageNumber ?? null, chunkId: factB.chunkId, sourceText: factB.sourceText || null },
    ],
    status: "pending",
  };
};

// Returns the semantic matches for one fact as { candidate, similarity } pairs (other documents only).
const findCandidateMatches = async (fact, search = queryFactVectors, vector = null) => {
  // Reuse the vector produced during upsert when available so each fact is embedded only once.
  const result = vector
    ? await queryFactVectorsByVector(vector, FACT_MATCH_TOP_K)
    : await search(fact.matchText || fact.sourceText, FACT_MATCH_TOP_K);
  const matches = result?.matches || [];
  const candidateIds = matches.map((match) => match.metadata?.factId).filter(Boolean);
  const candidates = await Fact.find({ _id: { $in: candidateIds } }).lean();
  const byId = new Map(candidates.map((candidate) => [candidate._id.toString(), candidate]));
  return matches
    .map((match) => ({ candidate: byId.get(match.metadata?.factId), similarity: match.score || 0 }))
    .filter(({ candidate }) => candidate && asString(candidate.documentId) !== asString(fact.documentId) && asString(candidate._id) !== asString(fact._id));
};

const findCandidateRelationships = async (fact, search = queryFactVectors, vector = null) => {
  const matches = await findCandidateMatches(fact, search, vector);
  return matches.map(({ candidate, similarity }) => buildCandidateRelationship(fact, candidate, similarity)).filter(Boolean);
};

// Two passes: deterministic string matching first, then an LLM adjudication for strongly similar pairs
// whose subject or metric wording differs ("the company" vs "Delhivery", "net income" vs "profit after tax").
const createCandidateRelationships = async (facts, search = queryFactVectors, vectorsByFactId = new Map(), adjudicate = adjudicateFactPairs, onProgress = null) => {
  const relationships = new Map();
  const pendingAdjudication = new Map();
  if (!facts.length) return [];
  // Relationships only exist between documents, so skip the queries entirely when nothing else is indexed.
  const documentIds = [...new Set(facts.map((fact) => asString(fact.documentId)))];
  const otherFacts = await Fact.countDocuments({ documentId: { $nin: documentIds } });
  if (!otherFacts) {
    console.log("No facts from other documents to compare against; skipping matching");
    return [];
  }
  const concurrency = Number(process.env.MATCHING_CONCURRENCY || 8);
  let queried = 0;
  const matchesPerFact = await mapWithConcurrency(facts, concurrency, async (fact) => {
    const matches = await findCandidateMatches(fact, search, vectorsByFactId.get(fact._id.toString()) ?? null);
    queried += 1;
    if (onProgress && (queried % 25 === 0 || queried === facts.length)) await onProgress(queried, facts.length);
    return matches;
  });
  for (const [index, fact] of facts.entries()) {
    for (const { candidate, similarity } of matchesPerFact[index]) {
      const key = pairKey(fact, candidate);
      if (relationships.has(key) || pendingAdjudication.has(key)) continue;
      const relationship = buildCandidateRelationship(fact, candidate, similarity);
      if (relationship) {
        relationships.set(key, relationship);
      } else if (similarity >= FACT_ADJUDICATION_SIMILARITY && pendingAdjudication.size < MAX_ADJUDICATION_PAIRS_PER_DOCUMENT) {
        const compatibility = compareFacts(fact, candidate);
        if (/subject differs|predicate differs/.test(compatibility.reason)) {
          pendingAdjudication.set(key, { key, factA: fact, factB: candidate, similarity });
        }
      }
    }
  }
  if (pendingAdjudication.size) {
    console.log(`Adjudicating ${pendingAdjudication.size} near-miss fact pairs`);
    if (onProgress) await onProgress(facts.length, facts.length, `adjudicating ${pendingAdjudication.size} near-miss pairs`);
    const verdicts = await adjudicate([...pendingAdjudication.values()]);
    for (const pair of pendingAdjudication.values()) {
      const verdict = verdicts.get(pair.key);
      if (!verdict?.same) continue;
      const relationship = buildCandidateRelationship(pair.factA, pair.factB, pair.similarity, verdict);
      if (relationship) relationships.set(pair.key, relationship);
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

export { buildCandidateRelationship, compareFacts, createCandidateRelationships, deleteRelationshipsForFacts, findCandidateRelationships, findCandidateMatches };
