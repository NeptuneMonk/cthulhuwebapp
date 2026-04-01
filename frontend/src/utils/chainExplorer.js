/**
 * Smart Composite Blockchain Explorer
 * ====================================
 * Instead of hitting ONE explorer for everything (and getting rate-limited),
 * this routes each data type to the best explorer for that chain, with
 * automatic fallback per data type.
 *
 * Architecture:
 *   getUTXOs('addr', 'btc-testnet')
 *     → tries mempool.space (best for BTC UTXOs)
 *     → falls back to blockstream.info
 *
 *   getRawTx('txid', 'doge-mainnet')
 *     → tries blockcypher (fastest for DOGE)
 *     → falls back to blockchair
 *
 * Each explorer is tracked for failures. After 3 consecutive failures,
 * it's "circuit-broken" for 60s, skipping it entirely during that window.
 */

// ─── Circuit Breaker ───

const _failures = {};   // { 'mempool.space': { count: 0, until: 0 } }
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN = 60000; // 60s

function markSuccess(provider) {
  if (_failures[provider]) _failures[provider].count = 0;
}

function markFailure(provider) {
  if (!_failures[provider]) _failures[provider] = { count: 0, until: 0 };
  _failures[provider].count++;
  if (_failures[provider].count >= CIRCUIT_THRESHOLD) {
    _failures[provider].until = Date.now() + CIRCUIT_COOLDOWN;
  }
}

function isAvailable(provider) {
  const f = _failures[provider];
  if (!f) return true;
  if (f.until && Date.now() < f.until) return false;
  if (f.until && Date.now() >= f.until) { f.count = 0; f.until = 0; } // Reset after cooldown
  return true;
}

async function tryFetch(url, provider, opts = {}) {
  const { timeout = 12000, ...fetchOpts } = opts;
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeout), ...fetchOpts });
  if (resp.status === 429) { markFailure(provider); throw new Error('Rate limited'); }
  if (!resp.ok) { markFailure(provider); throw new Error(`HTTP ${resp.status}`); }
  markSuccess(provider);
  return resp;
}

// ─── Explorer Definitions ───

