import { describe, expect, it, vi } from "vitest";
import {
  requestBaseWalletSwitch,
  walletChainIsMissing,
} from "../lib/walletNetwork";

describe("private-RPC-safe wallet network switching", () => {
  it("requests only a Base switch and never auto-adds a public RPC", async () => {
    const request = vi.fn().mockResolvedValue(null);
    await requestBaseWalletSwitch({
      getProvider: async () => ({ request }),
    });

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x2105" }],
    });
    expect(request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "wallet_addEthereumChain" })
    );
  });

  it("recognizes an unknown-chain error so the UI can show manual guidance", () => {
    expect(walletChainIsMissing({ code: 4902 })).toBe(true);
    expect(walletChainIsMissing({ cause: { code: 4902 } })).toBe(true);
    expect(walletChainIsMissing({ code: 4001 })).toBe(false);
  });
});
