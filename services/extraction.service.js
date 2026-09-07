const EXTRACTION_MODEL = () => process.env.FACT_EXTRACTION_MODEL || "gpt-4o-mini";

const extractionSystemPrompt = `You extract meaningful, comparable facts from document chunks.
Return JSON only in the shape {"facts": []}.
Extract numerical facts, percentages, financial values, counts, dates, periods, quantities, ratios, rates, and important descriptive business facts. Do not turn every sentence into a fact; extract only information that could reasonably be compared across documents.
Every fact must include subject, predicate, sourceText, and confidence. sourceText must be an exact or near-exact span copied from the supplied chunk. Never invent evidence.
CRITICAL: distinguish a metric value from a change or growth percentage. In "Revenue increased 25% to $100M", extract revenue = $100M and revenue growth = 25%; never use 25% as the revenue value.
Use null for fields that are not present. Keep values structured and preserve units, currencies, periods, and scope when stated.`;

const buildExtractionPrompt = (chunk) => `${extractionSystemPrompt}

Chunk ID: ${chunk._id}
Document ID: ${chunk.documentId}
Page ID: ${chunk.pageId}

CHUNK TEXT:
${chunk.text}`;

const parseExtractionResponse = (payload) => {
  let parsed = payload;
  if (typeof payload === "string") parsed = JSON.parse(payload);
  if (payload?.choices?.[0]?.message?.content) {
    parsed = JSON.parse(payload.choices[0].message.content);
  }
  if (!parsed || !Array.isArray(parsed.facts)) {
    throw new Error("LLM extraction response must contain a facts array");
  }
  return parsed.facts;
};

const normalizeEvidence = (value) => String(value || "").replace(/\s+/g, " ").trim();

const isEvidenceGrounded = (sourceText, chunkText) => {
  const evidence = normalizeEvidence(sourceText);
  const chunk = normalizeEvidence(chunkText);
  return Boolean(evidence && chunk && chunk.includes(evidence));
};

const validateFact = (fact, chunk) => {
  if (!fact || typeof fact !== "object") throw new Error("Fact must be an object");
  if (!String(fact.subject || "").trim()) throw new Error("Fact subject is required");
  if (!String(fact.predicate || "").trim()) throw new Error("Fact predicate is required");
  if (!String(fact.sourceText || "").trim()) throw new Error("Fact sourceText is required");
  if (!isEvidenceGrounded(fact.sourceText, chunk.text)) throw new Error("Fact sourceText is not grounded in the chunk");
  if (typeof fact.confidence !== "number" || fact.confidence < 0 || fact.confidence > 1) {
    throw new Error("Fact confidence must be a number between 0 and 1");
  }
  return {
    ...fact,
    subject: fact.subject.trim(),
    predicate: fact.predicate.trim(),
    sourceText: fact.sourceText.trim(),
    documentId: chunk.documentId,
    pageId: chunk.pageId,
    chunkId: chunk._id,
    extractionModel: EXTRACTION_MODEL(),
  };
};

const validateFacts = (facts, chunk) => facts
  .map((fact) => validateFact(fact, chunk));

const requestFactExtraction = async (chunk, request = fetch) => {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for fact extraction");
  const response = await request("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EXTRACTION_MODEL(),
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: extractionSystemPrompt },
        { role: "user", content: buildExtractionPrompt(chunk) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Fact extraction provider failed with status ${response.status}`);
  return response.json();
};

const extractFactsFromChunk = async (chunk, request = fetch) => {
  const response = await requestFactExtraction(chunk, request);
  return validateFacts(parseExtractionResponse(response), chunk);
};

export {
  buildExtractionPrompt,
  parseExtractionResponse,
  validateFact,
  validateFacts,
  extractFactsFromChunk,
};