const EXPLORERS = {
  // ── BTC ──
  'btc-testnet': {
    utxos: [
      { id: 'mempool', url: (addr) => `https://mempool.space/testnet/api/address/${addr}/utxo`, parse: parseMempoolUtxos },
      { id: 'blockstream', url: (addr) => `https://blockstream.info/testnet/api/address/${addr}/utxo`, parse: parseMempoolUtxos },
    ],
    rawTx: [
      { id: 'blockstream', url: (txid) => `https://blockstream.info/testnet/api/tx/${txid}/hex`, parse: 'text' },
      { id: 'mempool', url: (txid) => `https://mempool.space/testnet/api/tx/${txid}/hex`, parse: 'text' },
    ],
    txDetail: [
      { id: 'mempool', url: (txid) => `https://mempool.space/testnet/api/tx/${txid}`, parse: parseMempoolTx },
      { id: 'blockstream', url: (txid) => `https://blockstream.info/testnet/api/tx/${txid}`, parse: parseMempoolTx },
    ],
    broadcast: [
      { id: 'mempool', url: () => `https://mempool.space/testnet/api/tx`, method: 'POST', contentType: 'text/plain' },
      { id: 'blockstream', url: () => `https://blockstream.info/testnet/api/tx`, method: 'POST', contentType: 'text/plain' },
    ],
    balance: [
      { id: 'mempool', url: (addr) => `https://mempool.space/testnet/api/address/${addr}`, parse: parseMempoolBalance },
      { id: 'blockstream', url: (addr) => `https://blockstream.info/testnet/api/address/${addr}`, parse: parseMempoolBalance },
    ],
    blockHeight: [
      { id: 'mempool', url: () => `https://mempool.space/testnet/api/blocks/tip/height`, parse: 'text' },
      { id: 'blockstream', url: () => `https://blockstream.info/testnet/api/blocks/tip/height`, parse: 'text' },
    ],
    fees: [
      { id: 'mempool', url: () => `https://mempool.space/testnet/api/v1/fees/recommended`, parse: 'json' },
    ],
    txHistory: [
      { id: 'mempool', url: (addr) => `https://mempool.space/testnet/api/address/${addr}/txs`, parse: parseMempoolTxHistory },
      { id: 'blockstream', url: (addr) => `https://blockstream.info/testnet/api/address/${addr}/txs`, parse: parseMempoolTxHistory },
    ],
  },
  'btc-mainnet': {
    utxos: [
      { id: 'mempool', url: (addr) => `https://mempool.space/api/address/${addr}/utxo`, parse: parseMempoolUtxos },
      { id: 'blockstream', url: (addr) => `https://blockstream.info/api/address/${addr}/utxo`, parse: parseMempoolUtxos },
    ],
    rawTx: [
      { id: 'blockstream', url: (txid) => `https://blockstream.info/api/tx/${txid}/hex`, parse: 'text' },
      { id: 'mempool', url: (txid) => `https://mempool.space/api/tx/${txid}/hex`, parse: 'text' },
    ],
    txDetail: [
      { id: 'mempool', url: (txid) => `https://mempool.space/api/tx/${txid}`, parse: parseMempoolTx },
      { id: 'blockstream', url: (txid) => `https://blockstream.info/api/tx/${txid}`, parse: parseMempoolTx },
    ],
    broadcast: [
      { id: 'mempool', url: () => `https://mempool.space/api/tx`, method: 'POST', contentType: 'text/plain' },
      { id: 'blockstream', url: () => `https://blockstream.info/api/tx`, method: 'POST', contentType: 'text/plain' },
    ],
    balance: [
      { id: 'mempool', url: (addr) => `https://mempool.space/api/address/${addr}`, parse: parseMempoolBalance },
      { id: 'blockstream', url: (addr) => `https://blockstream.info/api/address/${addr}`, parse: parseMempoolBalance },
    ],
    blockHeight: [
      { id: 'mempool', url: () => `https://mempool.space/api/blocks/tip/height`, parse: 'text' },
      { id: 'blockstream', url: () => `https://blockstream.info/api/blocks/tip/height`, parse: 'text' },
    ],
    fees: [
      { id: 'mempool', url: () => `https://mempool.space/api/v1/fees/recommended`, parse: 'json' },
    ],
    txHistory: [
      { id: 'mempool', url: (addr) => `https://mempool.space/api/address/${addr}/txs`, parse: parseMempoolTxHistory },
      { id: 'blockstream', url: (addr) => `https://blockstream.info/api/address/${addr}/txs`, parse: parseMempoolTxHistory },
    ],
  },

  // ── DOGE ──
  'doge-mainnet': {
    utxos: [
      { id: 'blockcypher', url: (addr) => `https://api.blockcypher.com/v1/doge/main/addrs/${addr}?unspentOnly=true&limit=2000`, parse: parseBlockcypherUtxos },
    ],
    rawTx: [
      { id: 'blockcypher', url: (txid) => `https://api.blockcypher.com/v1/doge/main/txs/${txid}?limit=500&includeHex=true`, parse: parseBlockcypherRawTx },
      { id: 'blockchair', url: (txid) => `https://api.blockchair.com/dogecoin/raw/transaction/${txid}`, parse: parseBlockchairRawTx },
    ],
    txDetail: [
      { id: 'blockcypher', url: (txid) => `https://api.blockcypher.com/v1/doge/main/txs/${txid}?limit=500`, parse: parseBlockcypherTx },
      { id: 'blockchair', url: (txid) => `https://api.blockchair.com/dogecoin/raw/transaction/${txid}`, parse: parseBlockchairTx },
    ],
    broadcast: [
      { id: 'blockcypher', url: () => `https://api.blockcypher.com/v1/doge/main/txs/push`, method: 'POST', contentType: 'application/json', wrapBody: (hex) => JSON.stringify({ tx: hex }) },
    ],
    balance: [
      { id: 'blockcypher', url: (addr) => `https://api.blockcypher.com/v1/doge/main/addrs/${addr}/balance`, parse: parseBlockcypherBalance },
    ],
    blockHeight: [
      { id: 'blockcypher', url: () => `https://api.blockcypher.com/v1/doge/main`, parse: (d) => d.height },
    ],
    txHistory: [
      { id: 'blockcypher', url: (addr) => `https://api.blockcypher.com/v1/doge/main/addrs/${addr}/full?limit=50`, parse: parseBlockcypherTxHistory },
    ],
  },

  // ── LTC ──
  'ltc-mainnet': {
    utxos: [
      { id: 'litecoinspace', url: (addr) => `https://litecoinspace.org/api/address/${addr}/utxo`, parse: parseMempoolUtxos },
    ],
    rawTx: [
      { id: 'litecoinspace', url: (txid) => `https://litecoinspace.org/api/tx/${txid}/hex`, parse: 'text' },
    ],
    txDetail: [
      { id: 'litecoinspace', url: (txid) => `https://litecoinspace.org/api/tx/${txid}`, parse: parseMempoolTx },
    ],
    broadcast: [
      { id: 'litecoinspace', url: () => `https://litecoinspace.org/api/tx`, method: 'POST', contentType: 'text/plain' },
    ],
    balance: [
      { id: 'litecoinspace', url: (addr) => `https://litecoinspace.org/api/address/${addr}`, parse: parseMempoolBalance },
    ],
    blockHeight: [
      { id: 'litecoinspace', url: () => `https://litecoinspace.org/api/blocks/tip/height`, parse: 'text' },
    ],
    txHistory: [
      { id: 'litecoinspace', url: (addr) => `https://litecoinspace.org/api/address/${addr}/txs`, parse: parseMempoolTxHistory },
    ],
  },

  // ── MZC (Mazacoin) — two identical Iquidus explorers ──
  'mzc-mainnet': {
    rawTx: [
      { id: 'mazachain', url: (txid) => `https://mazacha.in/api/getrawtransaction?txid=${txid}&decrypt=0`, parse: 'text' },
      { id: 'cryptoadhd', url: (txid) => `https://maza.explorer.cryptoadhd.com/api/getrawtransaction?txid=${txid}&decrypt=0`, parse: 'text' },
    ],
    txDetail: [
      { id: 'mazachain', url: (txid) => `https://mazacha.in/api/getrawtransaction?txid=${txid}&decrypt=1`, parse: parseMazaTx },
      { id: 'cryptoadhd', url: (txid) => `https://maza.explorer.cryptoadhd.com/api/getrawtransaction?txid=${txid}&decrypt=1`, parse: parseMazaTx },
    ],
    balance: [
      { id: 'mazachain', url: (addr) => `https://mazacha.in/ext/getbalance/${addr}`, parse: parseMazaBalance },
      { id: 'cryptoadhd', url: (addr) => `https://maza.explorer.cryptoadhd.com/ext/getbalance/${addr}`, parse: parseMazaBalance },
    ],
    blockHeight: [
      { id: 'mazachain', url: () => `https://mazacha.in/api/getblockcount`, parse: 'text' },
      { id: 'cryptoadhd', url: () => `https://maza.explorer.cryptoadhd.com/api/getblockcount`, parse: 'text' },
    ],
    utxos: [
      // Maza has no direct UTXO API — derive from address TX history
      { id: 'mazachain', url: (addr) => `https://mazacha.in/ext/getaddress/${addr}`, parse: parseMazaAddressUtxos },
      { id: 'cryptoadhd', url: (addr) => `https://maza.explorer.cryptoadhd.com/ext/getaddress/${addr}`, parse: parseMazaAddressUtxos },
    ],
    txHistory: [
      { id: 'mazachain', url: (addr) => `https://mazacha.in/ext/getaddress/${addr}`, parse: parseMazaTxHistory },
      { id: 'cryptoadhd', url: (addr) => `https://maza.explorer.cryptoadhd.com/ext/getaddress/${addr}`, parse: parseMazaTxHistory },
    ],
    // No broadcast API on Iquidus — requires personal node RPC
  },
};

