import { describe, expect, it } from "vitest";
import { createOfflineRecordKey, getOfflineDatabase } from "@/lib/offline/db";

describe("offline database helpers", () => {
  it("creates stable cache keys by table and record id", () => {
    expect(createOfflineRecordKey("forms", "form-1")).toBe("forms:form-1");
  });

  it("does not open IndexedDB from the server runtime", () => {
    expect(() => getOfflineDatabase()).toThrow("Offline database is only available in the browser.");
  });
});
