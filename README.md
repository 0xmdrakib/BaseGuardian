# Base Guardian

Base Guardian is a Base wallet health and security mini app for checking wallet activity, token risk hints, NFT collection signals, and approval cleanup links.

**Live app:** https://baseguardian.vercel.app

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
- Farcaster/Base mini app metadata with app verification, splash assets, embed image, and native cast sharing support
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
- ethers
- Alchemy RPC and token APIs
- DexScreener token API
- revoke.cash approval review links

---

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root. Then copy the values from [.env.example](./.env.example) and fill them in.

```bash
ALCHEMY_BASE_API_KEY=your_alchemy_base_api_key
```

The Alchemy key is required for wallet activity, token metadata, token balances, and NFT collection scans on Base.

### 3. Run the development server

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

### 4. Build for production

```bash
npm run build
npm run start
```

## Project structure

```text
app/
├── api/
│   └── base/
│       ├── nft/route.ts        # Base NFT collection scanner API
│       ├── token-info/route.ts # Single Base token scanner API
│       ├── tokens/route.ts     # Base wallet token portfolio API
│       └── wallet/route.ts     # Base wallet activity summary API
├── globals.css                 # Global styles and Tailwind utility classes
├── head.tsx                    # Additional mini app and Open Graph meta tags
├── layout.tsx                  # App metadata, Base/Farcaster mini app config, font setup
├── page.tsx                    # Main tabbed app shell
├── icon.png                    # Tab icon
└── apple-icon.png              # iPhone icon
components/
├── assets/AssetsTab.tsx        # Token and NFT scanner tab
├── layout/TabNav.tsx           # Overview / Scanner / Security navigation
├── overview/OverviewTab.tsx    # Wallet overview and health score UI
├── security/SecurityTab.tsx    # revoke.cash approval helper
├── shared/                     # Reusable card and score badge components
└── NftScannerCard.tsx          # NFT contract scanner card
lib/
├── alchemyBase.ts              # Base wallet activity and gas summary helpers
├── alchemyTokens.ts            # Token balances, metadata, price, and scanner helpers
├── baseNameResolve.ts          # 0x / .base.eth / .eth address resolver
├── baseNft.ts                  # Base NFT metadata and health summary helpers
└── fetchJson.ts                # Shared fetch helper
public/
├── .well-known/farcaster.json  # Farcaster/Base mini app manifest
├── embed.png                   # Mini app embed image
├── icon.png                    # App icon
├── logo.png                    # UI logo
├── preview.png                 # Social preview image
└── splash.png                  # Mini app splash image
```

---

## License

This project is licensed under the [MIT License](./LICENSE).
