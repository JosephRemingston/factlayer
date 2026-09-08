import test from "node:test";
import assert from "node:assert/strict";
import { DOMMatrixPolyfill, ImageDataPolyfill, Path2DPolyfill } from "../utils/pdfPolyfills.js";
import extractPdfPages from "../services/pdf.service.js";
import fs from "node:fs";

test("the browser globals pdfjs needs at load time are present", () => {
  // Without these, importing pdf-parse throws "DOMMatrix is not defined" on runtimes that have no
  // @napi-rs/canvas binary, which is what happens on serverless hosts.
  assert.equal(typeof globalThis.DOMMatrix, "function");
  assert.equal(typeof globalThis.ImageData, "function");
  assert.equal(typeof globalThis.Path2D, "function");
});

test("the DOMMatrix stand-in behaves like an identity matrix", () => {
  const identity = new DOMMatrixPolyfill();
  assert.equal(identity.a, 1);
  assert.equal(identity.d, 1);
  assert.equal(identity.e, 0);
  assert.deepEqual(identity.transformPoint({ x: 3, y: 4 }), { x: 3, y: 4, z: 0, w: 1 });
  const scaled = identity.scale(2, 3);
  assert.equal(scaled.a, 2);
  assert.equal(scaled.d, 3);
  assert.equal(new DOMMatrixPolyfill("matrix(1, 0, 0, 1, 5, 6)").e, 5);
});

test("the ImageData and Path2D stand-ins construct without throwing", () => {
  const image = new ImageDataPolyfill(2, 3);
  assert.equal(image.width, 2);
  assert.equal(image.data.length, 24);
  const path = new Path2DPolyfill();
  path.moveTo(0, 0);
  path.rect(0, 0, 1, 1);
});

test("text extraction still yields page-shaped output", async () => {
  const file = "data/starter-datasets/delhivery/03-delhivery-q4-fy24-earnings-presentation.pdf";
  if (!fs.existsSync(file)) return; // sample PDFs are optional in a checkout
  const pages = await extractPdfPages(fs.readFileSync(file));
  assert.ok(pages.length > 1);
  assert.equal(pages[0].pageNumber, 1);
  assert.ok(pages.reduce((sum, page) => sum + page.text.length, 0) > 1000);
});
