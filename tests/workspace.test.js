import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOwner } from "../middlewares/owner.middleware.js";
import { chunkNamespaceName, factNamespaceName } from "../services/embedding.service.js";

test("workspace names are normalized so the same person always lands in the same workspace", () => {
  assert.equal(normalizeOwner("Joseph"), "joseph");
  assert.equal(normalizeOwner("  ANNA  "), "anna");
  assert.equal(normalizeOwner("team one"), "team one");
  assert.equal(normalizeOwner("a.b_c-1"), "a.b_c-1");
});

test("names that could collide with namespaces or be empty are rejected", () => {
  assert.equal(normalizeOwner("bad/name"), null);
  assert.equal(normalizeOwner(""), null);
  assert.equal(normalizeOwner(null), null);
  assert.equal(normalizeOwner(" "), null);
  assert.equal(normalizeOwner("_leading"), null);
  assert.equal(normalizeOwner("x".repeat(60)).length, 40);
});

test("each workspace gets its own vector namespaces", () => {
  assert.equal(chunkNamespaceName("joseph"), "chunks__joseph");
  assert.equal(factNamespaceName("joseph"), "facts__joseph");
  assert.notEqual(factNamespaceName("joseph"), factNamespaceName("anna"));
  // A missing owner falls back to the default workspace rather than leaking into another one.
  assert.equal(factNamespaceName(undefined), "facts__demo");
});
