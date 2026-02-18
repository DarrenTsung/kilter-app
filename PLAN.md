# Kilter Board Mobile Web App — Plan

## Overview

A mobile web app for the Kilter climbing board focused on a **climb randomizer** workflow:
log in, sync climbs, filter by grade/criteria, get a shuffled list, swipe through
them, and light them up on the physical board via Bluetooth.

---

## Development Setup

### Dev server

```bash
pnpm dev   # starts on http://localhost:3000
```

### Visual testing with Playwright MCP

Playwright MCP is configured in `.claude/settings.json` for visual feedback loops:
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--caps", "vision", "--headless"]
    }
  }
}
```

**Important:** Playwright has its own browser session with separate IndexedDB/localStorage.
To test the logged-in state, either set fake localStorage via `browser_evaluate` or
test against the user's real browser by checking dev server logs (`/tmp/kilter-dev.log`).

Use `browser_resize` to set mobile viewport (390x844) for screenshots.

### Working style

- **Test-driven**: verify with Playwright screenshots after each change
- **Commit often**: one commit per logical change, even small UI tweaks
- **TypeScript check**: run `npx tsc --noEmit` before committing
- **Dev server logs**: `tail /tmp/kilter-dev.log` to check API proxy requests

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js** (App Router) | File-based routing, API routes for CORS proxy |
| Language | **TypeScript** | Type safety across API types, BLE messages, UI state |
| Styling | **Tailwind CSS** | Mobile-first utility classes, fast iteration |
| Animations / Gestures | **Framer Motion** | Swipe gestures (`drag`), spring physics, layout animations |
| State | **Zustand** | Lightweight, no boilerplate, good for persisted state |
| Local DB | **IndexedDB** (via `idb`) | Store synced climb database client-side for offline/fast filtering |
| BLE | **Web Bluetooth API** | Native browser API, no native wrapper needed |
| Hosting | **Vercel** | Native Next.js support, free tier, serverless API routes |
| Package Manager | **pnpm** | Fast, disk-efficient |

### Platform target

Android Chrome + desktop Chrome only. Web Bluetooth is not supported on
Safari/iOS and Apple has no plans to implement it. This is a personal tool, so
the limitation is accepted.

---

## Screens & Navigation

Bottom tab bar with icons, always visible. Two tabs:

```
┌─────────────────────────────┐
│                             │
│        [Screen Content]     │
│                             │
├─────────────────────────────┤
│    🎲 Randomizer    │    ⚙️ Settings    │
└─────────────────────────────┘
```

### 1. Randomizer (main screen)

The core feature. Two sub-states:

**a) Filter / Configure view**
- Grade range selector (chip grid, tap to select range — V0- through V16)
- Minimum quality rating (stepper buttons, +/− 0.5)
- Minimum ascensionist count (stepper buttons, +/− 5)
- Recency filter: preset buttons (No filter / 7 / 30 / 90 days)
- Auxiliary hold filters (toggle buttons):
  - "Any Aux Holds" — climb includes any placement from aux set (set_id 27)
  - "Any Aux Hand Holds" — climb uses aux holds as hands, not just feet
- Live "X climbs match" count (debounced 300ms, non-blocking)
- Sticky bottom bar with match count + "Shuffle" button
- Empty state with filter-widening suggestions when 0 results

**b) Card swipe view**
- Climb card with: name, setter, grade badge, quality, send count
- Board visualization (SVG with board images + colored hold circles)
- Swipe left → next, swipe right → previous (Framer Motion drag, 80px threshold)
- Top bar: ← Filters (pill button) | position counter | Reshuffle (pill button)
- **Bottom-anchored action bar** (Phase 4):
  - **"Light Up"** button — large, primary CTA
  - **BLE status indicator** next to Light Up

### 2. Settings

- Kilter account login / logout
- Board angle slider (0°–70° in steps of 5)
- Sync status (last synced timestamp) & "Sync Now" button
- Debug: DB Stats (temporary — shows IndexedDB row counts)

---

## Aurora API — Discovered Details

**IMPORTANT**: The Aurora API is undocumented and reverse-engineered. These details
were discovered by reading boardlib source code and testing.

### Hosts & Endpoints

The API host is `https://kilterboardapp.com` (NOT `api.kilterboardapp.com`).

