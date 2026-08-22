import { isAddress } from "viem";
import { isValidName } from "ethers";

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateEvmAddress(
  input: string | null,
  label = "Address"
): ValidationResult {
  if (!input) return { ok: false, error: `Missing ${label.toLowerCase()} query param` };

  const value = input.trim();
  if (value.length !== 42 || !isAddress(value)) {
    return { ok: false, error: `${label} must be a valid EVM address` };
  }

  return { ok: true, value };
}

export function validateWalletAddressOrName(
  input: string | null
): ValidationResult {
  if (!input) return { ok: false, error: "Missing address query param" };

  const value = input.trim();
  if (value.length === 0 || value.length > 255) {
    return { ok: false, error: "Wallet address or name is invalid" };
  }

  if (isAddress(value)) return { ok: true, value };

  const lower = value.toLowerCase();
  const supportedSuffix = lower.endsWith(".eth") || lower.endsWith(".base.eth");
  if (!supportedSuffix || !isValidName(value)) {
    return {
      ok: false,
      error: "Enter a valid EVM address, .eth name, or .base.eth name",
    };
  }

  return { ok: true, value };
}
