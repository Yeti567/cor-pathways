/**
 * Server-side PDF runtime polyfill.
 *
 * pdf.js needs browser globals (DOMMatrix, DOMPoint, Path2D, ImageData) that
 * Node does not provide. When @napi-rs/canvas is available we use its native
 * classes; otherwise we fall back to a minimal pure-JS implementation that is
 * good enough for pdf.js's font matrix math. Call this before any import of
 * unpdf or pdf.js to guarantee the globals exist by the time pdf.js runs.
 */

type GlobalScope = typeof globalThis & Record<string, unknown>;

let installPromise: Promise<void> | null = null;

function attach(name: string, value: unknown) {
  const scope = globalThis as GlobalScope;

  if (typeof scope[name] === "undefined") {
    scope[name] = value;
  }
}

class FallbackMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  m11: number;
  m12: number;
  m21: number;
  m22: number;
  m41: number;
  m42: number;
  is2D = true;
  isIdentity = true;

  constructor(init?: number[] | string) {
    if (Array.isArray(init) && init.length === 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    } else {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
    }
    this.m11 = this.a;
    this.m12 = this.b;
    this.m21 = this.c;
    this.m22 = this.d;
    this.m41 = this.e;
    this.m42 = this.f;
    this.isIdentity = this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  translateSelf(tx = 0, ty = 0) {
    this.e += this.a * tx + this.c * ty;
    this.f += this.b * tx + this.d * ty;
    this.isIdentity = false;
    return this;
  }

  scaleSelf(sx = 1, sy = sx) {
    this.a *= sx;
    this.b *= sx;
    this.c *= sy;
    this.d *= sy;
    this.isIdentity = false;
    return this;
  }

  multiplySelf(other: FallbackMatrix) {
    const next: FallbackMatrix = new FallbackMatrix([
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
      this.a * other.e + this.c * other.f + this.e,
      this.b * other.e + this.d * other.f + this.f,
    ]);
    Object.assign(this, next);
    return this;
  }

  invertSelf() {
    const det = this.a * this.d - this.b * this.c;

    if (det === 0) {
      return this;
    }

    const invDet = 1 / det;
    const next: FallbackMatrix = new FallbackMatrix([
      this.d * invDet,
      -this.b * invDet,
      -this.c * invDet,
      this.a * invDet,
      (this.c * this.f - this.d * this.e) * invDet,
      (this.b * this.e - this.a * this.f) * invDet,
    ]);
    Object.assign(this, next);
    return this;
  }
}

class FallbackPoint {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
}

class FallbackPath2D {
  // Stub: pdf.js never calls path methods when text-extraction-only paths are taken.
}

class FallbackImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace = "srgb" as const;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

async function installFromCanvas(): Promise<boolean> {
  try {
    const canvas = (await import("@napi-rs/canvas")) as unknown as Record<string, unknown>;

    if (typeof canvas.DOMMatrix === "function") {
      attach("DOMMatrix", canvas.DOMMatrix);
    }

    if (typeof canvas.DOMPoint === "function") {
      attach("DOMPoint", canvas.DOMPoint);
    }

    if (typeof canvas.Path2D === "function") {
      attach("Path2D", canvas.Path2D);
    }

    if (typeof canvas.ImageData === "function") {
      attach("ImageData", canvas.ImageData);
    }

    return true;
  } catch {
    return false;
  }
}

function installFallback() {
  attach("DOMMatrix", FallbackMatrix);
  attach("DOMPoint", FallbackPoint);
  attach("Path2D", FallbackPath2D);
  attach("ImageData", FallbackImageData);
}

export function installPdfRuntime(): Promise<void> {
  if (!installPromise) {
    installPromise = (async () => {
      const ok = await installFromCanvas();

      if (!ok) {
        installFallback();
      }
    })();
  }

  return installPromise;
}
