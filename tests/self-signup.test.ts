import { describe, expect, it } from "vitest";
import { isSelfSignupAvailable, SIGNUP_CLOSED_MESSAGE } from "@/lib/self-signup";

function clientReturning(result: { data: unknown; error: unknown }) {
  return {
    rpc: async () => result,
  };
}

describe("isSelfSignupAvailable", () => {
  it("is open only when the database says there is no company yet", async () => {
    await expect(isSelfSignupAvailable(clientReturning({ data: true, error: null }))).resolves.toBe(true);
  });

  it("is closed once a company exists", async () => {
    await expect(isSelfSignupAvailable(clientReturning({ data: false, error: null }))).resolves.toBe(false);
  });

  // The three ways of not knowing. All of them have to close the form rather than
  // offer it: an unmigrated or unreachable deployment is not one we should be
  // inviting strangers to claim. Getting this backwards is how a stranger ends up
  // with a company inside a client's database.
  it("closes when the call errors", async () => {
    await expect(
      isSelfSignupAvailable(clientReturning({ data: null, error: { message: "function does not exist" } })),
    ).resolves.toBe(false);
  });

  it("closes when the call throws", async () => {
    const throwing = {
      rpc: async () => {
        throw new Error("network down");
      },
    };

    await expect(isSelfSignupAvailable(throwing)).resolves.toBe(false);
  });

  it("closes on anything that is not exactly true", async () => {
    for (const data of [null, undefined, "true", 1, {}]) {
      await expect(isSelfSignupAvailable(clientReturning({ data, error: null }))).resolves.toBe(false);
    }
  });

  it("uses the same wording as the database, so the two cannot drift apart", () => {
    // The trigger raises this exact sentence. If one is reworded the other should
    // be too; a user hitting the API directly and a user on the form should be
    // told the same thing.
    expect(SIGNUP_CLOSED_MESSAGE).toBe(
      "Signing yourself up is closed on this deployment. Ask an administrator to invite you.",
    );
  });
});
