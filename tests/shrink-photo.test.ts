import { describe, expect, it } from "vitest";
import { dataUrlByteSize, fitWithin, PHOTO_MAX_EDGE } from "@/lib/offline/shrink-photo";

describe("fitWithin", () => {
  it("caps the long edge of a landscape phone photo and keeps its shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ height: 1200, width: PHOTO_MAX_EDGE });
  });

  it("caps a portrait photo on its height", () => {
    expect(fitWithin(3024, 4032)).toEqual({ height: PHOTO_MAX_EDGE, width: 1200 });
  });

  it("never enlarges a photo that is already small", () => {
    expect(fitWithin(800, 600)).toEqual({ height: 600, width: 800 });
  });

  it("leaves a photo exactly at the limit alone", () => {
    expect(fitWithin(PHOTO_MAX_EDGE, 900)).toEqual({ height: 900, width: PHOTO_MAX_EDGE });
  });

  it("does not collapse a very thin image to zero", () => {
    expect(fitWithin(10000, 2).height).toBe(1);
  });

  it("returns zero for an image that could not be measured", () => {
    expect(fitWithin(0, 0)).toEqual({ height: 0, width: 0 });
    expect(fitWithin(Number.NaN, 100).width).toBe(0);
  });
});

describe("dataUrlByteSize", () => {
  it("counts the decoded bytes, not the base64 characters", () => {
    expect(dataUrlByteSize("data:image/jpeg;base64,QUJD")).toBe(3);
    expect(dataUrlByteSize("data:image/jpeg;base64,QUI=")).toBe(2);
    expect(dataUrlByteSize("data:image/jpeg;base64,QQ==")).toBe(1);
  });

  it("is zero for an empty body", () => {
    expect(dataUrlByteSize("data:image/jpeg;base64,")).toBe(0);
  });
});
