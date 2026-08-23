import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  encodeFunctionData,
  encodeFunctionResult,
  maxUint256,
  pad,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  APPROVAL_FOR_ALL_TOPIC,
  APPROVAL_TOPIC,
  PERMIT2_ADDRESS,
  decodeApprovalLog,
  fetchApprovalLogsFromAlchemyHistory,
  fetchApprovalLogsFromAlchemyTransfers,
  isEip7702DelegationCode,
  fetchApprovalLogsAdaptive,
  reduceApprovalCandidates,
  verifyApprovalCandidates,
  type ApprovalCandidate,
} from "../lib/baseApprovals";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const delegate = "0x2222222222222222222222222222222222222222" as Address;
const token = "0x3333333333333333333333333333333333333333" as Address;
const txHash = `0x${"ab".repeat(32)}` as Hex;

function topic(address: Address) {
  return pad(address, { size: 32 });
}

function log(overrides: Record<string, unknown> = {}) {
  return {
    address: token,
    blockNumber: toHex(10),
    data: toHex(25n, { size: 32 }),
    logIndex: toHex(1),
    removed: false,
    topics: [APPROVAL_TOPIC, topic(owner), topic(delegate)],
    transactionHash: txHash,
    ...overrides,
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("approval log decoding", () => {
  it("decodes standard ERC-20, ERC-721, and operator approvals", () => {
    const erc20 = decodeApprovalLog(log());
    const erc721 = decodeApprovalLog(
      log({
        data: "0x",
        topics: [
          APPROVAL_TOPIC,
          topic(owner),
          topic(delegate),
          toHex(42n, { size: 32 }),
        ],
      })
    );
    const operator = decodeApprovalLog(
      log({
        data: toHex(1n, { size: 32 }),
        topics: [APPROVAL_FOR_ALL_TOPIC, topic(owner), topic(delegate)],
      })
    );

    expect(erc20).toMatchObject({ kind: "erc20", eventValue: 25n });
    expect(erc721).toMatchObject({ kind: "erc721-token", tokenId: 42n });
    expect(operator).toMatchObject({ kind: "nft-operator", eventValue: true });
  });

  it("keeps only the latest active state for a permission", () => {
    const active = log({ blockNumber: toHex(10), data: toHex(25n, { size: 32 }) });
    const revoked = log({ blockNumber: toHex(11), data: toHex(0n, { size: 32 }) });
    expect(reduceApprovalCandidates([active, revoked])).toEqual([]);
    expect(reduceApprovalCandidates([revoked, active])).toEqual([]);
  });

  it("treats an ERC-721 token approval as one state across delegate changes", () => {
    const otherDelegate =
      "0x4444444444444444444444444444444444444444" as Address;
    const approvedA = log({
      blockNumber: toHex(10),
      topics: [
        APPROVAL_TOPIC,
        topic(owner),
        topic(delegate),
        toHex(42n, { size: 32 }),
      ],
    });
    const approvedB = log({
      blockNumber: toHex(11),
      topics: [
        APPROVAL_TOPIC,
        topic(owner),
        topic(otherDelegate),
        toHex(42n, { size: 32 }),
      ],
    });
    const cleared = log({
      blockNumber: toHex(12),
      topics: [
        APPROVAL_TOPIC,
        topic(owner),
        topic("0x0000000000000000000000000000000000000000"),
        toHex(42n, { size: 32 }),
      ],
    });

    expect(reduceApprovalCandidates([approvedA, approvedB])).toMatchObject([
      { delegateAddress: otherDelegate, tokenId: 42n },
    ]);
    expect(reduceApprovalCandidates([approvedA, approvedB, cleared])).toEqual(
      []
    );
  });
});

describe("adaptive approval history", () => {
  it("recognizes only an exact EIP-7702 delegation indicator", () => {
    expect(
      isEip7702DelegationCode(
        "0xef01007702cb554e6bfb442cb743a7df23154544a7176c"
      )
    ).toBe(true);
    expect(isEip7702DelegationCode("0x")).toBe(false);
    expect(
      isEip7702DelegationCode(
        "0x60007702cb554e6bfb442cb743a7df23154544a7176c"
      )
    ).toBe(false);
  });

  it("discovers zero-value approval calls through transfers and receipts", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body));
      if (calls === 1) {
        expect(body.method).toBe("alchemy_getAssetTransfers");
        expect(body.params[0]).toMatchObject({
          category: ["external"],
          fromAddress: owner,
          excludeZeroValue: false,
          maxCount: "0x3e8",
          order: "desc",
        });
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              transfers: [{ hash: txHash, blockNum: "0xa" }],
            },
          })
        );
      }

      expect(Array.isArray(body)).toBe(true);
      expect(body[0].method).toBe("eth_getTransactionReceipt");
      return new Response(
        JSON.stringify([
          {
            jsonrpc: "2.0",
            id: body[0].id,
            result: { logs: [log()] },
          },
        ])
      );
    });

    const result = await fetchApprovalLogsFromAlchemyTransfers(
      "https://example.invalid",
      owner,
      100,
      { deadlineMs: 5_000, requestTimeoutMs: 1_000 }
    );

    expect(result).toMatchObject({ complete: true, pages: 1, receipts: 1 });
    expect(result.logs).toHaveLength(1);
  });

  it("keeps approval receipts older than the former 250-transaction cap", async () => {
    vi.useFakeTimers();
    const transfers = Array.from({ length: 363 }, (_, index) => ({
      hash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      blockNum: toHex(1_000 - index),
    }));

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (!Array.isArray(body)) {
        expect(body.params[0].category).toEqual(["external"]);
        expect(body.params[0].maxCount).toBe("0x3e8");
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { transfers },
          })
        );
      }

      return new Response(
        JSON.stringify(
          body.map((request: { id: number; params: [Hex] }) => ({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              logs:
                request.id === 301
                  ? [
                      log({
                        blockNumber: toHex(700),
                        transactionHash: request.params[0],
                      }),
                    ]
                  : [],
            },
          }))
        )
      );
    });

    const pending = fetchApprovalLogsFromAlchemyTransfers(
      "https://example.invalid",
      owner,
      1_000,
      { deadlineMs: 10_000, requestTimeoutMs: 1_000 }
    );
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result).toMatchObject({ complete: true, pages: 1, receipts: 363 });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].transactionHash).toBe(transfers[300].hash);
  });

  it("uses contract activity categories for smart-account owners", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.params[0].category).toEqual([
        "internal",
        "erc20",
        "erc721",
        "erc1155",
      ]);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { transfers: [] },
        })
      );
    });

    const result = await fetchApprovalLogsFromAlchemyTransfers(
      "https://example.invalid",
      owner,
      100,
      {
        deadlineMs: 5_000,
        ownerIsContract: true,
        requestTimeoutMs: 1_000,
      }
    );
    expect(result).toMatchObject({ complete: true, pages: 1, receipts: 0 });
  });

  it("keeps delegated EOAs on the external-only fast path", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.params[0].category).toEqual(["external"]);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { transfers: [] },
        })
      );
    });

    const result = await fetchApprovalLogsFromAlchemyTransfers(
      "https://example.invalid",
      owner,
      100,
      {
        deadlineMs: 5_000,
        requestTimeoutMs: 1_000,
      }
    );
    expect(result).toMatchObject({ complete: true, pages: 1, receipts: 0 });
  });

  it("stops receipt batches at the shared deadline and reports partial", async () => {
    vi.useFakeTimers();
    const transfers = Array.from({ length: 1_000 }, (_, index) => ({
      hash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      blockNum: toHex(1_000 - index),
    }));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (!Array.isArray(body)) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: { transfers, pageKey: "more" },
            })
          );
        }
        return new Response(
          JSON.stringify(
            body.map((request: { id: number }) => ({
              jsonrpc: "2.0",
              id: request.id,
              result: { logs: [] },
            }))
          )
        );
      });

    const pending = fetchApprovalLogsFromAlchemyTransfers(
      "https://example.invalid",
      owner,
      1_000,
      { deadlineMs: 1_000, requestTimeoutMs: 100 }
    );
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.complete).toBe(false);
    expect(result.pages).toBe(1);
    expect(result.receipts).toBe(1_000);
    expect(fetchMock.mock.calls.length).toBeLessThan(10);
  });

  it("paginates Alchemy wallet history and extracts only owner approval logs", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body));
      expect(body.addresses).toEqual([
        { address: owner, networks: ["base-mainnet"] },
      ]);
      if (calls === 1) {
        expect(body.after).toBeUndefined();
        return new Response(
          JSON.stringify({
            after: "next-page",
            transactions: [
              {
                hash: txHash,
                blockNumber: 10,
                logs: [
                  {
                    contractAddress: token,
                    logIndex: 1,
                    data: toHex(25n, { size: 32 }),
                    topics: [APPROVAL_TOPIC, topic(owner), topic(delegate)],
                  },
                  {
                    contractAddress: token,
                    logIndex: 2,
                    data: toHex(25n, { size: 32 }),
                    topics: [
                      APPROVAL_TOPIC,
                      topic(delegate),
                      topic(owner),
                    ],
                  },
                ],
              },
            ],
          })
        );
      }
      expect(body.after).toBe("next-page");
      return new Response(
        JSON.stringify({
          transactions: [
            {
              hash: `0x${"cd".repeat(32)}`,
              blockNumber: 11,
              logs: [
                {
                  contractAddress: token,
                  logIndex: "0x0",
                  data: toHex(1n, { size: 32 }),
                  topics: [
                    APPROVAL_FOR_ALL_TOPIC,
                    topic(owner),
                    topic(delegate),
                  ],
                },
              ],
            },
          ],
        })
      );
    });

    const result = await fetchApprovalLogsFromAlchemyHistory(
      "https://example.invalid/history",
      owner,
      100,
      { deadlineMs: 5_000, requestTimeoutMs: 1_000 }
    );

    expect(result.complete).toBe(true);
    expect(result.pages).toBe(2);
    expect(result.logs).toHaveLength(2);
  });

  it("marks wallet history partial when pagination cannot finish", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ after: "more", transactions: [] }))
    );
    const result = await fetchApprovalLogsFromAlchemyHistory(
      "https://example.invalid/history",
      owner,
      100,
      { deadlineMs: 5_000, requestTimeoutMs: 1_000, maxPages: 1 }
    );
    expect(result.complete).toBe(false);
    expect(result.pages).toBe(1);
  });

  it("preserves earlier history logs when a later page stays throttled", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            after: "next-page",
            transactions: [
              {
                hash: txHash,
                blockNumber: 10,
                logs: [
                  {
                    contractAddress: token,
                    logIndex: 1,
                    data: toHex(25n, { size: 32 }),
                    topics: [APPROVAL_TOPIC, topic(owner), topic(delegate)],
                  },
                ],
              },
            ],
          })
        );
      }
      return new Response("busy", { status: 429 });
    });

    const pending = fetchApprovalLogsFromAlchemyHistory(
      "https://example.invalid/history",
      owner,
      100,
      { deadlineMs: 5_000, requestTimeoutMs: 1_000 }
    );
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.complete).toBe(false);
    expect(result.pages).toBe(1);
    expect(result.logs).toHaveLength(1);
    expect(calls).toBe(4);
  });

  it("retries a throttled first history page", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("busy", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return new Response(JSON.stringify({ transactions: [] }));
    });

    const pending = fetchApprovalLogsFromAlchemyHistory(
      "https://example.invalid/history",
      owner,
      100,
      { deadlineMs: 5_000, requestTimeoutMs: 1_000 }
    );
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.complete).toBe(true);
    expect(result.pages).toBe(1);
    expect(calls).toBe(2);
  });

  it("does not claim complete when history totalCount is truncated", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      return calls === 1
        ? new Response(
            JSON.stringify({
              totalCount: 2,
              after: "next-page",
              transactions: [{ hash: txHash, blockNumber: 10, logs: [] }],
            })
          )
        : new Response(JSON.stringify({ transactions: [] }));
    });

    const result = await fetchApprovalLogsFromAlchemyHistory(
      "https://example.invalid/history",
      owner,
      100,
      { deadlineMs: 5_000, requestTimeoutMs: 1_000 }
    );

    expect(result.complete).toBe(false);
    expect(result.pages).toBe(2);
  });

  it("splits a range when the provider response reaches the log cap", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body));
      const filter = body.params[0];
      const from = Number(BigInt(filter.fromBlock));
      const result =
        calls === 1
          ? Array.from({ length: 10_000 }, () => log())
          : [
              log({
                blockNumber: toHex(from),
                logIndex: toHex(from),
                transactionHash: `0x${from.toString(16).padStart(64, "0")}`,
              }),
            ];
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    });

    const result = await fetchApprovalLogsAdaptive(
      "https://example.invalid",
      owner,
      100,
      { deadlineMs: 5_000, maxLogRequests: 10, requestTimeoutMs: 1_000 }
    );

    expect(result.complete).toBe(true);
    expect(result.requests).toBe(3);
    expect(result.logs).toHaveLength(2);
  });

  it("returns partial coverage when its request budget is exhausted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32000, message: "range too large" },
        })
      )
    );

    const result = await fetchApprovalLogsAdaptive(
      "https://example.invalid",
      owner,
      100_000,
      { deadlineMs: 5_000, maxLogRequests: 1, requestTimeoutMs: 1_000 }
    );
    expect(result.complete).toBe(false);
    expect(result.requests).toBe(1);
  });

  it("retries a throttled range without recursively splitting it", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("rate limited", { status: 429 }));

    const pending = fetchApprovalLogsAdaptive(
      "https://example.invalid",
      owner,
      100_000,
      { deadlineMs: 5_000, maxLogRequests: 64, requestTimeoutMs: 1_000 }
    );
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.complete).toBe(false);
    expect(result.requests).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const ranges = fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body));
      return body.params[0];
    });
    expect(new Set(ranges.map((range) => JSON.stringify(range))).size).toBe(1);
  });
});

