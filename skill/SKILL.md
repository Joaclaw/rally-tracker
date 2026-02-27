# Rally Campaign Tracker Skill

Runs the Rally campaign tracker and sends a formatted report to Telegram.

## Usage

```
Run the Rally campaign tracker
```

## What it does

1. Executes `scripts/campaign-tracker.mjs`
2. Parses stdout for `---TELEGRAM_MSG---` block
3. Sends formatted table to configured Telegram channel

## Setup

1. Clone the repo and set the script path in your cron payload
2. Add as an hourly cron job via OpenClaw

## Output format

Table with columns: Campaign | Wallets | Revenue | Pot | Score | Proj | Left

Followed by:
- Per-campaign issue flags (ghost wallets, failed txs, low scores)
- Summary line with total wallets, users, revenue
- ARR estimate based on on-chain age
