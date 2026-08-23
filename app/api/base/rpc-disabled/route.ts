import { NextRequest, NextResponse } from "next/server";
import { protectBaseApi } from "@/lib/apiProtection";

export async function POST(request: NextRequest) {
  const denied = protectBaseApi(request, "rpc-disabled");
  if (denied) return denied;

  let id: string | number | null = null;
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (!Number.isFinite(contentLength) || contentLength > 4_096) {
      return NextResponse.json(
        { error: "RPC request is too large." },
        { status: 413, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 4_096) {
      return NextResponse.json(
        { error: "RPC request is too large." },
        { status: 413, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const body = JSON.parse(rawBody) as { id?: unknown };
    if (typeof body.id === "string" || typeof body.id === "number") {
      id = body.id;
    }
  } catch {
    // This endpoint deliberately never forwards or interprets RPC parameters.
  }

  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: "Direct browser Base RPC is disabled.",
      },
    },
    {
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