// Also map DOGE testnet and DOG alias
EXPLORERS['dog-mainnet'] = EXPLORERS['doge-mainnet'];
EXPLORERS['ltc-testnet'] = EXPLORERS['ltc-mainnet']; // LTC testnet uses same explorer format

// ─── Response Parsers ───

function parseMempoolUtxos(data) {
  return data.map(u => ({
    txid: u.txid,
    vout: u.vout,
    value: u.value,
    confirmed: u.status?.confirmed || false,
  }));
}

function parseMempoolBalance(data) {
  const funded = data.chain_stats?.funded_txo_sum || 0;
  const spent = data.chain_stats?.spent_txo_sum || 0;
  const mFunded = data.mempool_stats?.funded_txo_sum || 0;
  const mSpent = data.mempool_stats?.spent_txo_sum || 0;
  return { confirmed: funded - spent, unconfirmed: mFunded - mSpent, total: (funded - spent) + (mFunded - mSpent) };
}

function parseMempoolTx(data) {
  return {
    txid: data.txid,
    confirmed: data.status?.confirmed || false,
    blockHeight: data.status?.block_height || null,
    blockTime: data.status?.block_time || null,
    fee: data.fee || 0,
    vout: (data.vout || []).map(o => ({ value: o.value, address: o.scriptpubkey_address })),
    vin: (data.vin || []).map(i => ({ txid: i.txid, vout: i.vout, prevout: i.prevout })),
  };
}

