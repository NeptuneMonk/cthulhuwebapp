# INQ Gating Research & Chat Room Gating Plan

## How INQ (Inquiry/Poll) Gating Works in SUP

### INQ Data Structure (on-chain JSON)
```json
{
  "que": { "<poll_address>": "What is your favorite color?" },
  "ans": { "<answer1_address>": "Red", "<answer2_address>": "Blue" },
  "own": ["<object_address_1>", "<object_address_2>"],
  "cre": ["<creator_address>"],
  "end": 144,
  "any": 0
}
```

### Field Definitions
| Field | Purpose |
|-------|---------|
| `que` | Question text, keyed by the poll's own address |
| `ans` | Answer options, each keyed by a unique address voters send to |
| `own` | **Object Ownership Gate** — array of object addresses. Only holders of these objects have "gated" votes |
| `cre` | **Creator Gate** — array of creator addresses. Only holders of objects *created by* these addresses have gated votes |
| `end` | Block count until expiry (relative to creation block). 0 = no expiry |
| `any` | If non-zero, unsigned votes are accepted. Default: 0 (signature required) |

### Gating Resolution Process (from `INQ.cs`)
1. **Build AuthorizedByGate list:**
   - For each address in `own[]`: fetch the OBJ state, collect ALL current owners → add to AuthorizedByGate
   - For each address in `cre[]`: fetch ALL objects created by that address, collect ALL current owners → add to AuthorizedByGate
2. **Count votes:**
   - Fetch all P2FK transactions sent TO each answer address
   - Deduplicate by signer (one vote per address)
   - If `RequireSignature` (default): reject unsigned transactions
   - If `end > 0`: reject votes after block height deadline
   - **TotalVotes/TotalValue**: all valid votes regardless of gate
   - **TotalGatedVotes/TotalGatedValue**: only votes from addresses in AuthorizedByGate
3. **Key insight:** Gating doesn't PREVENT anyone from voting — it creates a **weighted** view where gated votes carry verified authority.

---

## Plan: Applying INQ Gating to Tether Chat Rooms

### Current State
- Chat rooms (Tethers) already have basic seat gating: `canSpeak = isConnected && activeWif && (isPublicRoom || hasSeat)`
- This is **client-side only** — the backend/protocol doesn't enforce it
- Messages are standard P2FK MSG transactions targeted at the room's object address
- All messages are signed (inherent in P2FK PSBT transactions)

### Proposed Architecture

#### 1. Room Gating Configuration (on-chain)
When creating a tether, the creator can set gating rules stored in the object metadata:
```json
{
  "gate": {
    "own": ["<seat_object_address>"],
    "sig": true
  }
}
```
- `own`: Require ownership of listed objects (the tether's own address = require a seat)
- `sig`: Require signed transactions (already true by default in P2FK)

#### 2. Message Verification (backend)
When fetching room messages, the backend should:
1. Fetch the room's object state to get gating rules
2. For each message in the room:
   - Verify the sender's signature (already done by P2FK protocol)
   - Check if the sender is in the `AuthorizedByGate` list (owns a seat)
   - Tag messages as `gated: true` (authorized) or `gated: false` (unauthorized)
3. Return messages with gating metadata

#### 3. Frontend Display
- **Gated rooms**: Only show messages from authorized senders (seat holders)
- **Optional**: Show unauthorized messages dimmed/collapsed with "Not a seat holder" label
- **Creator always authorized** (they created the object)

#### 4. Feed Filtering
- **Public rooms** (`supply <= 1`): Posts appear in main feed with `# Room post` badge
- **Gated rooms** (`supply > 1`): Posts do NOT appear in main feed (or shown with a "Gated" badge, only visible to seat holders)
- **Implementation**: Backend feed endpoint checks if `to_address` is a gated object, and either:
  - Excludes gated room posts from the general feed
  - Includes them with a `gated_room: true` flag for frontend filtering

### Implementation Steps (Priority Order)

#### Phase 1: Backend Gating Verification
1. Add a `/api/room/{address}/messages` response field: `gated: bool` per message
2. Cross-reference sender against object owner list
3. Cache owner lists to avoid repeated API calls

#### Phase 2: Frontend Gating UI
1. In ObjectChatPage, use the `gated` field to visually distinguish authorized vs unauthorized messages
2. Add option to hide unauthorized messages entirely

#### Phase 3: Feed Filtering
1. Backend: Add `is_room_post: bool` and `room_gated: bool` to feed items
2. Frontend: Filter or badge room posts based on gating status
3. Consider a "Moderator view" toggle for the main feed

### Key Differences from INQ
| INQ (Polls) | Tether (Chat Rooms) |
|---|---|
| One-time vote per address | Multiple messages per address |
| Gating creates weighted view | Gating creates access control |
| `TotalGatedVotes` vs `TotalVotes` | Authorized vs unauthorized messages |
| Time-limited (`end`) | Persistent (no expiry) |
| Both gated and ungated visible | Gated room hides unauthorized |

### Notes
- All P2FK transactions are inherently signed, so `sig: true` is already satisfied
- The seat object ownership check mirrors INQ's `own[]` gate exactly
- Creator of the room should always bypass the gate (like poll creators)
- This is backwards-compatible: existing rooms without `gate` metadata continue working as-is
