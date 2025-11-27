# m00n Cabal Check - Farcaster Mini App

A retro 8-bit dungeon crawler themed Farcaster Mini App that allows users to check their $m00n token airdrop allocation and unlock engagement-based rewards.

## Overview

This mini app provides:

- Authentication via Farcaster SDK
- Airdrop eligibility checking for $m00n tokens
- Engagement tier rewards based on user interaction with @m00npapi
- Retro Castlevania-inspired UI with CRT effects
- Share functionality for eligible users
- Downloadable receipt generation

## Setup

### Prerequisites

- Node.js 22+
- Bun package manager
- Neynar API key

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd m00n-cabal
```

2. Install dependencies:

```bash
bun install
```

3. Configure environment variables:

```bash
cp .env.example .env
```

Edit `.env` and add:

- `NEYNAR_API_KEY`: Your Neynar API key from https://neynar.com
- `NEXT_PUBLIC_MINIAPP_URL`: Your deployed app URL

4. Build the airdrop data (CSV lives in `data/m00nad.csv`):

```bash
bun run scripts/build-airdrop-json.ts
```

This script parses the CSV file and generates `public/data/m00nad_airdrop.json`.

### Development

Run the development server:

```bash
bun dev
```

Open [http://localhost:3000/miniapp](http://localhost:3000/miniapp) to view the mini app.

## Testing

### Unit Tests

```bash
bun run test
```

### Run specific test file:

```bash
bun run test tests/tiers.test.ts
```

### Playwright E2E Tests

```bash
bun run playwright test
```

## Project Structure

```
m00n-cabal/
├── app/
│   ├── api/
│   │   ├── airdrop/         # Eligibility check endpoint
│   │   └── engagement/      # Neynar engagement tracking
│   ├── lib/
│   │   └── tiers.ts         # Engagement tier logic
│   ├── miniapp/
│   │   └── page.tsx         # Main mini app page
│   └── globals.css          # Global styles with CRT effects
├── public/
│   ├── .well-known/
│   │   └── farcaster.json   # Farcaster manifest
│   ├── brand/               # Logo and banner assets
│   └── data/                # Generated airdrop JSON
├── scripts/
│   └── build-airdrop-json.ts # CSV to JSON converter
└── tests/                   # Test files
```

## Features

### Engagement Tiers

Users who follow @m00npapi unlock special loot boxes based on their reply count:

- **Initiate** (1+ replies): Voidsteel Coffer
- **Shadow Adept** (25+ replies): Monad Crystal Cache
- **Cabal Lieutenant** (50+ replies): Eclipse Strongbox
- **Eclipsed Council** (100+ replies): Void Throne Reliquary

### Visual Effects

- CRT scanline overlays
- Purple glow effects using Monad brand colors
- Shake animations for denied access
- Flicker effects for loot reveals
- Pixel font headings (Press Start 2P)

## Deployment

### Vercel (Recommended)

Target URL: **https://m00nad.vercel.app** (mini app lives at `/miniapp`).

1. Install and authenticate the Vercel CLI (`pnpm dlx vercel@latest login`).
2. From `apps/m00n-cabal`, run `vercel link --project m00nad` to create/link the project.
3. Configure env vars in Vercel (`vercel env add NEYNAR_API_KEY`, `vercel env add NEXT_PUBLIC_MINIAPP_URL https://m00nad.vercel.app/miniapp`).
4. (Optional) Pull the envs locally with `vercel env pull .env.production`.
5. Trigger a production deployment with `vercel --prod`.

### Cloudflare Pages (Alternative)

1. Build the project:

```bash
bun run build
```

2. Deploy the `.next` directory to Cloudflare Pages

### Manifest Signing & Verification

- The Farcaster manifest lives at `public/.well-known/farcaster.json` and already references `https://m00nad.vercel.app`.
- Update the `accountAssociation.header`, `.payload`, and `.signature` placeholders by running `farcaster miniapp account-association --domain m00nad.vercel.app` (or the Privy equivalent) with the custody key you use for Warpcast.
- Once deployed, validate the manifest with:

```bash
farcaster miniapp lint --domain https://m00nad.vercel.app
```

- Warpcast will look for `https://m00nad.vercel.app/.well-known/farcaster.json`; keep the manifest in sync whenever you redeploy.

## Manifest Verification

Validate the Farcaster manifest:

```bash
farcaster miniapp lint
```

The manifest is located at `public/.well-known/farcaster.json`.

## Environment Variables

| Variable                  | Description                | Required |
| ------------------------- | -------------------------- | -------- |
| `NEYNAR_API_KEY`          | API key for Neynar service | Yes      |
| `NEXT_PUBLIC_MINIAPP_URL` | Public URL of deployed app | Yes      |

## API Endpoints

### GET /api/airdrop

Check airdrop eligibility for an address.

Query params:

- `address`: Ethereum address to check

Response:

```json
{
  "eligible": true,
  "amount": "1000000000"
}
```

### GET /api/engagement

Get user engagement metrics.

Query params:

- `fid`: Farcaster ID

Response:

```json
{
  "replyCount": 42,
  "isFollowing": true,
  "moonpapiFid": 6169
}
```

## License

MIT
