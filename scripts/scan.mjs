// Scans BNB Chain for NFTs/tokens received by the wallet and updates data.json.
// No dependencies (Node 20+). Run: node scripts/scan.mjs
import fs from "node:fs";

const WALLET = "0x2Ca536f9f769c2fE7d9763b6FD97C9e51400b8fb".toLowerCase();
const RPCS = ["https://rpc-bsc.48.club", "https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"];
const CHUNK = 5000;
const T_TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const T_1155 = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const PAD = "0x000000000000000000000000" + WALLET.slice(2);
const FILE = new URL("../data.json", import.meta.url);
const SPAM = /(https?:|www\.|\.com|\.io|\.xyz|\.net|\.org|t\.me|claim|reward|airdrop|visit|bonus|voucher|gift|\$)/i;

const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
data.blocklist ??= [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(method, params) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = RPCS[attempt % RPCS.length];
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(45000) });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; await sleep(1500 * (attempt + 1)); }
  }
  throw last;
}
const hex = (n) => "0x" + n.toString(16);
const call = (to, dataHex) => rpc("eth_call", [{ to, data: dataHex }, "latest"]);
function decodeString(h) {
  try {
    if (!h || h === "0x") return null;
    const b = Buffer.from(h.slice(2), "hex");
    if (b.length === 32) return b.toString("utf8").replace(/\0/g, "").trim() || null;
    const len = Number(BigInt("0x" + b.subarray(32, 64).toString("hex")));
    return b.subarray(64, 64 + len).toString("utf8").trim() || null;
  } catch { return null; }
}
const word = (v) => BigInt(v).toString(16).padStart(64, "0");
async function nameOf(c) { try { return decodeString(await call(c, "0x06fdde03")); } catch { return null; } }
async function symbolOf(c) { try { return decodeString(await call(c, "0x95d89b41")); } catch { return null; } }
async function decimalsOf(c) { try { return Number(BigInt(await call(c, "0x313ce567"))); } catch { return 18; } }
async function balanceOf(c) { try { return BigInt(await call(c, "0x70a08231" + word(WALLET))); } catch { return 0n; } }
async function ownerOf(c, id) { try { return "0x" + (await call(c, "0x6352211e" + word(id))).slice(-40); } catch { return null; } }
// Was this transfer started by the wallet itself (mint/claim/swap)? If not, it was pushed in by someone else.
async function sentBySelf(hash) { try { return (await rpc("eth_getTransactionByHash", [hash]))?.from?.toLowerCase() === WALLET; } catch { return true; } }
const flag = async (item, hash) => { if (!(await sentBySelf(hash))) { item.spam = true; item.note = "kemungkinan spam / dust"; } return item; };
async function imageOf(c, id) {
  try {
    let uri = decodeString(await call(c, "0xc87b56dd" + word(id)));
    if (!uri) return null;
    if (uri.startsWith("ipfs://")) uri = "https://ipfs.io/ipfs/" + uri.slice(7);
    let meta;
    if (uri.startsWith("data:application/json;base64,")) meta = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
    else if (uri.startsWith("data:application/json")) meta = JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(",") + 1)));
    else if (uri.startsWith("http")) meta = await (await fetch(uri, { signal: AbortSignal.timeout(15000) })).json();
    let img = meta?.image || meta?.image_data;
    if (!img) return null;
    if (img.startsWith("<svg")) img = "data:image/svg+xml;base64," + Buffer.from(img).toString("base64");
    if (img.startsWith("ipfs://")) img = "https://ipfs.io/ipfs/" + img.slice(7);
    return img.length < 300000 ? img : null;
  } catch { return null; }
}

