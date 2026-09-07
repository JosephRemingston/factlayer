import mongoose from "mongoose";
import Fact from "../models/fact.models.js";
import Chunk from "../models/chunk.models.js";
import Document from "../models/document.models.js";
import Relationship from "../models/relationship.models.js";
import { queryChunkVectors, queryFactVectors } from "./embedding.service.js";
import { defaultInvoke, extractJsonText } from "./extraction.service.js";

const asId = (value) => (value === null || value === undefined ? "" : String(value));
const validIds = (matches, key) => (matches || []).map((match) => match.metadata?.[key]).filter((id) => mongoose.isValidObjectId(id));

const describeFact = (fact) => {
  const value = fact.value ?? fact.object;
  const parts = [
    fact.subject,
    fact.predicate,
    value !== null && value !== undefined && value !== "" ? `= ${typeof value === "object" ? JSON.stringify(value) : value}` : null,
    fact.unit,
    fact.currency,
    fact.period ? `(${fact.period})` : null,
    fact.scope ? `[${fact.scope}]` : null,
  ].filter(Boolean);
  return parts.join(" ");
};

const answerSystemPrompt = `You answer questions about a set of documents using ONLY the numbered sources provided.
Return JSON only in the shape:
{"answer": "<plain-language answer with [S#] citations after each claim>", "citations": [{"source": "S1", "quote": "<short verbatim quote from that source>"}], "confidence": <0-1>, "coverage": "full" | "partial" | "none", "notes": ["<caveat or discrepancy>"]}
Rules:
- Cite every factual claim with the source id in square brackets, for example [S2]. Only cite sources that were provided.
- Name the document and page when it helps the reader, for example "the FY24 annual report (page 12)".
- If sources disagree, say so explicitly and explain the likely reason (different period, scope, units, or a genuine contradiction). Use the RELATIONSHIPS section, which contains the system's own reconciliation of related facts, when it applies.
- If the sources do not answer the question, set coverage to "none", say what is missing, and do not guess.
- Keep the answer concise: two to five sentences unless the question needs a list.`;

const buildSources = ({ facts, factScores, chunks, chunkScores, documentsById }) => {
  const sources = [];
  for (const fact of facts) {
    const document = documentsById.get(asId(fact.documentId));
    sources.push({
      id: `S${sources.length + 1}`,
      kind: "fact",
      factId: asId(fact._id),
      chunkId: asId(fact.chunkId),
      documentId: asId(fact.documentId),
      documentName: document?.originalFileName || "Unknown document",
      primaryEntity: document?.primaryEntity || null,
      pageNumber: fact.pageNumber ?? null,
      statement: describeFact(fact),
      quote: fact.sourceText,
      score: factScores.get(asId(fact._id)) ?? null,
    });
  }
  for (const chunk of chunks) {
    const document = documentsById.get(asId(chunk.documentId));
    sources.push({
      id: `S${sources.length + 1}`,
      kind: "passage",
      factId: null,
      chunkId: asId(chunk._id),
      documentId: asId(chunk.documentId),
      documentName: document?.originalFileName || "Unknown document",
      primaryEntity: document?.primaryEntity || null,
      pageNumber: chunk.pageNumber ?? null,
      statement: null,
      quote: String(chunk.text || "").slice(0, 1200),
      score: chunkScores.get(asId(chunk._id)) ?? null,
    });
  }
  return sources;
};

