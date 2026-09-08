import Fact from "../models/fact.models.js";
import Document from "../models/document.models.js";
import Relationship from "../models/relationship.models.js";
import ExtractionIssue from "../models/extractionIssue.models.js";
import { ISSUE_HANDLING } from "./extraction.service.js";

const asId = (value) => (value === null || value === undefined ? "" : String(value));

const factPopulation = [{ path: "factA", populate: { path: "documentId", select: "originalFileName primaryEntity" } }, { path: "factB", populate: { path: "documentId", select: "originalFileName primaryEntity" } }];

const describeEvidence = (fact, label) => ({
  fact: label,
  factId: asId(fact?._id),
  documentId: asId(fact?.documentId?._id ?? fact?.documentId),
  documentName: fact?.documentId?.originalFileName || null,
  pageNumber: fact?.pageNumber ?? null,
  chunkId: asId(fact?.chunkId),
  subject: fact?.subject || null,
  predicate: fact?.predicate || null,
  value: fact?.value ?? fact?.object ?? null,
  unit: fact?.unit || null,
  currency: fact?.currency || null,
  period: fact?.period || null,
  scope: fact?.scope || null,
  normalizedValue: fact?.normalizedValue ?? null,
  sourceText: fact?.sourceText || null,
});

// The same metric expressed with different subject or predicate wording is the most convincing
// corroboration; adjudicated pairs are the clearest instance of that.
const wordingDiffers = (relationship) => {
  const { factA, factB } = relationship;
  if (!factA || !factB) return false;
  if (relationship.comparisonSignals?.adjudicated?.same) return true;
  return factA.subject?.toLowerCase() !== factB.subject?.toLowerCase() || factA.predicate?.toLowerCase() !== factB.predicate?.toLowerCase()
    || String(factA.value) !== String(factB.value) || (factA.unit || "") !== (factB.unit || "") || (factA.currency || "") !== (factB.currency || "");
};

const rank = (type, relationship) => {
  let score = relationship.confidence ?? 0;
  if (type === "corroborated" && wordingDiffers(relationship)) score += 0.5;
  if (type === "contradiction" && typeof relationship.comparisonSignals?.percentageDifference === "number") score += Math.min(0.5, relationship.comparisonSignals.percentageDifference);
  if (type === "contextual_difference" && /period/.test(relationship.context || "")) score += 0.25;
  if (relationship.factA?.pageNumber != null && relationship.factB?.pageNumber != null) score += 0.05;
  return score;
};

const toCase = (relationship) => ({
  relationshipId: asId(relationship._id),
  classification: relationship.classification || relationship.relationshipType,
  confidence: relationship.confidence,
  similarityScore: relationship.similarityScore,
  documents: [relationship.factA?.documentId?.originalFileName, relationship.factB?.documentId?.originalFileName].filter(Boolean),
  evidence: [describeEvidence(relationship.factA, "Fact A"), describeEvidence(relationship.factB, "Fact B")],
  reasoning: {
    summary: relationship.summary || null,
    reason: relationship.reason,
    detailedReason: relationship.detailedReason || null,
    context: relationship.context || null,
    keySimilarities: relationship.keySimilarities || [],
    keyDifferences: relationship.keyDifferences || [],
    comparisonSignals: relationship.comparisonSignals || {},
    adjudicated: relationship.comparisonSignals?.adjudicated || null,
  },
});

const pickCases = async (type, limit = 3, owner) => {
  const candidates = await Relationship.find({ relationshipType: type, status: "reviewed", ...(owner ? { owner } : {}) })
    .sort({ confidence: -1 }).limit(60).populate(factPopulation).lean();
  const crossDocument = candidates.filter((relationship) => relationship.factA && relationship.factB
    && asId(relationship.factA.documentId?._id) !== asId(relationship.factB.documentId?._id));
  return crossDocument.sort((a, b) => rank(type, b) - rank(type, a)).slice(0, limit).map(toCase);
};

const IMPROVEMENTS = [
  "Ungrounded evidence: the model sometimes paraphrases instead of quoting. Matching already ignores punctuation, quote style, hyphenation and number spacing; a fuzzy span search (edit distance) would recover the remaining paraphrases without weakening the guarantee that evidence exists on the page.",
  "Malformed JSON: JSON mode plus one corrective re-request handles nearly all cases; a schema-constrained provider (structured outputs) would remove the failure mode entirely.",
  "Values without a stated period: numeric facts whose period is missing are classified uncertain rather than contradiction; inferring the period from surrounding headings and document dates would resolve most of them.",
  "Subject wording: 'the company' is resolved to the document's primary entity, and remaining near-miss pairs are adjudicated by the model in batches; a per-document alias table for subsidiaries and segments would cut adjudication calls further.",
];

// One best real example of each assignment case, plus alternatives and the failures the pipeline caught.
const getShowcase = async (owner) => {
  const scope = owner ? { owner } : {};
  const [corroborated, contradiction, contextual, uncertain, relationshipCounts, issueCounts, documents] = await Promise.all([
    pickCases("corroborated", 3, owner),
    pickCases("contradiction", 3, owner),
    pickCases("contextual_difference", 3, owner),
    pickCases("uncertain", 2, owner),
    Relationship.aggregate([{ $match: { status: "reviewed", ...scope } }, { $group: { _id: "$relationshipType", count: { $sum: 1 } } }]),
    ExtractionIssue.aggregate([{ $match: scope }, { $group: { _id: "$type", count: { $sum: 1 } } }]),
    Document.find(scope).select("originalFileName status primaryEntity factCount relationshipCount extractionIssueCount pageCount").sort({ createdAt: 1 }).lean(),
  ]);
  const issueExamples = await Promise.all((issueCounts.map((row) => row._id)).map(async (type) => {
    const examples = await ExtractionIssue.find({ type, ...scope }).sort({ createdAt: -1 }).limit(2).populate("documentId", "originalFileName").lean();
    return examples.map((issue) => ({
      type,
      documentName: issue.documentId?.originalFileName || null,
      pageNumber: issue.pageNumber,
      message: issue.message,
      handling: issue.handling,
      candidate: issue.candidate,
      outputPreview: issue.outputPreview,
    }));
  }));
  const factCount = await Fact.countDocuments(scope);
  return {
    documents: documents.map((document) => ({ id: asId(document._id), name: document.originalFileName, status: document.status, primaryEntity: document.primaryEntity, pages: document.pageCount, facts: document.factCount, relationships: document.relationshipCount, extractionIssues: document.extractionIssueCount })),
    totals: { facts: factCount, relationships: Object.fromEntries(relationshipCounts.map((row) => [row._id, row.count])), extractionIssues: Object.fromEntries(issueCounts.map((row) => [row._id, row.count])) },
    cases: {
      corroborated: { title: "A fact corroborated across documents, even if expressed differently", best: corroborated[0] || null, alternatives: corroborated.slice(1) },
      contradiction: { title: "A genuine or likely contradiction", best: contradiction[0] || null, alternatives: contradiction.slice(1) },
      contextual_difference: { title: "An apparent contradiction explained by context", best: contextual[0] || null, alternatives: contextual.slice(1) },
      uncertain: { title: "Related facts the system declined to classify", best: uncertain[0] || null, alternatives: uncertain.slice(1) },
    },
    extractionFailures: {
      title: "Extraction or reasoning failures found and how they were handled",
      counts: Object.fromEntries(issueCounts.map((row) => [row._id, row.count])),
      handling: ISSUE_HANDLING,
      examples: issueExamples.flat(),
      improvements: IMPROVEMENTS,
    },
  };
};

export { getShowcase, pickCases };