| Endpoint | Method | Content-Type | Purpose |
|----------|--------|-------------|---------|
| `/sessions` | POST | application/json | Login (NOT `/login`) |
| `/sync` | POST | application/x-www-form-urlencoded (NOT JSON) | Sync database tables |
| `/v1/ascents/` | PUT | application/json | Log an ascent |

### Authentication

Login request:
```json
POST /sessions
{
  "username": "...",
  "password": "...",
  "tou": "accepted",
  "pp": "accepted",
  "ua": "app"
}
```
Response: `{ "session": { "token": "...", "user_id": 12345 } }`
- Note: response is nested under `"session"` key
- 422 = invalid credentials
- Token goes in `Cookie: token={token}` header for subsequent requests

### User-Agent

Must include a specific User-Agent or requests may be rejected:
```
Kilter%20Board/202 CFNetwork/1568.100.1 Darwin/24.0.0
```

### Sync

The sync endpoint expects **form-encoded** body (NOT JSON):
```
climbs=1970-01-01+00%3A00%3A00.000000&climb_stats=1970-01-01+00%3A00%3A00.000000&...
```

Each key is a table name, value is the last sync timestamp. Response is JSON with
table data + `_complete` boolean + `shared_syncs`/`user_syncs` with updated timestamps.

**Pagination**: The sync returns paginated results. Initial sync needs ~300+ pages
for the full Kilter database. Safety limit set to 500 pages.

**`display_difficulty` computation**: The sync response does NOT include
`display_difficulty` for climb_stats. It must be computed:
```typescript
const displayDiff = row.benchmark_difficulty || row.difficulty_average;
// Use || not ?? — benchmark_difficulty of 0 should fall through
```

**`difficulty_grades` is NOT synced**: This table is embedded in the APK and never
appears in sync responses. We seed it from hardcoded data.

### CORS Proxy

All Aurora API calls go through Next.js API routes at `/api/aurora/[...path]`:
```
Browser → /api/aurora/sessions  → kilterboardapp.com/sessions
Browser → /api/aurora/sync      → kilterboardapp.com/sync
```
Token forwarded via `X-Aurora-Token` header → converted to `Cookie: token=...`

---

## Kilter Board Data Model — Key Facts

### Product IDs

The homewall is **product_id=7** (NOT product_id=1 which is the Original board).

| product_id | Name |
|-----------|------|
| 1 | Kilter Board (Original) |
| 7 | Kilter Board Homewall |

### Placement Roles

Roles are **per-product**. The homewall uses role IDs **42-45**:

| ID | Name | Screen Color | LED Color |
|----|------|-------------|-----------|
| 42 | start | 00DD00 (green) | 00FF00 |
| 43 | middle | 00FFFF (cyan) | 00FFFF |
| 44 | finish | FF00FF (magenta) | FF00FF |
| 45 | foot | FFA500 (orange) | FFA500 |

The original board uses IDs 12-15 with the same colors.

### Board Sizes (layout_id=8 homewall)

Layout 8 covers ALL homewall sizes. Must filter by edge boundaries:

| product_size_id | Name | Edge L | Edge R | Edge B | Edge T |
|----------------|------|--------|--------|--------|--------|
| 17 | 7x10 | -44 | 44 | 24 | 144 |
| 21 | 10x10 | -52 | 52 | -8 | 144 |
| 23 | 8x12 | -52 | 52 | -8 | 140 |
| 25 | 10x12 | -68 | 68 | -8 | 140 |

**Filtering for 7x10**: Use **strict inequality** (matching climbdex):
```typescript
if (climb.edge_left <= -44 || climb.edge_right >= 44 ||
    climb.edge_bottom <= 24 || climb.edge_top >= 144) continue;
```

### Hold Set IDs (layout_id=8)

- 26: Mainline holds (234 placements)
- 27: Auxiliary holds (238 placements)
- 28: Mainline Kickboard (13 placements)
- 29: Auxiliary Kickboard (14 placements)

### Board Images

Downloaded via `boardlib images kilter db.sqlite <output_dir>` and served from
`public/board/product_sizes_layouts_sets/`:
- `55-v2.png` — 7x10 mainline (set 26)
- `56-v3.png` — 7x10 auxiliary (set 27)

Both images are rendered as `<image>` elements inside a single SVG, with hold
circles overlaid. This ensures coordinate alignment between the board image and
hold positions.

### Coordinate Mapping (from climbdex `drawBoard()`)