// Retrieves the most relevant facts and passages across every processed document, adds the system's
// reconciliation of related facts, and asks the model for a cited answer.
const answerQuestion = async (question, { topK = 10, invokeModel = null } = {}) => {
  const [factResult, chunkResult] = await Promise.all([
    queryFactVectors(question, topK),
    queryChunkVectors(question, Math.max(3, Math.min(6, Math.ceil(topK / 2)))),
  ]);
  const factScores = new Map((factResult.matches || []).map((match) => [match.metadata?.factId, match.score ?? 0]));
  const chunkScores = new Map((chunkResult.matches || []).map((match) => [match.metadata?.chunkId, match.score ?? 0]));
  const factIds = validIds(factResult.matches, "factId");
  const chunkIds = validIds(chunkResult.matches, "chunkId");
  const [retrievedFacts, chunks] = await Promise.all([
    Fact.find({ _id: { $in: factIds } }).lean(),
    Chunk.find({ _id: { $in: chunkIds } }).lean(),
  ]);
  const factById = new Map(retrievedFacts.map((fact) => [asId(fact._id), fact]));
  let facts = factIds.map((id) => factById.get(id)).filter(Boolean);

  // Relationships that touch a retrieved fact; the other end is pulled in as evidence too.
  const relationships = facts.length
    ? await Relationship.find({ status: "reviewed", $or: [{ factA: { $in: facts.map((fact) => fact._id) } }, { factB: { $in: facts.map((fact) => fact._id) } }] })
      .sort({ confidence: -1 }).limit(8).lean()
    : [];
  const missingIds = [...new Set(relationships.flatMap((relationship) => [asId(relationship.factA), asId(relationship.factB)]))]
    .filter((id) => !factById.has(id));
  if (missingIds.length) {
    const extra = await Fact.find({ _id: { $in: missingIds } }).lean();
    for (const fact of extra) factById.set(asId(fact._id), fact);
    facts = [...facts, ...extra];
  }

  const documentIds = [...new Set([...facts.map((fact) => asId(fact.documentId)), ...chunks.map((chunk) => asId(chunk.documentId))])];
  const documents = await Document.find({ _id: { $in: documentIds } }).select("originalFileName primaryEntity").lean();
  const documentsById = new Map(documents.map((document) => [asId(document._id), document]));
  const sources = buildSources({ facts, factScores, chunks, chunkScores, documentsById });
  const sourceByFactId = new Map(sources.filter((source) => source.factId).map((source) => [source.factId, source]));

  const relationshipNotes = relationships.map((relationship) => {
    const a = sourceByFactId.get(asId(relationship.factA));
    const b = sourceByFactId.get(asId(relationship.factB));
    if (!a || !b) return null;
    return {
      sourceIds: [a.id, b.id],
      classification: relationship.classification || relationship.relationshipType,
      reason: relationship.reason,
      context: relationship.context || null,
      summary: relationship.summary || null,
      keyDifferences: relationship.keyDifferences || [],
    };
  }).filter(Boolean);

  if (!sources.length) {
    return { question, answer: "No processed documents contain facts or passages related to this question yet.", confidence: 0, coverage: "none", notes: [], citations: [], sources: [], relationships: [] };
  }

  const sourceListing = sources.map((source) => `[${source.id}] ${source.kind === "fact" ? "FACT" : "PASSAGE"} from "${source.documentName}"${source.primaryEntity ? ` (about ${source.primaryEntity})` : ""}, page ${source.pageNumber ?? "?"}${source.statement ? `\n  fact: ${source.statement}` : ""}\n  text: "${source.quote}"`).join("\n\n");
  const relationshipListing = relationshipNotes.length
    ? relationshipNotes.map((note) => `- ${note.sourceIds.join(" and ")}: ${note.classification} — ${note.reason}${note.context ? ` (${note.context})` : ""}`).join("\n")
    : "- none";
  const invoke = invokeModel || defaultInvoke;
  const response = await invoke([
    { role: "system", content: answerSystemPrompt },
    { role: "user", content: `QUESTION: ${question}\n\nSOURCES:\n${sourceListing}\n\nRELATIONSHIPS (system reconciliation of related facts):\n${relationshipListing}` },
  ], { maxTokens: 1500 });
  const payload = typeof response === "string" ? response : response?.content ?? response;
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(String(payload)));
  } catch (error) {
    parsed = { answer: String(payload), citations: [], confidence: 0.3, coverage: "partial", notes: ["The model reply was not valid JSON; showing it verbatim."] };
  }
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const citations = (Array.isArray(parsed.citations) ? parsed.citations : [])
    .map((citation) => ({ source: sourceById.get(String(citation.source || "").toUpperCase()), quote: citation.quote || null }))
    .filter((citation) => citation.source)
    .map((citation) => ({ ...citation.source, quote: citation.quote || citation.source.quote }));
  const citedIds = new Set(String(parsed.answer || "").match(/\[S\d+\]/g) || []);
  for (const id of citedIds) {
    const source = sourceById.get(id.slice(1, -1));
    if (source && !citations.some((citation) => citation.id === source.id)) citations.push({ ...source });
  }
  return {
    question,
    answer: String(parsed.answer || "").trim(),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
    coverage: ["full", "partial", "none"].includes(parsed.coverage) ? parsed.coverage : "partial",
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
    citations,
    sources,
    relationships: relationshipNotes,
  };
};

export { answerQuestion, describeFact };
