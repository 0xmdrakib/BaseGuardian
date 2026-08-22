import { describe, expect, it } from "vitest";
import { matchesConnectedWallet } from "../lib/smartWalletInput";

const ADDRESS = "0xAbCd000000000000000000000000000000001234";

describe("smart wallet input matching", () => {
  it("keeps follow mode for the same address regardless of whitespace or case", () => {
    expect(matchesConnectedWallet(`  ${ADDRESS.toLowerCase()}  `, ADDRESS)).toBe(
      true
    );
  });

  it("treats a manual address as an override", () => {
    expect(
      matchesConnectedWallet(
        "0x0000000000000000000000000000000000000001",
        ADDRESS
      )
    ).toBe(false);
  });

  it("does not follow when no wallet is connected", () => {
    expect(matchesConnectedWallet(ADDRESS)).toBe(false);
  });
});
