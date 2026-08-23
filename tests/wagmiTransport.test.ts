import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Transport } from "viem";
import { POST } from "../app/api/base/rpc-disabled/route";
import { createAppBaseChain } from "../lib/baseChain";
import {
  createDisabledBrowserRpcTransport,
} from "../lib/wagmi";

describe("Wagmi Base transport", () => {
  it("publishes only the same-origin disabled URL and never performs RPC fetches", async () => {
    const url = "https://baseguardian.example/api/base/rpc-disabled";
    const appBase = createAppBaseChain(url);
    const transport = createDisabledBrowserRpcTransport(url);
    const instance = transport({
      chain: appBase,
      pollingInterval: 4_000,
      retryCount: 0,
      timeout: 10_000,
    } as Parameters<Transport>[0]);

    expect(instance.value).toEqual({ url });
    expect(appBase.rpcUrls.default.http).toEqual([url]);
    expect(JSON.stringify(appBase.rpcUrls)).not.toContain("mainnet.base.org");
    await expect(
      instance.request({ method: "eth_blockNumber" })
    ).rejects.toThrow("Direct browser Base RPC is disabled");
  });

  it("fails closed if WalletConnect ever tries its same-origin RPC metadata", async () => {
    const response = await POST(
      new NextRequest("https://baseguardian.example/api/base/rpc-disabled", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vercel-forwarded-for": "198.51.100.90",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "eth_blockNumber",
          params: [],
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 7,
      error: { code: -32601 },
    });
  });
});
