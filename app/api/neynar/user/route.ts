// app/api/neynar/user/route.ts
import { NextRequest, NextResponse } from "next/server";

type NeynarUserClient = {
  fid: number;
  username: string;
  displayName: string | null;
  followers: number | null;
  following: number | null;
  neynarScore: number | null; // 0–1
};

const DEFAULT_PROFILE_QUERY = "532764"; // your FID

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawQuery = (searchParams.get("query") || "").trim();

  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "NEYNAR_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  // If nothing given, fall back to your own FID
  const queryForLookup = rawQuery || DEFAULT_PROFILE_QUERY;
  const parsed = resolveProfileQuery(queryForLookup);

  try {
    const user = await fetchNeynarUser(parsed, apiKey);
    if (!user) {
      return NextResponse.json(
        { error: "Neynar user not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(user);
  } catch (err: any) {
    console.error("Error fetching Neynar user:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed Neynar user lookup",
      },
      { status: 500 }
    );
  }
}

/**
 * Accepts:
 *  - "532764"                       => fid
 *  - "0xmdrakib" / "@0xmdrakib"     => username
 *  - "0xmdrakib.base.eth"           => username "0xmdrakib"
 *  - "0xmdrakib.farcaster.eth"      => username "0xmdrakib"
 */
function resolveProfileQuery(
  raw: string
): { fid?: string; username?: string } {
  let q = raw.trim();

  // strip known suffixes (.base.eth / .farcaster.eth)
  const lower = q.toLowerCase();
  if (lower.endsWith(".base.eth")) {
    q = q.slice(0, -".base.eth".length);
  } else if (lower.endsWith(".farcaster.eth")) {
    q = q.slice(0, -".farcaster.eth".length);
  }

  // strip leading @
  if (q.startsWith("@")) {
    q = q.slice(1);
  }

  // pure digits => FID
  if (/^[0-9]+$/.test(q)) {
    return { fid: q };
  }

  // otherwise treat as username / handle
  return { username: q.toLowerCase() };
}

async function fetchNeynarUser(
  input: { fid?: string; username?: string },
  apiKey: string
): Promise<NeynarUserClient | null> {
  const baseUrl = "https://api.neynar.com/v2/farcaster";

  // -------- FID path ----------
  if (input.fid) {
    const res = await fetch(`${baseUrl}/user?fid=${input.fid}`, {
      headers: {
        accept: "application/json",
        api_key: apiKey,
      },
    });

    const json: any = await res.json().catch(() => null);

    if (!res.ok) {
      console.error("Neynar FID lookup failed:", res.status, json);
      if (json?.message) throw new Error(json.message);
      return null;
    }

    const user = json?.result?.user ?? json?.user;
    if (!user) return null;

    return mapNeynarUser(user);
  }

  // -------- username / handle path ----------
  if (input.username) {
    // First try by-username endpoint
    let res = await fetch(
      `${baseUrl}/user/by-username?username=${encodeURIComponent(
        input.username
      )}`,
      {
        headers: {
          accept: "application/json",
          api_key: apiKey,
        },
      }
    );

    let json: any = await res.json().catch(() => null);

    if (res.ok) {
      const user = json?.result?.user ?? json?.user;
      if (user) return mapNeynarUser(user);
    }

    // Fallback: search endpoint
    res = await fetch(
      `${baseUrl}/user/search?q=${encodeURIComponent(
        input.username
      )}&limit=1`,
      {
        headers: {
          accept: "application/json",
          api_key: apiKey,
        },
      }
    );

    json = await res.json().catch(() => null);

    if (!res.ok) {
      console.error("Neynar username search failed:", res.status, json);
      if (json?.message) throw new Error(json.message);
      return null;
    }

    const user = json?.result?.users?.[0];
    if (!user) return null;

    return mapNeynarUser(user);
  }

  throw new Error("Missing fid or username in lookup");
}

function mapNeynarUser(raw: any): NeynarUserClient {
  const scoreRaw =
    raw?.neynar_user?.score?.v1 ??
    raw?.neynar_user?.influence?.score ??
    raw?.neynar_user?.score ??
    null;

  return {
    fid: raw?.fid,
    username: raw?.username,
    displayName: raw?.display_name ?? null,
    followers: raw?.follower_count ?? null,
    following: raw?.following_count ?? null,
    neynarScore: typeof scoreRaw === "number" ? scoreRaw : null,
  };
}
