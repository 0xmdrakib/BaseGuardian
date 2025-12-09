import { NextRequest, NextResponse } from "next/server";
import {
  getBaseTokenPortfolio,
  BaseTokenSummary,
} from "@/lib/alchemyTokens";

type TokenScanResponse = {
  address: string;
  chain: "base-mainnet";
  tokens: BaseTokenSummary[];
};

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
    const tokens = await getBaseTokenPortfolio(address);

    const payload: TokenScanResponse = {
      address,
      chain: "base-mainnet",
      tokens,
    };

    return NextResponse.json(payload);
  } catch (err: any) {
    console.error("Error in Base token scan", err);
    return NextResponse.json(
      {
        error: "Failed to scan Base tokens",
        debug:
          err instanceof Error ? err.message : String(err ?? ""),
      },
      { status: 500 }
    );
  }
}