function parseMempoolTxHistory(data) {
  return (data || []).map(tx => ({
    txid: tx.txid,
    confirmed: tx.status?.confirmed || false,
    blockTime: tx.status?.block_time || null,
    fee: tx.fee || 0,
  }));
}

function parseBlockcypherUtxos(data) {
  return (data.txrefs || []).filter(r => !r.spent).map(r => ({
    txid: r.tx_hash,
    vout: r.tx_output_n,
    value: r.value,
    confirmed: r.confirmations > 0,
  }));
}

function parseBlockcypherBalance(data) {
  return { confirmed: data.balance || 0, unconfirmed: data.unconfirmed_balance || 0, total: data.final_balance || 0 };
}

function parseBlockcypherRawTx(data) {
  return data.hex || '';
}

function parseBlockcypherTx(data) {
  return {
    txid: data.hash,
    confirmed: (data.confirmations || 0) > 0,
    blockHeight: data.block_height || null,
    blockTime: data.confirmed ? new Date(data.confirmed).getTime() / 1000 : null,
    fee: data.fees || 0,
    vout: (data.outputs || []).map(o => ({ value: o.value, address: (o.addresses || [])[0] })),
    vin: (data.inputs || []).map(i => ({ txid: i.prev_hash, vout: i.output_index })),
  };
}

function parseBlockcypherTxHistory(data) {
  return (data.txs || []).map(tx => ({
    txid: tx.hash,
    confirmed: (tx.confirmations || 0) > 0,
    blockTime: tx.confirmed ? new Date(tx.confirmed).getTime() / 1000 : null,
    fee: tx.fees || 0,
  }));
}

function parseBlockchairRawTx(data) {
  const txData = Object.values(data?.data || {})[0];
  return txData?.raw_transaction || '';
}

function parseBlockchairTx(data) {
  const txData = Object.values(data?.data || {})[0];
  const decoded = txData?.decoded_raw_transaction || {};
  return {
    txid: decoded.txid,
    confirmed: true, // blockchair only returns confirmed TXs
    vout: (decoded.vout || []).map(o => ({
      value: Math.round((o.value || 0) * 1e8),
      address: (o.scriptPubKey?.addresses || [])[0],
    })),
  };
}

function parseMazaTx(data) {
  return {
    txid: data.txid,
    confirmed: !!data.blockhash,
    blockHash: data.blockhash || null,
    blockTime: data.blocktime || data.time || null,
    vout: (data.vout || []).map(o => ({
      value: Math.round((o.value || 0) * 1e8),
      address: (o.scriptPubKey?.addresses || [])[0],
    })),
    vin: (data.vin || []).map(i => ({ txid: i.txid, vout: i.vout })),
  };
}

function parseMazaBalance(data) {
  // mazacha.in/ext/getbalance returns a plain number (coins, not sats)
  const coins = typeof data === 'number' ? data : parseFloat(data) || 0;
  return { confirmed: Math.round(coins * 1e8), unconfirmed: 0, total: Math.round(coins * 1e8) };
}

