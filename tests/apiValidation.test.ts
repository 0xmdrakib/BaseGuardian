import { describe, expect, it } from "vitest";
import {
  validateEvmAddress,
  validateWalletAddressOrName,
} from "../lib/apiValidation";

const VALID_ADDRESS = "0x0000000000000000000000000000000000000001";

describe("API input validation", () => {
  it("accepts exact EVM addresses", () => {
    expect(validateEvmAddress(VALID_ADDRESS)).toEqual({
      ok: true,
      value: VALID_ADDRESS,
    });
  });

  it("rejects short, oversized, and malformed contract addresses", () => {
    expect(validateEvmAddress("0x1234").ok).toBe(false);
    expect(validateEvmAddress(`${VALID_ADDRESS}00`).ok).toBe(false);
    expect(validateEvmAddress("not-an-address").ok).toBe(false);
  });

  it("accepts supported wallet names and addresses", () => {
    expect(validateWalletAddressOrName(VALID_ADDRESS).ok).toBe(true);
    expect(validateWalletAddressOrName("vitalik.eth").ok).toBe(true);
    expect(validateWalletAddressOrName("alice.base.eth").ok).toBe(true);
  });

  it("rejects unsupported or abusive wallet inputs", () => {
    expect(validateWalletAddressOrName("alice.xyz").ok).toBe(false);
    expect(validateWalletAddressOrName("a".repeat(256) + ".eth").ok).toBe(
      false
    );
    expect(validateWalletAddressOrName("\u0000.eth").ok).toBe(false);
  });
});
