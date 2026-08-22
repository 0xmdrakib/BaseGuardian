export function matchesConnectedWallet(value: string, address?: string) {
  return Boolean(
    address && value.trim().toLowerCase() === address.toLowerCase()
  );
}
