import { describe, expect, it, vi } from "vitest";
import {
  BaseNameResolutionError,
  resolveBaseAddressOrName,
} from "../lib/baseNameResolve";

const address = "0x1111111111111111111111111111111111111111" as const;

describe("Base wallet name resolution", () => {
  it("normalizes plain addresses without calling a name resolver", async () => {
    const resolver = vi.fn();
    await expect(resolveBaseAddressOrName(address, resolver)).resolves.toBe(
      address
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it("resolves .base.eth and .eth names through the supplied L1 resolver", async () => {
    const resolver = vi.fn(async () => address);
    await expect(
      resolveBaseAddressOrName("Alice.Base.ETH", resolver)
    ).resolves.toBe(address);
    await expect(
      resolveBaseAddressOrName("alice.eth", resolver)
    ).resolves.toBe(address);
    expect(resolver).toHaveBeenNthCalledWith(1, "alice.base.eth");
    expect(resolver).toHaveBeenNthCalledWith(2, "alice.eth");
  });

  it("returns a typed not-found error for an unresolved name", async () => {
    const error = await resolveBaseAddressOrName(
      "missing.base.eth",
      async () => null
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(BaseNameResolutionError);
    expect(error).toMatchObject({ status: 404 });
  });

  it("returns a typed validation error for unsupported names", async () => {
    const error = await resolveBaseAddressOrName(
      "alice.example",
      async () => address
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(BaseNameResolutionError);
    expect(error).toMatchObject({ status: 400 });
  });
});