```typescript
const xSpacing = imgWidth / (EDGE_RIGHT - EDGE_LEFT);
const ySpacing = imgHeight / (EDGE_TOP - EDGE_BOTTOM);
const cx = (hole.x - EDGE_LEFT) * xSpacing;
const cy = imgHeight - (hole.y - EDGE_BOTTOM) * ySpacing;  // Y inverted
```

### Grade Scale

Difficulty values 10–33 map to V0–V16. Grades with two difficulty values
use "-" suffix for the lower one:

| Difficulty | Grade |
|-----------|-------|
| 16 | V3- (6a) |
| 17 | V3 (6a+) |
| 18 | V4- (6b) |
| 19 | V4 (6b+) |
| ... | ... |

### Angles

0° to 70° in steps of 5. Stored as a persistent setting (angle selector is in
Settings, not in the filter panel — it rarely changes mid-session).

---

## Auxiliary Hold Filter — Implementation Notes

Pre-computed at sync time as boolean flags on each climb in IndexedDB:
- `has_aux_hold`: any placement from set_id=27
- `has_aux_hand_hold`: any set_id=27 placement where roleId !== 45 (foot)

**Foot role ID is 45** (product_id=7 homewall). Must filter by product_id when
looking up the foot role — the original board uses ID 15.

Flags are rewritten unconditionally on every sync (no dirty-check optimization)
to ensure correctness after code changes.

---

## Project Structure (Actual)

```
kilter-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with bottom nav
│   │   ├── page.tsx                # Redirect to /randomizer
│   │   ├── api/aurora/[...path]/
│   │   │   └── route.ts           # CORS proxy to Aurora API
│   │   ├── randomizer/
│   │   │   └── page.tsx           # Filter panel ↔ swipe deck
│   │   └── settings/
│   │       └── page.tsx           # Auth, angle, sync, debug
│   ├── components/
│   │   ├── BottomNav.tsx          # Two-tab bottom navigation
│   │   ├── ClimbCard.tsx          # Climb info + board visualization
│   │   ├── BoardView.tsx          # SVG board image + hold circles
│   │   ├── FilterPanel.tsx        # Grade/quality/ascent/recency/aux filters
│   │   └── SwipeDeck.tsx          # Framer Motion drag + AnimatePresence
│   ├── lib/
│   │   ├── api/aurora.ts          # Login client (POST /sessions)
│   │   ├── db/
│   │   │   ├── index.ts           # IndexedDB schema (idb)
│   │   │   ├── sync.ts            # Sync engine + aux flag computation + grade seeding
│   │   │   └── queries.ts         # Filter queries + count
│   │   └── utils/
│   │       ├── frames.ts          # Parse "p123r14..." strings
│   │       └── shuffle.ts         # Fisher-Yates
│   └── store/
│       ├── authStore.ts           # Token, userId, username (persisted)
│       ├── syncStore.ts           # Last sync time, progress (persisted)
│       ├── filterStore.ts         # Grade range, quality, ascents, recency, aux (persisted)
│       └── deckStore.ts           # Shuffled climb list, current index
├── public/board/                  # Board images (downloaded via boardlib)
├── .claude/settings.json          # Playwright MCP config
├── PLAN.md
└── package.json
```

---

## Implementation Phases

### Phase 1 — Skeleton & Auth ✓
- [x] Initialize Next.js + TypeScript + Tailwind + pnpm
- [x] Bottom nav with two tabs (Randomizer + Settings)
- [x] Settings page: login form → Aurora API auth
- [x] CORS proxy at `/api/aurora/[...path]`
- [x] Persist token in Zustand + localStorage
- [x] Sync engine with paginated form-encoded POST
- [x] IndexedDB schema with 10 stores
- [x] Pre-compute `has_aux_hold` and `has_aux_hand_hold` booleans at sync time
- [x] Seed `difficulty_grades` (not part of sync API)

### Phase 2 — Filtering & Randomization ✓
- [x] Filter panel with chip grid grade selector, steppers, toggle buttons
- [x] Auxiliary hold filter toggles ("Any Aux Holds" / "Any Aux Hand Holds")
- [x] Live "X climbs match" count (debounced 300ms)
- [x] IndexedDB queries with layout_id=8 + strict edge boundary filtering
- [x] Empty state with filter-widening suggestions
- [x] Fisher-Yates shuffle
- [x] Sticky bottom bar with Shuffle button
- [x] Angle selector moved to Settings as a slider