const head = Number(BigInt(await rpc("eth_blockNumber", [])));
let from = (data.lastBlock ?? head - 1000) + 1;
const logs = [];
for (let s = from; s <= head; s += CHUNK) {
  const e = Math.min(head, s + CHUNK - 1);
  const a = await rpc("eth_getLogs", [{ fromBlock: hex(s), toBlock: hex(e), topics: [T_TRANSFER, null, PAD] }]);
  const b = await rpc("eth_getLogs", [{ fromBlock: hex(s), toBlock: hex(e), topics: [T_1155, null, null, PAD] }]);
  logs.push(...a, ...b);
  if (process.env.VERBOSE) console.log("chunk", s, a.length, b.length);
  await sleep(300);
}

const nftKey = (c, id) => `${c.toLowerCase()}:${id}`;
const haveNft = new Set(data.nfts.filter((n) => n.contract && n.tokenId != null).map((n) => nftKey(n.contract, n.tokenId)));
const haveTok = new Set(data.tokens.map((t) => t.contract.toLowerCase()));
const block = new Set(data.blocklist.map((x) => x.toLowerCase()));
const nameCache = {};
let added = 0;

for (const l of logs) {
  const c = l.address.toLowerCase();
  if (block.has(c)) continue;
  const date = new Date().toISOString().slice(0, 10);
  if (l.topics[0] === T_TRANSFER && l.topics.length === 4) {
    const id = BigInt(l.topics[3]).toString();
    if (haveNft.has(nftKey(c, id))) continue;
    if ((await ownerOf(c, id))?.toLowerCase() !== WALLET) continue;
    nameCache[c] ??= (await nameOf(c)) || "Unknown NFT";
    if (SPAM.test(nameCache[c])) continue;
    data.nfts.push(await flag({ collection: nameCache[c], tokenId: id, contract: l.address, date, image: await imageOf(c, id), auto: true }, l.transactionHash));
    haveNft.add(nftKey(c, id)); added++;
  } else if (l.topics[0] === T_1155) {
    const id = BigInt("0x" + l.data.slice(2, 66)).toString();
    if (haveNft.has(nftKey(c, id))) continue;
    nameCache[c] ??= (await nameOf(c)) || "ERC-1155 item";
    if (SPAM.test(nameCache[c])) continue;
    data.nfts.push(await flag({ collection: nameCache[c], tokenId: id, contract: l.address, date, image: null, auto: true }, l.transactionHash));
    haveNft.add(nftKey(c, id)); added++;
  } else if (l.topics[0] === T_TRANSFER && l.topics.length === 3) {
    if (haveTok.has(c)) continue;
    const [name, symbol] = [await nameOf(c), await symbolOf(c)];
    if (!symbol || SPAM.test(`${name} ${symbol}`)) continue;
    const bal = await balanceOf(c);
    if (bal === 0n) continue;
    const dec = await decimalsOf(c);
    data.tokens.push(await flag({ symbol, name, contract: l.address, amount: Number(bal) / 10 ** dec, date, auto: true, checked: true }, l.transactionHash));
    haveTok.add(c); added++;
  }
}

// one-time check for older auto-added tokens: label the ones the wallet did not claim itself
for (const t of data.tokens) {
  if (!t.auto || t.checked) continue;
  for (let e = head; e > head - 300000; e -= CHUNK) {
    const l = await rpc("eth_getLogs", [{ address: t.contract, fromBlock: hex(Math.max(0, e - CHUNK + 1)), toBlock: hex(e), topics: [T_TRANSFER, null, PAD] }]).catch(() => []);
    if (l.length) { await flag(t, l[0].transactionHash); break; }
  }
  t.checked = true;
}

// refresh token balances and fill missing NFT images (a few per run)
for (const t of data.tokens) { const dec = await decimalsOf(t.contract); t.amount = Number(await balanceOf(t.contract)) / 10 ** dec; }
let tries = 0;
for (const n of data.nfts) {
  if (n.image || n.imageTried || !n.contract || n.tokenId == null || tries >= 15) continue;
  n.image = await imageOf(n.contract, n.tokenId); n.imageTried = true; tries++;
}

data.lastBlock = head;
data.updatedAt = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
console.log(`scanned to block ${head}, ${logs.length} logs, ${added} new items`);
