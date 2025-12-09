"use client";

import { useState } from "react";
import { Card } from "@/components/shared/Card";

export function SecurityTab() {
  const [approvalAddress, setApprovalAddress] = useState("");

  const trimmed = approvalAddress.trim();
  const revokeUrl = trimmed
    ? `https://revoke.cash/address/${encodeURIComponent(
      trimmed
    )}?chain=base`
    : "https://revoke.cash/?chain=base";

  return (
    <div className="flex flex-col gap-3">
      {/* Approval checker helper */}
      <Card
        title="Approval checker"
        description="Quick helper to review and clean up token & NFT approvals."
      >
        <div className="space-y-3 text-[11px]">
          <p className="text-neutral-400">
            Paste a Base wallet address and we&apos;ll generate a direct link
            to revoke.cash. There you can see all token &amp; NFT approvals on
            Base and revoke anything suspicious.
          </p>

          <div className="flex gap-2">
            <input
              placeholder="0x... (Base wallet address)"
              className="flex-1 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-500"
              value={approvalAddress}
              onChange={(e) => setApprovalAddress(e.target.value)}
            />
            <a
              href={revokeUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-900 disabled:cursor-not-allowed"
            >
              Open revoke.cash
            </a>
          </div>

          <p className="text-[11px] text-neutral-500">
            On revoke.cash, make sure the Base network is selected. Focus
            first on approvals that:
          </p>
          <ul className="space-y-1 text-[11px] text-neutral-500">
            <li>• Grant unlimited spend of major tokens (USDC, WETH, etc).</li>
            <li>• Use unknown / unlabeled spender contracts.</li>
            <li>• Come from old dapps you no longer use.</li>
          </ul>
        </div>
      </Card>

      {/* Risk guard copy */}
      <Card
        title="Risk guard"
        description="High-level safety guidelines for onchain activity."
      >
        <ul className="space-y-1 text-[11px] text-neutral-400">
          <li>• Scores and labels are heuristics, not financial advice.</li>
          <li>• Prefer long-term safety over short-term yield.</li>
          <li>
            • Always double-check contracts and spenders before confirming.
          </li>
        </ul>
      </Card>
    </div>
  );
}
