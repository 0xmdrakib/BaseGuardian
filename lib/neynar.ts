const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;

export type NeynarUser = {
  fid: number;
  username: string;
  display_name?: string;
  follower_count?: number;
  following_count?: number;
  experimental?: {
    neynar_user_score?: number;
  };
};

type BulkUsersResponse = {
  users: NeynarUser[];
};

export async function fetchNeynarUserByFid(fid: number): Promise<NeynarUser | null> {
  if (!NEYNAR_API_KEY) {
    console.error("Missing NEYNAR_API_KEY in environment");
    return null;
  }

  const url = new URL("https://api.neynar.com/v2/farcaster/user/bulk");
  url.searchParams.set("fids", String(fid));

  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": NEYNAR_API_KEY,
      "x-neynar-experimental": "true",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    console.error("Neynar API error", res.status, await res.text());
    return null;
  }

  const data = (await res.json()) as BulkUsersResponse;
  return data.users?.[0] ?? null;
}
