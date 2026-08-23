import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  protectBaseApi,
  resetApiProtectionForTests,
} from "../lib/apiProtection";

function request(
  ip = "203.0.113.10",
  extraHeaders: Record<string, string> = {}
) {
  return new NextRequest("https://baseguardian.example/api/base/wallet", {
    headers: { "x-vercel-forwarded-for": ip, ...extraHeaders },
  });
}

beforeEach(() => {
  resetApiProtectionForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T00:00:00Z"));
});

describe("API protection", () => {
  it("applies the wallet endpoint quota and returns retry headers", async () => {
    for (let index = 0; index < 10; index += 1) {
      expect(protectBaseApi(request(), "wallet")).toBeNull();
    }

    const response = protectBaseApi(request(), "wallet");
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("60");
    expect(response?.headers.get("RateLimit-Limit")).toBe("10");
    await expect(response?.json()).resolves.toMatchObject({ retryAfter: 60 });
  });

  it("keeps client counters independent", () => {
    for (let index = 0; index < 10; index += 1) {
      protectBaseApi(request("203.0.113.10"), "tokens");
    }

    expect(protectBaseApi(request("203.0.113.10"), "tokens")?.status).toBe(429);
    expect(protectBaseApi(request("203.0.113.11"), "tokens")).toBeNull();
  });

  it("uses the real Cloudflare client IP instead of a shared proxy IP", () => {
    const proxyIp = "192.0.2.40";
    for (let index = 0; index < 6; index += 1) {
      expect(
        protectBaseApi(
          request(proxyIp, { "cf-connecting-ip": "203.0.113.20" }),
          "approvals"
        )
      ).toBeNull();
    }

    expect(
      protectBaseApi(
        request(proxyIp, { "cf-connecting-ip": "203.0.113.20" }),
        "approvals"
      )?.status
    ).toBe(429);
    expect(
      protectBaseApi(
        request(proxyIp, { "cf-connecting-ip": "203.0.113.21" }),
        "approvals"
      )
    ).toBeNull();
  });

  it("resets a window after it expires", () => {
    for (let index = 0; index < 10; index += 1) {
      protectBaseApi(request(), "wallet");
    }

    vi.advanceTimersByTime(60_000);
    expect(protectBaseApi(request(), "wallet")).toBeNull();
  });

  it("limits expensive approval scans to six requests per minute", () => {
    for (let index = 0; index < 6; index += 1) {
      expect(protectBaseApi(request(), "approvals")).toBeNull();
    }

    const response = protectBaseApi(request(), "approvals");
    expect(response?.status).toBe(429);
    expect(response?.headers.get("RateLimit-Limit")).toBe("6");
  });

  it("allows balanced transaction-status polling without opening a spam path", () => {
    for (let index = 0; index < 20; index += 1) {
      expect(
        protectBaseApi(
          request(`203.0.113.${index + 30}`),
          "revoke-status"
        )
      ).toBeNull();
    }

    for (let index = 0; index < 20; index += 1) {
      expect(protectBaseApi(request(), "revoke-status")).toBeNull();
    }
    expect(protectBaseApi(request(), "revoke-status")?.status).toBe(429);
  });

  it("applies the aggregate minute quota across endpoints", () => {
    for (let index = 0; index < 30; index += 1) {
      const category = index % 2 === 0 ? "token-info" : "nft";
      expect(protectBaseApi(request(), category)).toBeNull();
    }

    const response = protectBaseApi(request(), "wallet");
    expect(response?.status).toBe(429);
    expect(response?.headers.get("RateLimit-Limit")).toBe("30");
  });
});
