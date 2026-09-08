import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin } from "../configs/cors.js";

test("any vercel.app deployment is allowed, including preview subdomains", () => {
  assert.equal(isAllowedOrigin("https://factlayer.vercel.app"), true);
  assert.equal(isAllowedOrigin("https://factlayer-git-main-joseph.vercel.app"), true);
  assert.equal(isAllowedOrigin("https://a-b-c.d.vercel.app"), true);
});

test("local development and tunnels are allowed", () => {
  assert.equal(isAllowedOrigin("http://localhost:8080"), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:3000"), true);
  assert.equal(isAllowedOrigin("https://b5c2-112-133-220-139.ngrok-free.app"), true);
  assert.equal(isAllowedOrigin(undefined), true, "curl and server-to-server calls send no Origin");
});

test("look-alike domains are refused", () => {
  assert.equal(isAllowedOrigin("https://vercel.app.evil.com"), false);
  assert.equal(isAllowedOrigin("https://notvercel.app.attacker.io"), false);
  assert.equal(isAllowedOrigin("http://evil.com"), false);
});

test("extra origins can be configured, and \"*\" opens it up", () => {
  const previous = process.env.ALLOWED_ORIGINS;
  try {
    process.env.ALLOWED_ORIGINS = "https://factlayer.example.com";
    assert.equal(isAllowedOrigin("https://factlayer.example.com"), true);
    assert.equal(isAllowedOrigin("https://other.example.com"), false);
    process.env.ALLOWED_ORIGINS = "*";
    assert.equal(isAllowedOrigin("https://anything.test"), true);
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previous;
  }
});
