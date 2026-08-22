import { NextRequest } from "next/server";
import { getBaseSingleTokenInfo } from "@/lib/alchemyTokens";
import { protectBaseApi } from "@/lib/apiProtection";
import { errorJson, publicJson } from "@/lib/apiResponses";
import { validateEvmAddress } from "@/lib/apiValidation";

export async function GET(req: NextRequest) {
  const denied = await protectBaseApi(req, "token-info");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const input = validateEvmAddress(searchParams.get("address"));
  if (!input.ok) return errorJson(input.error, 400);
  const address = input.value;

  try {
    const info = await getBaseSingleTokenInfo(address);

    if (!info) {
      return errorJson("Token not found on Base or metadata unavailable", 404);
    }

    return publicJson(info, 180);
  } catch (err: unknown) {
    console.error("Error in Base single token info", err);
    return errorJson("Failed to fetch Base token info", 500);
  }
}
