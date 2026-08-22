# Base Guardian

Base Guardian is a Base wallet health and security mini app for checking wallet activity, token risk hints, NFT collection signals, and approval cleanup links.

**Live app:** https://baseguardian.rakibhq.xyz

---

## Overview

Base Guardian is built for three core flows:

- **Wallet overview:** Analyze a Base wallet address or supported name and show recent activity, lifetime activity, estimated gas usage, and a simple wallet health score.
- **Asset scanning:** Check Base ERC-20 token market signals and Base NFT collection metadata before interacting with a contract.
- **Security helper:** Generate a direct revoke.cash link for a Base wallet so users can review and clean up risky token or NFT approvals.

The app is designed as both a regular web app and a Farcaster/Base mini app. It focuses on quick, readable onchain summaries rather than financial recommendations. All scores and labels are heuristic hints only.

## Features

- Base wallet activity summary with **30-day** and **lifetime** transaction counts
- Estimated Base gas usage using transaction receipt data
- Wallet health score with human-readable reasons
- Onchain resume snapshot with activity tier, active days, average transactions per active day, and activity focus
- Support for direct wallet addresses and `.base.eth` / `.eth` name resolution in the wallet API
- ERC-20 token scanner for Base token contracts
- Token market data from DexScreener, including price, liquidity, market cap or FDV, 24h volume, pool age, and DEX pair link
- Token health labels based on liquidity, volume, market size, FDV/liquidity ratio, pool age, and price availability
- NFT collection scanner for Base NFT contracts
- NFT metadata and transfer-derived hints such as token standard, total supply, estimated holders, sample token ID, and collection health label
- Approval checker that opens revoke.cash directly on the Base network
- Injected browser-wallet and WalletConnect support with Base mainnet network handling
- ERC-8021 Builder Code attribution, automatically applied to future Wagmi transactions
- Connected-wallet address autofill with independent manual overrides in wallet checks
- Cloudflare edge protection with a dependency-free per-instance API rate-limit fallback
- Farcaster/Base mini app metadata with app verification, splash assets, and embed image
- Mobile-first dark UI built with reusable cards, tabs, badges, and Tailwind utility classes

## Supported network

- Base mainnet

## App behavior

### Wallet overview

- Users paste a Base wallet address in the **Overview** tab.
- The wallet API resolves plain `0x` addresses and supported `.base.eth` / `.eth` names.
- Base activity is fetched through Alchemy RPC using `alchemy_getAssetTransfers`.
- Outgoing transaction receipts are read to estimate gas usage from `gasUsed * gasPrice`.
- The UI displays 30-day stats, lifetime stats, wallet health, and an onchain resume snapshot.

### Token scanner

- Users paste a Base ERC-20 contract address in the **Scanner** tab.
- The token API fetches Base pair data from DexScreener.
- The app picks the strongest available pair by liquidity.
- Health labels are calculated from liquidity, 24h volume, FDV/liquidity ratio, market size, pool age, and price availability.
- If available, Alchemy token metadata is used for logo and decimals.

### NFT scanner

- Users paste a Base NFT contract address in the **Scanner** tab.
- The NFT API reads basic collection metadata with ERC-style calls such as `name()`, `symbol()`, and `totalSupply()`.
- Recent ERC-721 and ERC-1155 transfers are scanned through Alchemy to infer token standard, sample token ID, and estimated holder count.
- NFT health labels are based on simple supply and holder-distribution heuristics.

### Security helper

- Users paste a Base wallet address in the **Security** tab.
- The app generates a Base-specific revoke.cash URL.
- Approval review happens on revoke.cash; Base Guardian does not request private keys, seed phrases, or wallet signatures.

## Tech stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Farcaster Mini App SDK
- Wagmi, Viem, and WalletConnect
- Cloudflare WAF and rate limiting
- ethers
- Alchemy RPC and token APIs
- DexScreener token API
- revoke.cash approval review links

## Environment setup

Copy `.env.example` to `.env.local` and configure these values:

```bash
ALCHEMY_BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/your_alchemy_api_key
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_reown_project_id
NEXT_PUBLIC_BASE_BUILDER_CODE=your_base_dev_builder_code
```

The WalletConnect Project ID is required. Get the public Builder Code from
**base.dev > Settings > Builder Code**. When it is configured, the Wagmi client
automatically adds its ERC-8021 attribution suffix to future transactions; no
transaction UI is enabled by this setting alone.

`ALCHEMY_BASE_RPC_URL` is the recommended Alchemy setting. For compatibility,
the older `ALCHEMY_BASE_API_KEY` variable accepts either a raw API key or the
complete Base Mainnet RPC URL.

API abuse protection uses the existing
Cloudflare proxy at the edge and a dependency-free per-instance fallback in the
application. See [`docs/CLOUDFLARE.md`](./docs/CLOUDFLARE.md) for the dashboard
settings.

Run the verification suite with:

```bash
npm test
npm run lint
npm run build
```

---

## License

This project is licensed under the [MIT License](./LICENSE).
