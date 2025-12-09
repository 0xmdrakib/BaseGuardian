import { NextRequest, NextResponse } from "next/server";
import { getBaseSingleTokenInfo } from "@/lib/alchemyTokens";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Missing address query param" },
      { status: 400 }
    );
  }

  if (!address.startsWith("0x") || address.length < 10) {
    return NextResponse.json(
      { error: "Address must be a valid 0x-prefixed string" },
      { status: 400 }
    );
  }

  try {
    const info = await getBaseSingleTokenInfo(address);

    if (!info) {
      return NextResponse.json(
        { error: "Token not found on Base or metadata unavailable" },
        { status: 404 }
      );
    }

    return NextResponse.json(info);
  } catch (err: any) {
    console.error("Error in Base single token info", err);
    return NextResponse.json(
      {
        error: "Failed to fetch Base token info",
        debug: err instanceof Error ? err.message : String(err ?? ""),
      },
      { status: 500 }
    );
  }
}
