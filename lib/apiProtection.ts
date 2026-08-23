import { NextRequest, NextResponse } from "next/server";

export type BaseApiCategory =
  | "wallet"
  | "tokens"
  | "token-info"
  | "nft"
  | "approvals"
  | "revoke-status"
  | "rpc-disabled";

type WindowLimit = { id: string; max: number; windowMs: number };
type Counter = { count: number; resetAt: number; lastSeenAt: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MAX_COUNTERS = 30_000;

const GLOBAL_LIMITS: WindowLimit[] = [
  { id: "global-minute", max: 30, windowMs: MINUTE },
  { id: "global-hour", max: 300, windowMs: HOUR },
];

const CATEGORY_LIMITS: Record<BaseApiCategory, WindowLimit> = {
  wallet: { id: "wallet-minute", max: 10, windowMs: MINUTE },
  tokens: { id: "tokens-minute", max: 10, windowMs: MINUTE },
  "token-info": { id: "token-info-minute", max: 20, windowMs: MINUTE },
  nft: { id: "nft-minute", max: 15, windowMs: MINUTE },
  approvals: { id: "approvals-minute", max: 6, windowMs: MINUTE },
  "revoke-status": { id: "revoke-status-minute", max: 20, windowMs: MINUTE },
  "rpc-disabled": { id: "rpc-disabled-minute", max: 20, windowMs: MINUTE },
};

// Cloudflare provides the shared edge limit. Vercel instances do not share
// this in-memory fallback state.
const counters = new Map<string, Counter>();
let lastCleanupAt = 0;

function clientIp(request: NextRequest) {
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function cleanup(now: number) {
  if (now - lastCleanupAt < MINUTE && counters.size <= MAX_COUNTERS) return;

  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key);
  }

  if (counters.size > MAX_COUNTERS) {
    const oldest = [...counters.entries()]
      .sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)
      .slice(0, counters.size - MAX_COUNTERS);
    for (const [key] of oldest) counters.delete(key);
  }

  lastCleanupAt = now;
}

function counterFor(key: string, limit: WindowLimit, now: number) {
  const existing = counters.get(key);
  if (existing && existing.resetAt > now) return existing;

  const created: Counter = {
    count: 0,
    resetAt: now + limit.windowMs,
    lastSeenAt: now,
  };
  counters.set(key, created);
  return created;
}

export function protectBaseApi(
  request: NextRequest,
  category: BaseApiCategory
) {
  const now = Date.now();
  cleanup(now);

  const ip = clientIp(request);
  const limits = [...GLOBAL_LIMITS, CATEGORY_LIMITS[category]];
  const evaluated = limits.map((limit) => ({
    limit,
    counter: counterFor(`${ip}:${limit.id}`, limit, now),
  }));
  const denied = evaluated.find(({ limit, counter }) => counter.count >= limit.max);

  if (denied) {
    const retryAfter = Math.max(
      1,
      Math.ceil((denied.counter.resetAt - now) / 1000)
    );
    return NextResponse.json(
      {
        error: `Too many requests. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": String(retryAfter),
          "RateLimit-Limit": String(denied.limit.max),
          "RateLimit-Remaining": "0",
          "RateLimit-Reset": String(retryAfter),
        },
      }
    );
  }

  for (const { counter } of evaluated) {
    counter.count += 1;
    counter.lastSeenAt = now;
  }

  return null;
}

export function resetApiProtectionForTests() {
  counters.clear();
  lastCleanupAt = 0;
}