### Phase 3 — Card Swipe UI ✓
- [x] Climb card with compact header + stat badges
- [x] Board visualization (SVG with board images + colored hold circles)
- [x] Framer Motion swipe deck (drag gestures, spring animations)
- [x] Top bar with Filters/Reshuffle pill buttons + position counter

### Phase 4 — BLE Board Connection
- [ ] Web Bluetooth scanning + connection by name prefix
- [ ] Auto-detect API level from device name (`@apiLevel` suffix)
- [ ] V3 protocol: 3-byte encoding (position 16-bit + RGB 8-bit)
- [ ] V2 protocol: 2-byte encoding (position 10-bit + power-scaled RGB)
- [ ] Packet framing: header, checksum, 20-byte chunking with 10ms delays
- [ ] Bottom-anchored "Light Up" button on climb card → send to board
- [ ] BLE status indicator next to Light Up (green/gray, tap to reconnect)
- [ ] Reconnect handler for `gattserverdisconnected` event

### Phase 5 — Ascent Logging
- [ ] "Mark as Sent" action on climb card (after completing a climb)
- [ ] Ascent form: bid count, quality rating, difficulty rating, optional comment
- [ ] `PUT /v1/ascents/` call with UUID v4 generation
- [ ] Update local ascent history in IndexedDB after successful log
- [ ] ToS warning/disclaimer on first use

### Phase 6 — Polish & PWA
- [ ] PWA manifest + service worker (offline support after sync)
- [ ] Loading states, error handling, empty states
- [ ] Pull-to-refresh for re-sync
- [ ] Haptic feedback on swipe (if available)
- [ ] Remove debug DB Stats section from Settings

---

## Bugs Found & Fixed During Implementation

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Login returned 404 | Endpoint is `/sessions` not `/login` | Fixed URL in aurora.ts |
| Sync sent JSON instead of form data | Aurora expects `application/x-www-form-urlencoded` | Changed Content-Type + encoding |
| climb_stats had 0 rows after sync | 100-page limit too low for initial sync | Bumped to 500 |
| display_difficulty wrong for non-benchmark climbs | `??` treats `0` as non-null, `||` treats it as falsy (matching Python) | Changed `??` to `||` |
| difficulty_grades had 0 rows | Table not part of sync API (embedded in APK) | Seed from hardcoded data |
| Aux hand hold filter matched everything | Foot role lookup checked for "FEET" but DB has "foot" | Case-insensitive match |
| Foot role ID was wrong (15 vs 45) | Used product_id=1 roles instead of product_id=7 | Filter by product_id=7 |
| Aux flags not recomputed on re-sync | Dirty-check optimization prevented updates | Always rewrite flags |
| Climbs from larger boards appeared | Only filtered by layout_id, not board size | Added strict edge boundary check |
| Holds rendered off the board image | SVG and image in separate layers | Put everything inside one SVG |

---

## Ascent Logging — Writing Back to Kilter

**It is technically possible.** BoardLib added write support in v0.5.0 (March 2024):
- `PUT /v1/ascents/` — log a successful send
- `PUT /v2/climbs/` — create/save a climb
- UUIDs are v4 without hyphens (32 hex chars)
- `attempt_id` is always `0` (hardcoded in both BoardLib and climbdex)
- `climbed_at` format: `YYYY-MM-DD HH:MM:SS` (use Swedish locale: `new Date().toLocaleString('sv')`)

**Our approach:** Include ascent logging as an opt-in feature. The API calls are
straightforward (BoardLib has working implementations to reference). Keep the
write pattern minimal and human-like (one ascent at a time, no bulk operations).

---

## Reference Projects

- **[BoardLib](https://github.com/lemeryfertitta/BoardLib)** (Python) — De facto reference for Aurora API. Key source of truth for login, sync, and BLE encoding. Installed locally via pip.
- **[Climbdex](https://github.com/lemeryfertitta/Climbdex)** (local: `/Users/dtsung/documents/climbdex`, branch `darren/auxiliary-hold-filter`) — Key reference files:
  - `climbdex/static/js/bluetooth.js` — BLE V2/V3 with auto-detection
  - `climbdex/static/js/common.js` — `drawBoard()` coordinate mapping
  - `climbdex/db.py` lines 120-126 — Strict edge boundary filtering
  - `climbdex/db.py` lines 293–314 — Auxiliary hold filter SQL
- **[fake_kilter_board](https://github.com/1-max-1/fake_kilter_board)** — ESP32 board simulator for BLE testing