describe("current approval verification", () => {
  const abi = parseAbi([
    "function allowance(address owner, address spender) view returns (uint256)",
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ]);
  const selectors = {
    allowance: encodeFunctionData({
      abi,
      functionName: "allowance",
      args: [owner, PERMIT2_ADDRESS],
    }).slice(0, 10),
    name: encodeFunctionData({ abi, functionName: "name" }),
    symbol: encodeFunctionData({ abi, functionName: "symbol" }),
    decimals: encodeFunctionData({ abi, functionName: "decimals" }),
  };
  const multicallAbi = parseAbi([
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  ]);

  function candidate(): ApprovalCandidate {
    return {
      id: `erc20:${token.toLowerCase()}:${PERMIT2_ADDRESS.toLowerCase()}`,
      kind: "erc20",
      tokenAddress: token,
      delegateAddress: PERMIT2_ADDRESS,
      tokenId: null,
      eventValue: maxUint256,
      blockNumber: 10,
      logIndex: 1,
      transactionHash: txHash,
    };
  }

  function mockBatchAllowance(value: bigint | null, decimals = 6) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (!Array.isArray(body)) {
        const decoded = decodeFunctionData({
          abi: multicallAbi,
          data: body.params[0].data,
        });
        const calls = decoded.args[0];
        const results = calls.map((call) => {
          const data = call.callData;
          if (data.startsWith(selectors.allowance)) {
            return value === null
              ? { success: false, returnData: "0x" as Hex }
              : {
                  success: true,
                  returnData: encodeFunctionResult({
                    abi,
                    functionName: "allowance",
                    result: value,
                  }),
                };
          }
          if (data === selectors.name) {
            return {
              success: true,
              returnData: encodeFunctionResult({
                abi,
                functionName: "name",
                result: "USD Coin",
              }),
            };
          }
          if (data === selectors.symbol) {
            return {
              success: true,
              returnData: encodeFunctionResult({
                abi,
                functionName: "symbol",
                result: "USDC",
              }),
            };
          }
          return {
            success: true,
            returnData: encodeFunctionResult({
              abi,
              functionName: "decimals",
              result: decimals,
            }),
          };
        });
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: encodeFunctionResult({
              abi: multicallAbi,
              functionName: "aggregate3",
              result: results,
            }),
          })
        );
      }

      const requests = body as Array<{
        id: number;
        method: string;
        params: any[];
      }>;
      const responses = requests.flatMap((request) => {
        if (request.method === "eth_getCode") {
          return [{ jsonrpc: "2.0", id: request.id, result: "0x1234" }];
        }
        const data = request.params[0].data as string;
        if (data.startsWith(selectors.allowance)) {
          return value === null
            ? []
            : [
                {
                  jsonrpc: "2.0",
                  id: request.id,
                  result: encodeFunctionResult({
                    abi,
                    functionName: "allowance",
                    result: value,
                  }),
                },
              ];
        }
        if (data === selectors.name) {
          return [
            {
              jsonrpc: "2.0",
              id: request.id,
              result: encodeFunctionResult({
                abi,
                functionName: "name",
                result: "USD Coin",
              }),
            },
          ];
        }
        if (data === selectors.symbol) {
          return [
            {
              jsonrpc: "2.0",
              id: request.id,
              result: encodeFunctionResult({
                abi,
                functionName: "symbol",
                result: "USDC",
              }),
            },
          ];
        }
        return [
          {
            jsonrpc: "2.0",
            id: request.id,
            result: encodeFunctionResult({
              abi,
              functionName: "decimals",
              result: decimals,
            }),
          },
        ];
      });
      return new Response(JSON.stringify(responses));
    });
  }

  it("marks an active unlimited Permit2 delegation", async () => {
    mockBatchAllowance(maxUint256);
    const result = await verifyApprovalCandidates(
      "https://example.invalid",
      owner,
      100,
      [candidate()]
    );
    expect(result[0]).toMatchObject({
      verification: "verified",
      exposure: "high",
      permit2: true,
      value: { unlimited: true },
      token: { name: "USD Coin", symbol: "USDC", decimals: 6 },
    });
  });

  it("filters a currently revoked allowance", async () => {
    mockBatchAllowance(0n);
    await expect(
      verifyApprovalCandidates("https://example.invalid", owner, 100, [candidate()])
    ).resolves.toEqual([]);
  });

  it("does not display a tiny active allowance as zero", async () => {
    mockBatchAllowance(783_515n, 18);
    const result = await verifyApprovalCandidates(
      "https://example.invalid",
      owner,
      100,
      [candidate()]
    );
    expect(result[0].value).toMatchObject({
      raw: "783515",
      display: "<0.000001",
    });
  });

  it("keeps an unverified candidate without calling it safe", async () => {
    mockBatchAllowance(null);
    const result = await verifyApprovalCandidates(
      "https://example.invalid",
      owner,
      100,
      [candidate()]
    );
    expect(result[0]).toMatchObject({
      verification: "unverified",
      exposure: "unknown",
    });
  });
});
