/**
 * pdfjs (used by pdf-parse) builds a `new DOMMatrix()` at module load inside its canvas renderer, and
 * normally gets those browser globals from the optional `@napi-rs/canvas` native package. Serverless
 * runtimes often lack that binary, so importing pdf-parse throws `DOMMatrix is not defined` before any
 * PDF is read. We only extract text and never rasterise a page, so these minimal stand-ins are enough
 * to let the module load; the real `@napi-rs/canvas` is used instead whenever it is available.
 */

class DOMMatrixPolyfill {
  constructor(init) {
    const values = typeof init === "string"
      ? init.replace(/^matrix\(|\)$/g, "").split(",").map(Number)
      : Array.isArray(init) ? init : null;
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = values || [];
    Object.assign(this, { a, b, c, d, e, f, m11: a, m12: b, m21: c, m22: d, m41: e, m42: f, is2D: true });
  }

  // Enough surface for pdfjs to call without throwing; text extraction never depends on the result.
  scale(sx = 1, sy = sx) { return new DOMMatrixPolyfill([this.a * sx, this.b * sx, this.c * sy, this.d * sy, this.e, this.f]); }
  translate(tx = 0, ty = 0) { return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e + tx, this.f + ty]); }
  multiply() { return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]); }
  invertSelf() { return this; }
  scaleSelf(sx = 1, sy = sx) { this.a *= sx; this.d *= sy; return this; }
  translateSelf(tx = 0, ty = 0) { this.e += tx; this.f += ty; return this; }
  transformPoint(point = { x: 0, y: 0 }) {
    return { x: this.a * (point.x ?? 0) + this.c * (point.y ?? 0) + this.e, y: this.b * (point.x ?? 0) + this.d * (point.y ?? 0) + this.f, z: 0, w: 1 };
  }
  toString() { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
}

class ImageDataPolyfill {
  constructor(dataOrWidth, widthOrHeight, maybeHeight) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = maybeHeight ?? (this.width ? dataOrWidth.length / 4 / this.width : 0);
    }
    this.colorSpace = "srgb";
  }
}

class Path2DPolyfill {
  addPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  arcTo() {}
  ellipse() {}
  rect() {}
  roundRect() {}
}

const installed = [];
if (typeof globalThis.DOMMatrix === "undefined") { globalThis.DOMMatrix = DOMMatrixPolyfill; installed.push("DOMMatrix"); }
if (typeof globalThis.ImageData === "undefined") { globalThis.ImageData = ImageDataPolyfill; installed.push("ImageData"); }
if (typeof globalThis.Path2D === "undefined") { globalThis.Path2D = Path2DPolyfill; installed.push("Path2D"); }
if (installed.length) console.log(`PDF text extraction: installed ${installed.join(", ")} stand-ins (no canvas package present)`);

export { DOMMatrixPolyfill, ImageDataPolyfill, Path2DPolyfill, installed };
