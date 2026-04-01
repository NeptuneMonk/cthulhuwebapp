# Cthulhu Fee Monetization Strategy
> Operating outside of P2FK transactions to preserve protocol purity.

## Principles
1. **P2FK transactions remain fee-free** — the on-chain protocol should never be taxed
2. **Value accrues at the service layer** — platform fees live in Cthulhu's infrastructure, not in the blockchain
3. **Users pay for convenience, not access** — core features remain free; premium features add speed, storage, or visibility

---

## Revenue Streams

### 1. IPFS Pinning-as-a-Service (Recurring)
- Free tier: Content pinned for 30 days (auto-garbage-collected)
- **Pro tier ($5/month in BTC/LTC/DOGE):** Permanent pinning, priority gateway, 10GB storage
- **Creator tier ($15/month):** 100GB, custom subdomain, analytics
- Implementation: Backend tracks pin durations per wallet. Payment via a separate (non-P2FK) on-chain tx to a Cthulhu wallet.

### 2. Boosted Posts (Per-Use)
- Users pay a flat fee (e.g., 0.001 BTC) to boost a post to the top of the feed for X hours.
- Payment is a standard Bitcoin tx to a Cthulhu wallet, **not** embedded in P2FK.
- Backend verifies the payment, then flags the post as "boosted" in the feed cache.

### 3. Object Storefront Listing Fee (Per-Use)
- Free: Objects appear in the standard storefront.
- **Featured listing ($2 equivalent):** Object appears in a "Featured" banner on the storefront and SupFlix discovery.
- Payment: Standard on-chain tx to Cthulhu wallet. Backend verifies and adds `featured: true` flag.

### 4. Data Vault Storage Tiers (Recurring)
- Free: 50 vault entries (self-PMs).
- **Vault Pro ($3/month):** Unlimited entries, file attachments up to 50MB, automatic IPFS pinning.
- Enforced at the backend level — the `/api/dm/messages/` endpoint checks vault entry count against the user's plan.

### 5. SupFlix Premium (Recurring)
- Free: Standard quality, public catalog.
- **Premium ($4/month):** Priority IPFS gateway for faster streaming, custom playlists, offline queue.

### 6. Verified Badge (One-Time)
- Users pay a one-time fee (e.g., 0.005 BTC) to get a "Verified" badge on their profile.
- Verified status stored in MongoDB, keyed by wallet address.
- Payment: Standard on-chain tx to Cthulhu wallet.

---

## Payment Architecture

```
User → Standard BTC/LTC/DOGE tx → Cthulhu Platform Wallet
              ↓
Backend monitors wallet (or user submits txid)
              ↓
Backend verifies tx, credits user's plan in MongoDB
              ↓
Plan stored as: { address, plan, expires_at, features: [] }
```

- **No smart contracts needed** — just standard UTXOs to a known platform address.
- **Multi-chain support** — accept BTC, LTC, DOGE at market rates.
- **No KYC** — wallet address is the identity. Pay from any address linked to your profile.

---

## Implementation Priority
1. **Phase 1:** IPFS Pinning tiers (highest value, easiest to enforce)
2. **Phase 2:** Boosted Posts (drives engagement)
3. **Phase 3:** Vault + SupFlix Premium (recurring revenue)
4. **Phase 4:** Featured Object Listings + Verified Badge (community features)

---

## Notes
- All fees are denominated in crypto equivalent (USD reference for pricing clarity).
- Grace periods on subscription lapses — content isn't deleted, just deprioritized.
- Revenue wallet address should be rotated periodically for privacy.
- Consider a "Cthulhu Credits" system where users pre-load a balance for micro-transactions.
