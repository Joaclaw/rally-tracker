#!/usr/bin/env node
/**
 * Gas Monitor — tracks inbound transactions to HSM wallets on Base + zkSync
 * Wallets:
 *   Base (8453):   0xe9f3778b407e316074484bacf35c17f2a5058da9
 *   zkSync (324):  0x30f07a5a536323a2cecd99fef84cf088dbaa1531
 * Owner (collects gas): 0x4653Fa360F40073E56AcfFE31F552Fba14Adf8b4
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dir, 'state.json');

const WALLETS = {
  base: {
    address: '0xe9F3778B407e316074484BACf35c17F2a5058da9',
    symbol: 'ETH',
    apiBase: 'https://base.blockscout.com/api/v2',
    name: 'Base',
    explorer: 'https://basescan.org/tx/',
  },
  zksync: {
    address: '0x30f07a5a536323a2cecd99fef84cf088dbaa1531',
    symbol: 'ETH',
    apiBase: 'https://zksync.blockscout.com/api/v2',
    name: 'zkSync Era',
    explorer: 'https://explorer.zksync.io/tx/',
  },
};

function loadState() {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  }
  return { base: { lastBlock: 0 }, zksync: { lastBlock: 0 } };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchTxs(wallet) {
  const url = `${wallet.apiBase}/addresses/${wallet.address}/transactions`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.items ?? [];
}

async function checkChain(key, wallet, lastBlock) {
  const txs = await fetchTxs(wallet);
  // Only keep txs we haven't seen, that are inbound to this address
  const newTxs = txs.filter(tx => {
    const block = parseInt(tx.block_number ?? 0);
    const toAddr = (tx.to?.hash ?? '').toLowerCase();
    return block > lastBlock && toAddr === wallet.address.toLowerCase();
  });

  let maxBlock = lastBlock;
  let totalFeeWei = BigInt(0);

  for (const tx of newTxs) {
    const block = parseInt(tx.block_number ?? 0);
    if (block > maxBlock) maxBlock = block;
    const feeWei = BigInt(tx.fee?.value ?? '0');
    totalFeeWei += feeWei;
  }

  return { newTxs, maxBlock, totalFeeWei };
}

function weiToEth(wei) {
  return (Number(wei) / 1e18).toFixed(8);
}

async function main() {
  const state = loadState();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const parts = [];
  let anyActivity = false;

  for (const [key, wallet] of Object.entries(WALLETS)) {
    const lastBlock = state[key]?.lastBlock ?? 0;
    let result;
    try {
      result = await checkChain(key, wallet, lastBlock);
    } catch (err) {
      parts.push(`❌ *${wallet.name}*: ${err.message}`);
      continue;
    }

    const { newTxs, maxBlock, totalFeeWei } = result;
    state[key] = { lastBlock: maxBlock };

    if (newTxs.length === 0) {
      parts.push(`✅ *${wallet.name}*: no new txs`);
    } else {
      anyActivity = true;
      let section = `🔔 *${wallet.name}* — ${newTxs.length} new tx(s)\n`;
      section += `   💸 Total gas fees: \`${weiToEth(totalFeeWei)} ETH\`\n`;
      section += `   📦 Latest block: ${maxBlock}\n`;
      for (const tx of newTxs.slice(0, 5)) {
        const fee = weiToEth(BigInt(tx.fee?.value ?? '0'));
        const fromAddr = tx.from?.hash ?? '?';
        const short = fromAddr.slice(0, 8) + '…' + fromAddr.slice(-4);
        section += `   • \`${short}\` → fee \`${fee} ETH\` (blk ${tx.block_number})`;
        section += ` [↗](${wallet.explorer}${tx.hash})`;
        section += '\n';
      }
      if (newTxs.length > 5) section += `   … +${newTxs.length - 5} more\n`;
      parts.push(section);
    }
  }

  saveState(state);

  if (!anyActivity) {
    console.log('NO_ACTIVITY — no new inbound txs on either chain');
    process.exit(0);
  }

  const msg = `⛽ *Gas Monitor* — ${now}\n\n${parts.join('\n')}`;
  console.log('ACTIVITY_FOUND');
  console.log(msg);

  // Output structured block for cron to parse
  process.stdout.write('\n---TELEGRAM_MSG---\n' + msg + '\n---END---\n');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
