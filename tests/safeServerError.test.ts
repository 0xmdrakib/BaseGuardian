import { describe, expect, it } from "vitest";
import { safeServerError } from "../lib/safeServerError";

describe("safe server error logging", () => {
  it("does not include provider messages or private RPC URLs", () => {
    const error = Object.assign(
      new Error(
        "Request failed at https://base-mainnet.g.alchemy.com/v2/private-key"
      ),
      { code: 429, status: 503 }
    );
    const safe = safeServerError(error);

    expect(safe).toEqual({ name: "Error", code: "429", status: 503 });
    expect(JSON.stringify(safe)).not.toContain("private-key");
    expect(JSON.stringify(safe)).not.toContain("alchemy.com");
  });
});
