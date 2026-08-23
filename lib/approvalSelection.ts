export function areAllApprovalIdsSelected(
  availableIds: readonly string[],
  selected: ReadonlySet<string>
) {
  return (
    availableIds.length > 0 &&
    availableIds.every((approvalId) => selected.has(approvalId))
  );
}

export function toggleAllApprovalIds(
  availableIds: readonly string[],
  selected: ReadonlySet<string>
) {
  const next = new Set(selected);
  if (areAllApprovalIdsSelected(availableIds, selected)) {
    for (const approvalId of availableIds) next.delete(approvalId);
  } else {
    for (const approvalId of availableIds) next.add(approvalId);
  }
  return next;
}

export function canRevokeSelectedApprovals({
  batchSupported,
  busy,
  canManageApprovals,
  selectedCount,
}: {
  batchSupported: boolean;
  busy: boolean;
  canManageApprovals: boolean;
  selectedCount: number;
}) {
  if (busy || !canManageApprovals || selectedCount === 0) return false;
  return selectedCount === 1 || batchSupported;
}

export function getAtomicCapabilityStatus(atomic: unknown) {
  if (!atomic || typeof atomic !== "object") return undefined;
  const capability = atomic as { status?: unknown; supported?: unknown };
  const value = capability.status ?? capability.supported;
  return value === "supported" ||
    value === "ready" ||
    value === "unsupported"
    ? value
    : undefined;
}

export function pruneSelectedApprovalIds(
  selected: ReadonlySet<string>,
  removedIds: readonly string[]
) {
  const removed = new Set(removedIds);
  return new Set([...selected].filter((approvalId) => !removed.has(approvalId)));
}
