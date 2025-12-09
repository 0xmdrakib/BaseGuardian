// app/api/base/nft/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getBaseNftCollectionSummary } from "@/lib/baseNft";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contract =
    searchParams.get("contract") ?? searchParams.get("address");

  if (!contract) {
    return NextResponse.json(
      { error: "Missing contract query param" },
      { status: 400 }
    );
  }

  if (!contract.startsWith("0x") || contract.length < 10) {
    return NextResponse.json(
      { error: "Contract must be a valid 0x-prefixed address" },
      { status: 400 }
    );
  }

  try {
    const summary = await getBaseNftCollectionSummary(contract);
    return NextResponse.json(summary);
  } catch (err: any) {
    console.error("Error in Base NFT summary", err);
    return NextResponse.json(
      {
        error: "Failed to fetch NFT info from Base",
        debug: err instanceof Error ? err.message : String(err ?? ""),
      },
      { status: 500 }
    );
  }
}
