import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserGlobals = ["DOMMatrix", "DOMPoint", "Path2D", "ImageData"] as const;

function snapshotGlobals() {
  const snapshot: Record<string, unknown> = {};

  for (const name of browserGlobals) {
    snapshot[name] = (globalThis as unknown as Record<string, unknown>)[name];
  }

  return snapshot;
}

function restoreGlobals(snapshot: Record<string, unknown>) {
  for (const name of browserGlobals) {
    if (snapshot[name] === undefined) {
      delete (globalThis as unknown as Record<string, unknown>)[name];
    } else {
      (globalThis as unknown as Record<string, unknown>)[name] = snapshot[name];
    }
  }
}

describe("pdf runtime polyfill", () => {
  let snapshot: Record<string, unknown>;

  beforeEach(() => {
    snapshot = snapshotGlobals();

    for (const name of browserGlobals) {
      delete (globalThis as unknown as Record<string, unknown>)[name];
    }

    vi.resetModules();
  });

  afterEach(() => {
    restoreGlobals(snapshot);
    vi.doUnmock("@napi-rs/canvas");
    vi.resetModules();
  });

  it("installs DOMMatrix and friends from @napi-rs/canvas when available", async () => {
    class FakeMatrix {}
    class FakePoint {}
    class FakePath2D {}
    class FakeImageData {}

    vi.doMock("@napi-rs/canvas", () => ({
      DOMMatrix: FakeMatrix,
      DOMPoint: FakePoint,
      Path2D: FakePath2D,
      ImageData: FakeImageData,
    }));

    const { installPdfRuntime } = await import("../src/lib/pdf-runtime-polyfill");
    await installPdfRuntime();

    expect((globalThis as unknown as Record<string, unknown>).DOMMatrix).toBe(FakeMatrix);
    expect((globalThis as unknown as Record<string, unknown>).DOMPoint).toBe(FakePoint);
    expect((globalThis as unknown as Record<string, unknown>).Path2D).toBe(FakePath2D);
    expect((globalThis as unknown as Record<string, unknown>).ImageData).toBe(FakeImageData);
  });

  it("falls back to a built-in DOMMatrix when @napi-rs/canvas cannot load", async () => {
    vi.doMock("@napi-rs/canvas", () => {
      throw new Error("Cannot find module '@napi-rs/canvas'");
    });

    const { installPdfRuntime } = await import("../src/lib/pdf-runtime-polyfill");
    await installPdfRuntime();

    const Matrix = (globalThis as unknown as Record<string, unknown>).DOMMatrix as new (init?: number[]) => {
      a: number;
      e: number;
      f: number;
      translateSelf: (tx: number, ty: number) => unknown;
    };

    expect(typeof Matrix).toBe("function");

    const matrix = new Matrix([1, 0, 0, 1, 10, 20]);
    matrix.translateSelf(5, 7);

    expect(matrix.e).toBe(15);
    expect(matrix.f).toBe(27);
    expect(typeof (globalThis as unknown as Record<string, unknown>).Path2D).toBe("function");
    expect(typeof (globalThis as unknown as Record<string, unknown>).ImageData).toBe("function");
    expect(typeof (globalThis as unknown as Record<string, unknown>).DOMPoint).toBe("function");
  });

  it("does not overwrite an existing DOMMatrix global", async () => {
    class ExistingMatrix {}
    (globalThis as unknown as Record<string, unknown>).DOMMatrix = ExistingMatrix;

    vi.doMock("@napi-rs/canvas", () => ({
      DOMMatrix: class Replacement {},
    }));

    const { installPdfRuntime } = await import("../src/lib/pdf-runtime-polyfill");
    await installPdfRuntime();

    expect((globalThis as unknown as Record<string, unknown>).DOMMatrix).toBe(ExistingMatrix);
  });
});
