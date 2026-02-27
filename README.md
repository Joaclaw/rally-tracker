# Rally Campaign Tracker

On-chain + Rally API tracker for [Rally](https://rally.fun) campaigns. Dual-source: cross-references Blockscout (on-chain fees) with the Rally API (submissions, scores, users) to give accurate revenue metrics and surface issues.

## What it tracks

**Fee campaigns (on-chain)**
- Wallet count (unique on-chain participants)
- Revenue (ETH fees paid, USD value)
- Projected campaign revenue (based on daily run rate × campaign duration)
- AI content score (from Rally API)
- Approved / rejected submissions
- Failed transactions (fees collected on reverted txs)
- Ghost wallets (paid on-chain but not registered in Rally)

**RLP / legacy campaigns (Rally API only)**
- Users, submissions, approval rate, content score
- Pot size, time remaining

**ARR estimate** — based on actual on-chain age since first transaction, not estimates.

## Example output

```
⚡ Rally — 2026-02-27 07:33 UTC | ETH $2,032

🔗 Base (fee campaigns)
Campaign                 Wall      Rev        Pot Score    Proj Left
────────────────────────────────────────────────────────────────────
Grvt 2.5               61(+2) $87(+$3)    5K USDT 2.2/5  $2,333  14d
Argue Markets              78    $117 450M ARGUE 1.3/5  $4,489  24d
Rally Beta             130(+1) $174(+$1)    1K USDC 1.3/5  $2,999  10d

  Grvt: ⚠️ 24 ghost wallets | Argue: ⚠️ 7 ghost wallets
  All: ⚠️ 11 failed txs — $13.90 collected

🎁 RLP campaigns (legacy free, fee coming)
Campaign                Users  Subs(✓/✗)  Score      Pot Left
──────────────────────────────────────────────────────────────
Agents Are Coming         979  979(979✓0✗) 0.9/5  40K RLP   3d
GenLayer 🤝 Rally         723  723(723✓0✗) 1.9/5  30K RLP   4d
InternetCourt Trust       989  990(990✓0✗) 1.2/5  30K RLP   1d

📊 273 wallets | 239 Rally users | $383 rev (+3 / +$4)
💹 since launch (0.8d): $500/day → $182K ARR 📈
⚠️ 34 ghost wallets (paid on-chain, not in Rally)
```

## Issues it surfaces

| Issue | Description |
|---|---|
| Ghost wallets | On-chain payment succeeded but wallet not found in Rally — user paid, got nothing |
| Failed tx fees | Reverted transactions still collected fees |
| Low approval rate | AI scoring rejecting >50% of paid submissions |
| Low content score | Campaign average below 1.0/5 |

## Scripts

### `scripts/campaign-tracker.mjs`

Main tracker. Discovers campaigns from factory contracts on Base + zkSync, fetches on-chain stats via Blockscout, cross-references with Rally API.

```bash
node scripts/campaign-tracker.mjs
```

Output:
- Human-readable table to stdout
- If activity detected: `---TELEGRAM_MSG---...\n---END---` block for downstream parsing

**State file:** `scripts/campaign-state.json` — stores previous run counts for delta calculation + snapshot ring buffer for 24h/7d ARR comparisons.

### `scripts/monitor.mjs`

Separate HSM wallet monitor — tracks inbound gas fee collection to specific wallets on Base + zkSync.

```bash
node scripts/monitor.mjs
```

## Chains supported

| Chain | Status | Factory contracts |
|---|---|---|
| Base (8453) | ✅ Active | `0xe62DC9DEA493d3d2072d154a877A0715C1CAe03D` `0x6187CB90B868f9eD34cc9fd4B0B78e2e9cAb4248` |
| zkSync Era (324) | ✅ Ready (no campaigns yet) | `0x608a65b4503BFe3B32Ea356a47A86937345862cc` `0x3F71378bA3B8134cfAE1De84F0b3E51fDB4fECa2` |

New factory contracts can be added to the `CHAINS` config in `campaign-tracker.mjs`.

## OpenClaw skill

The `skill/` directory contains an OpenClaw skill for running this tracker as a scheduled agent with Telegram output.

### Install

```bash
cp -r skill ~/.agents/skills/rally-tracker
```

### Cron setup (hourly)

```json
{
  "name": "rally-campaign-tracker",
  "schedule": { "kind": "every", "everyMs": 3600000 },
  "payload": {
    "kind": "agentTurn",
    "message": "Run: `node /path/to/scripts/campaign-tracker.mjs`\n\nIf output contains `---TELEGRAM_MSG---`: extract text between markers and send to Telegram."
  },
  "sessionTarget": "isolated"
}
```

## Data sources

- **On-chain:** [Blockscout](https://blockscout.com) API v2 (Base + zkSync)
- **Rally API:** `https://app.rally.fun/api` — campaigns, submissions, leaderboard
- **ETH price:** CoinGecko

## No API keys required

All data sources are public. No authentication needed.

## Known issues / caveats

- ARR is based on actual on-chain age since first transaction — accuracy improves over time (use 24h+ for reliable figures)
- Rally API submission endpoint returns all records with no cap currently (`limit=10000`)
- Ghost wallet count grows when users connect a fresh wallet not linked to their Twitter/Rally account