function parseMazaAddressUtxos(data) {
  // Iquidus /ext/getaddress returns last_txs but no direct UTXO list.
  // This is a best-effort approximation — personal node RPC is much better.
  // Returns empty for now — flag that UTXOs need personal node for MAZA.
  return [];
}

function parseMazaTxHistory(data) {
  return (data.last_txs || []).map(tx => ({
    txid: typeof tx === 'string' ? tx : (tx.addresses || tx.txid || ''),
    confirmed: true,
  }));
}

// ─── Core Query Engine ───

/**
 * Execute a query against ranked explorer sources for a specific data type.
 * Tries each available source in order, with circuit breaker protection.
 */
async function query(network, dataType, param, opts = {}) {
  const chain = EXPLORERS[network];
  if (!chain) throw new Error(`Unsupported network: ${network}`);
  const sources = chain[dataType];
  if (!sources || sources.length === 0) throw new Error(`No ${dataType} source for ${network}`);

  const errors = [];

  for (const source of sources) {
    if (!isAvailable(source.id)) {
      errors.push(`${source.id}: circuit-broken`);
      continue;
    }

    try {
      const url = source.url(param);

      // Broadcast has special handling
      if (dataType === 'broadcast') {
        const body = source.wrapBody ? source.wrapBody(param) : param;
        const resp = await tryFetch(url, source.id, {
          method: source.method || 'POST',
          headers: { 'Content-Type': source.contentType || 'text/plain' },
          body,
          timeout: opts.timeout || 30000,
        });
        const text = await resp.text();
        return text.trim();
      }

      const resp = await tryFetch(url, source.id, { timeout: opts.timeout || 12000 });

      // Parse response
      if (source.parse === 'text') {
        return await resp.text();
      } else if (source.parse === 'json') {
        return await resp.json();
      } else if (typeof source.parse === 'function') {
        const json = await resp.json();
        return source.parse(json);
      }

      return await resp.json();
    } catch (e) {
      errors.push(`${source.id}: ${e.message}`);
      continue; // Try next source
    }
  }

  throw new Error(`All ${dataType} sources failed for ${network}: ${errors.join('; ')}`);
}

// ─── Public API ───

export async function getUTXOs(address, network) {
  return query(network, 'utxos', address);
}

export async function getRawTx(txid, network) {
  return query(network, 'rawTx', txid);
}

export async function getTxDetail(txid, network) {
  return query(network, 'txDetail', txid);
}

export async function broadcast(txHex, network) {
  return query(network, 'broadcast', txHex, { timeout: 30000 });
}

export async function getBalance(address, network) {
  return query(network, 'balance', address);
}

export async function getBlockHeight(network) {
  const result = await query(network, 'blockHeight', '');
  return typeof result === 'string' ? parseInt(result, 10) : result;
}

export async function getFees(network) {
  return query(network, 'fees', '');
}

export async function getTxHistory(address, network) {
  return query(network, 'txHistory', address);
}

export async function getTxStatus(txid, network) {
  try {
    const detail = await getTxDetail(txid, network);
    return { confirmed: detail.confirmed, blockHeight: detail.blockHeight };
  } catch {
    return { confirmed: false, blockHeight: null };
  }
}

/** Get health/availability status for all sources on a network */
export function getSourceStatus(network) {
  const chain = EXPLORERS[network];
  if (!chain) return {};
  const status = {};
  const seen = new Set();
  for (const sources of Object.values(chain)) {
    for (const s of (sources || [])) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const f = _failures[s.id];
      status[s.id] = {
        available: isAvailable(s.id),
        failures: f?.count || 0,
        cooldownUntil: f?.until || 0,
      };
    }
  }
  return status;
}

/** Reset circuit breakers (e.g., when user manually retries) */
export function resetCircuitBreakers() {
  Object.keys(_failures).forEach(k => delete _failures[k]);
}

/** List supported networks */
export function getSupportedNetworks() {
  return Object.keys(EXPLORERS).filter(k => !['dog-mainnet'].includes(k)); // exclude aliases
}
