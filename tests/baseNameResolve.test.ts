import { describe, expect, it, vi } from "vitest";
import {
  BaseNameResolutionError,
  resolveBasenameOnBase,
  resolveBaseAddressOrName,
} from "../lib/baseNameResolve";
import { namehash, toCoinType } from "viem";
import { base } from "viem/chains";

const address = "0x1111111111111111111111111111111111111111" as const;

describe("Base wallet name resolution", () => {
  it("resolves Basenames through the Base registry and configured resolver", async () => {
    const resolver = "0x2222222222222222222222222222222222222222";
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(resolver)
      .mockResolvedValueOnce(address);

    await expect(
      resolveBasenameOnBase("alice.base.eth", { readContract })
    ).resolves.toBe(address);
    expect(readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        address: "0xB94704422c2a1E396835A571837Aa5AE53285a95",
        functionName: "resolver",
        args: [namehash("alice.base.eth")],
      })
    );
    expect(readContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        address: resolver,
        functionName: "addr",
        args: [namehash("alice.base.eth"), toCoinType(base.id)],
      })
    );
  });

  it("falls back to the default EVM record when no Base coin record exists", async () => {
    const resolver = "0x2222222222222222222222222222222222222222";
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(resolver)
      .mockResolvedValueOnce("0x")
      .mockResolvedValueOnce(address);

    await expect(
      resolveBasenameOnBase("alice.base.eth", { readContract })
    ).resolves.toBe(address);
    expect(readContract).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        address: resolver,
        functionName: "addr",
        args: [namehash("alice.base.eth")],
      })
    );
  });

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
