# nasz.ai-list

Public gallery of the NFTs, agent identities and tokens held by the nasz.ai Binance Agentic Wallet on BNB Chain.

- `index.html` renders `data.json`.
- `scripts/scan.mjs` scans BSC for new NFT/token transfers into the wallet and updates `data.json` (no dependencies).
- `.github/workflows/scan.yml` runs the scan every 12 hours and commits changes. Run it by hand from the Actions tab ("Scan wallet" → Run workflow).
- To hide a spam token or NFT, add its contract address to `blocklist` in `data.json` and remove its entry.
