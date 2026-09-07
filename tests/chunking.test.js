import test from "node:test";
import assert from "node:assert/strict";
import { createChunksForPage, splitText } from "../services/chunk.service.js";

test("chunking preserves order and page metadata without empty chunks", () => {
  const chunks = createChunksForPage({
    documentId: "document-1",
    pageId: "page-1",
    pageNumber: 4,
    text: "one two three four five six",
    maxCharacters: 12,
  });
  assert.deepEqual(chunks.map((chunk) => chunk.chunkIndex), [0, 1, 2]);
  assert.ok(chunks.every((chunk) => chunk.text.length > 0 && chunk.pageNumber === 4));
  assert.deepEqual(splitText("  "), []);
});

test("chunking is deterministic", () => {
  const input = { documentId: "d", pageId: "p", pageNumber: 1, text: "alpha beta gamma" };
  assert.deepEqual(createChunksForPage(input), createChunksForPage(input));
});