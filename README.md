# nasz.ai-list

Public gallery of the NFTs, agent identities and tokens held by the nasz.ai Binance Agentic Wallet on BNB Chain.

- `index.html` renders `data.json`.
- `scripts/scan.mjs` scans BSC for new NFT/token transfers into the wallet and updates `data.json` (no dependencies).
- `.github/workflows/scan.yml` runs the scan every 12 hours and commits changes. Run it by hand from the Actions tab ("Scan wallet" → Run workflow).
- Items the wallet did not claim itself (the transaction was sent by another address, i.e. an unsolicited airdrop) get `"spam": true` and `"note": "kemungkinan spam / dust"`. The page shows them dimmed with that label, at the end of the list. Remove the flag by hand if an airdrop is legit.
- To hide a spam token or NFT completely, add its contract address to `blocklist` in `data.json` and remove its entry.
