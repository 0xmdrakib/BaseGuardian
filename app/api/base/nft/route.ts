// app/api/base/nft/route.ts

import { NextRequest } from "next/server";
import { getBaseNftCollectionSummary } from "@/lib/baseNft";
import { protectBaseApi } from "@/lib/apiProtection";
import { errorJson, publicJson } from "@/lib/apiResponses";
import { validateEvmAddress } from "@/lib/apiValidation";

export async function GET(req: NextRequest) {
  const denied = await protectBaseApi(req, "nft");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const input = validateEvmAddress(
    searchParams.get("contract") ?? searchParams.get("address"),
    "Contract"
  );
  if (!input.ok) return errorJson(input.error, 400);
  const contract = input.value;

  try {
    const summary = await getBaseNftCollectionSummary(contract);
    return publicJson(summary, 180);
  } catch (err: unknown) {
    console.error("Error in Base NFT summary", err);
    return errorJson("Failed to fetch NFT info from Base", 500);
  }
}
