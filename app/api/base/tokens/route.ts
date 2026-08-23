import { NextRequest } from "next/server";
import {
  getBaseTokenPortfolio,
  BaseTokenSummary,
} from "@/lib/alchemyTokens";
import { protectBaseApi } from "@/lib/apiProtection";
import { errorJson, publicJson } from "@/lib/apiResponses";
import { validateEvmAddress } from "@/lib/apiValidation";
import { safeServerError } from "@/lib/safeServerError";

type TokenScanResponse = {
  address: string;
  chain: "base-mainnet";
  tokens: BaseTokenSummary[];
};

export async function GET(req: NextRequest) {
  const denied = await protectBaseApi(req, "tokens");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const input = validateEvmAddress(searchParams.get("address"));
  if (!input.ok) return errorJson(input.error, 400);
  const address = input.value;

  try {
    const tokens = await getBaseTokenPortfolio(address);

    const payload: TokenScanResponse = {
      address,
      chain: "base-mainnet",
      tokens,
    };

    return publicJson(payload, 120);
  } catch (err: unknown) {
    console.error("Error in Base token scan", safeServerError(err));
    return errorJson("Failed to scan Base tokens", 500);
  }
}
