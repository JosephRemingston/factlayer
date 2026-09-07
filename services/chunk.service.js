import { MAX_CHUNK_CHARACTERS } from "../utils/constants.js";

const splitText = (text, maxCharacters = MAX_CHUNK_CHARACTERS) => {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) return [];

  const words = normalizedText.split(" ");
  const chunks = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > maxCharacters) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

const createChunksForPage = ({ documentId, pageId, pageNumber, text, maxCharacters }) =>
  splitText(text, maxCharacters).map((chunkText, chunkIndex) => ({
    documentId,
    pageId,
    pageNumber,
    chunkIndex,
    text: chunkText,
    tokenCount: chunkText.split(/\s+/).length,
  }));

export { splitText, createChunksForPage };