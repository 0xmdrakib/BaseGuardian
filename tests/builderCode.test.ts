import { describe, expect, it } from "vitest";

import { getBuilderCodeDataSuffix } from "../lib/builderCode";

describe("Builder Code attribution", () => {
  it("stays disabled when no Builder Code is configured", () => {
    expect(getBuilderCodeDataSuffix("  ")).toBeUndefined();
  });

  it("encodes a Builder Code as an ERC-8021 data suffix", () => {
    expect(getBuilderCodeDataSuffix("bc_test123")).toBe(
      "0x62635f746573743132330a0080218021802180218021802180218021"
    );
  });
});
