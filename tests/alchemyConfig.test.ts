import { describe, expect, it } from "vitest";

import { getAlchemyBaseConfig } from "../lib/alchemyConfig";

describe("Alchemy Base configuration", () => {
  it("accepts the recommended full Base Mainnet RPC URL", () => {
    expect(
      getAlchemyBaseConfig({
        ALCHEMY_BASE_RPC_URL:
          "https://base-mainnet.g.alchemy.com/v2/example-key",
      })
    ).toEqual({
      apiKey: "example-key",
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/example-key",
    });
  });

  it("stays unconfigured when the new RPC URL variable is absent", () => {
    expect(getAlchemyBaseConfig({})).toBeNull();
  });

  it("rejects non-Base or malformed RPC URLs", () => {
    expect(() =>
      getAlchemyBaseConfig({
        ALCHEMY_BASE_RPC_URL: "https://eth-mainnet.g.alchemy.com/v2/key",
      })
    ).toThrow(/Base RPC URL/);
  });
});
