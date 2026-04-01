# Decentralized Node Relay Network — Architecture Design

## Overview

A decentralized infrastructure layer where SUP client operators provide blockchain node access to Cthulhu in exchange for treasury disbursements. This eliminates reliance on rate-limited third-party APIs (BlockCypher, Blockchair) and creates a self-sustaining operator economy.

## How It Works

### 1. Node Registration (On-Chain via P2FK)

SUP operators broadcast a P2FK transaction to a well-known keyword address (e.g., `cthulhu-nodes` or `sup-relay`) with a `SRV` (service) payload type:

```json
{
  "type": "SRV",
  "host": "relay.example.com",
  "port": 8332,
  "chains": ["BTC", "DOGE", "LTC", "MZC"],
  "capabilities": ["utxo", "raw_tx", "broadcast", "block_height"],
  "version": "1.0",
  "heartbeat": 1711209600
}
```

The transaction is signed by the operator's wallet, proving ownership. The registration lives on-chain permanently.

### 2. Discovery

Cthulhu's backend calls `GetRootsByAddress("cthulhu-nodes")` to discover all registered nodes. This is a standard P2FK lookup — no new infrastructure needed.

```python
nodes = await p2fk_get("GetRootsByAddress/cthulhu-nodes", mainnet=True)
for registration in nodes:
    host = registration['host']
    chains = registration['chains']
    # Add to node pool
```

### 3. Health Scoring & Smart Routing

The backend maintains a live health score for each discovered node:

```
NodePool:
  relay.example.com   score=98  latency=45ms   chains=[BTC,DOGE,LTC]  last_check=2s ago
  node2.sup.io        score=85  latency=120ms  chains=[BTC,LTC]       last_check=5s ago
  backup.relay.net    score=72  latency=200ms  chains=[BTC,DOGE,MZC]  last_check=8s ago
```

Requests are routed to the highest-scoring node for the requested chain. Scores factor in:
- Response latency (lower = better)
- Uptime (consecutive successful checks)
- Error rate (recent failures)
- Chain coverage (nodes supporting rarer chains score higher for those chains)

### 4. API Translation Layer

SUP operators run standard Bitcoin Core / Dogecoin Core / Litecoin Core nodes with JSON-RPC enabled. The relay layer translates between Cthulhu's REST API and the node's RPC:

| Cthulhu API | Bitcoin Core RPC |
|---|---|
| `GET /utxos/{address}` | `listunspent` + `scantxoutset` |
| `GET /raw-tx/{txid}` | `getrawtransaction` |
| `POST /broadcast` | `sendrawtransaction` |
| `GET /address/{address}` | `getaddressinfo` + balance calculation |
| `GET /tx/{txid}/status` | `gettransaction` |

### 5. Treasury Reimbursement

Node operators receive periodic payments based on:
- **Uptime score** — measured by heartbeat transactions and health checks
- **Queries served** — tracked by the Cthulhu backend
- **Chain rarity** — DOGE/LTC/MZC operators earn more per query (fewer operators)

Payment schedule options:
- Weekly automated treasury disbursements
- Per-epoch (every N blocks) on-chain payments
- Stake-weighted rewards (operators who stake more get priority routing and higher payouts)

## Implementation Phases

### Phase 1: Provider Abstraction (Ready Now)
Create a `BlockchainProvider` interface in the backend:
```python
class BlockchainProvider:
    async def get_utxos(self, address, chain, mainnet) -> list
    async def get_raw_tx(self, txid, chain, mainnet) -> str
    async def broadcast(self, tx_hex, chain, mainnet) -> dict
    async def get_balance(self, address, chain, mainnet) -> int
```

Implement two providers:
- `PublicAPIProvider` — current mempool.space/blockcypher logic
- `RPCNodeProvider` — direct JSON-RPC to a configured node

### Phase 2: Manual Node Configuration
Allow operators to configure node endpoints via admin settings:
```json
{
  "nodes": [
    {"host": "my-btc-node.com", "port": 8332, "chain": "BTC", "rpc_user": "...", "rpc_pass": "..."},
    {"host": "my-doge-node.com", "port": 22555, "chain": "DOGE"}
  ]
}
```

### Phase 3: On-Chain Discovery
Implement the P2FK-based node registration and automatic discovery.

### Phase 4: Treasury Payments
Automate reimbursements based on uptime and query metrics.

## Security Considerations

- **RPC Authentication**: Nodes must use RPC credentials (user/pass or auth token). Never expose unauthenticated RPC.
- **Read-Only Access**: Relay nodes only need `gettransaction`, `listunspent`, `sendrawtransaction`. Wallet commands should be disabled.
- **TLS**: All relay connections should use TLS (HTTPS).
- **Sybil Resistance**: Operators must stake or hold a minimum balance to register as a node.
- **Blacklisting**: Nodes that return invalid data are automatically blacklisted.

## Economics

| Metric | Value |
|---|---|
| Estimated queries/day (1K users) | 50,000 |
| Cost per query (BlockCypher) | Rate-limited/blocked |
| Cost per query (relay node) | ~0 (operator-hosted) |
| Operator reward per query | Configurable via treasury |
| Minimum viable operators | 3 (for redundancy) |
