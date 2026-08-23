import { describe, expect, it } from "vitest";
import {
  areAllApprovalIdsSelected,
  canRevokeSelectedApprovals,
  getAtomicCapabilityStatus,
  pruneSelectedApprovalIds,
  toggleAllApprovalIds,
} from "../lib/approvalSelection";

describe("approval selection", () => {
  const ids = ["approval-a", "approval-b", "approval-c"];

  it("selects every available approval from a partial selection", () => {
    const selected = toggleAllApprovalIds(ids, new Set(["approval-a"]));
    expect([...selected]).toEqual(ids);
    expect(areAllApprovalIdsSelected(ids, selected)).toBe(true);
  });

  it("unselects every available approval when all are selected", () => {
    const selected = toggleAllApprovalIds(ids, new Set(ids));
    expect([...selected]).toEqual([]);
    expect(areAllApprovalIdsSelected(ids, selected)).toBe(false);
  });

  it("does not remove unrelated state while toggling available approvals", () => {
    const selected = toggleAllApprovalIds(ids, new Set([...ids, "other"]));
    expect([...selected]).toEqual(["other"]);
  });

  it("allows one selected revoke without atomic batch support", () => {
    expect(
      canRevokeSelectedApprovals({
        batchSupported: false,
        busy: false,
        canManageApprovals: true,
        selectedCount: 1,
      })
    ).toBe(true);
  });

  it("requires atomic support only when multiple approvals are selected", () => {
    expect(
      canRevokeSelectedApprovals({
        batchSupported: false,
        busy: false,
        canManageApprovals: true,
        selectedCount: 2,
      })
    ).toBe(false);
    expect(
      canRevokeSelectedApprovals({
        batchSupported: true,
        busy: false,
        canManageApprovals: true,
        selectedCount: 2,
      })
    ).toBe(true);
  });

  it("disables revoke after the account or network stops matching", () => {
    expect(
      canRevokeSelectedApprovals({
        batchSupported: true,
        busy: false,
        canManageApprovals: false,
        selectedCount: 1,
      })
    ).toBe(false);
  });

  it("prunes only approvals confirmed as revoked", () => {
    const selected = pruneSelectedApprovalIds(
      new Set(["approval-a", "approval-b", "approval-c"]),
      ["approval-a", "approval-c"]
    );
    expect([...selected]).toEqual(["approval-b"]);
  });

  it("accepts the standardized EIP-5792 atomic capability status", () => {
    expect(getAtomicCapabilityStatus({ status: "ready" })).toBe("ready");
    expect(getAtomicCapabilityStatus({ status: "supported" })).toBe(
      "supported"
    );
    expect(getAtomicCapabilityStatus({ status: "unsupported" })).toBe(
      "unsupported"
    );
    expect(getAtomicCapabilityStatus({ supported: true })).toBeUndefined();
  });
});
