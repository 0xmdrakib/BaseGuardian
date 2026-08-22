import { NextResponse } from "next/server";

export function publicJson<T>(body: T, maxAgeSeconds = 120) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 2}`,
    },
  });
}

export function errorJson(error: string, status: number) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
