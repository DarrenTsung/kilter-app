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

### Visual testing with Playwright CLI

Playwright CLI (`@playwright/cli`) is installed globally and configured as a Claude Code
skill in `.claude/skills/playwright-cli/`. It provides token-efficient browser automation
without the overhead of MCP.

```bash
# Basic workflow
playwright-cli open http://localhost:3000 --browser=chrome
playwright-cli resize 390 844              # mobile viewport
playwright-cli snapshot                    # accessibility tree (primary inspection method)
playwright-cli screenshot --filename=x.png # visual check
playwright-cli click e15                   # click by ref from snapshot
playwright-cli close                       # close browser
```

**Key patterns:**
- Use `snapshot` (accessibility tree YAML) as the primary way to inspect page state —
  it's faster and more reliable than screenshots for asserting content.
- Use `run-code` for multi-step evaluate calls (e.g., seeding IndexedDB, setting localStorage).
- Use `screenshot` sparingly for visual layout verification.
- Refs like `e15` come from the snapshot YAML and change on every page load — always
  take a fresh snapshot before clicking.

**Seeding test data (IndexedDB + localStorage):**

The app uses lazy DB initialization — IndexedDB stores are only created when the app
first calls `getDB()`. This means you must navigate to a page that triggers DB init
before seeding data.

```bash
# 1. Set auth state in localStorage
playwright-cli run-code "async page => {
  await page.evaluate(() => {
    localStorage.setItem('kilter-auth', JSON.stringify({
      state: { token: 'fake-token', userId: 12345, username: 'testuser', isLoggedIn: true },
      version: 0
    }));
  });
}"

# 2. Reload so the app picks up auth AND initializes IndexedDB
playwright-cli goto http://localhost:3000/randomizer

# 3. NOW seed IndexedDB (stores exist because the app initialized them)
playwright-cli run-code "async page => {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('kilter-app');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['climbs', 'climb_stats'], 'readwrite');
      // ... put test data ...
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}"

# 4. Reload AGAIN so the app reads the seeded data with a fresh connection
playwright-cli goto http://localhost:3000/randomizer
```

**Clearing IndexedDB — IMPORTANT:**

`indexedDB.deleteDatabase()` will **hang indefinitely** if the app holds an open
connection (which it always does via the cached `dbPromise` singleton in `lib/db/index.ts`).
There is no way to force-close another connection from JavaScript.

**The reliable way to reset state is to close the browser and reopen it:**
```bash
playwright-cli close
playwright-cli open http://localhost:3000 --browser=chrome
```
This works because the default session uses an in-memory profile — closing the browser
discards all IndexedDB, localStorage, and cookies. For persistent profiles
(`--persistent`), use `playwright-cli delete-data` instead.

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

## Aurora API — Reverse-Engineered from APK v3.9.18

**Source**: Decompiled from `Kilter Board_3.9.18_APKPure.xapk` using jadx.
Previous details from boardlib were partially outdated (notably the ascent save
endpoint changed from PUT to POST with form-encoded body).

### Hosts

| Host | Purpose |
|------|---------|
| `https://kilterboardapp.com` | All API endpoints (login, sync, save, etc.) |
| `https://api.kilterboardapp.com` | Images only (avatars, hold set images, news) |

### Authentication

**Cookie format** (all requests):
```
Cookie: token=<sessionToken>; appcheck=
```
- `appcheck` is always an empty string (APK's `AppCheckManager` returns `""`)
- Unauthenticated requests (login, signup) send just `Cookie: appcheck=`
- No custom `User-Agent` required — APK uses default Android UA

**Login**:
```
POST /sessions
Content-Type: application/x-www-form-urlencoded

username=...&password=...&tou=accepted&pp=accepted&ua=app
```
Response: `{ "session": { "token": "...", "user_id": 12345 } }`
- 422 = invalid credentials, 429 = rate limited

**Signup**: `POST /users?session=1` (same fields + `email_address`)
**Logout**: `POST /sessions/delete` (body: `token=...&ua=app`)

### Sync

```
POST /sync
Content-Type: application/x-www-form-urlencoded
Cookie: token=<token>; appcheck=

products=1970-01-01+00%3A00%3A00.000000&product_sizes=...&holes=...&...
```

**Shared tables** (always sent): `products`, `product_sizes`, `holes`, `leds`,
`products_angles`, `layouts`, `product_sizes_layouts_sets`, `placements`, `sets`,
`placement_roles`, `climbs`, `climb_stats`, `beta_links`, `attempts`, `kits`

**User tables** (only when authenticated): `users`, `walls`, `draft_climbs`,
`ascents`, `bids`, `tags`, `circuits`

Response: JSON with table data + `_complete` boolean + `shared_syncs`/`user_syncs`
timestamps. Paginated — initial sync needs ~300+ pages (safety limit: 500).

**`display_difficulty` computation**: Not in sync response, must be computed:
```typescript
const displayDiff = row.benchmark_difficulty || row.difficulty_average;
// Use || not ?? — benchmark_difficulty of 0 should fall through
```

**`difficulty_grades` is NOT synced**: Embedded in the APK, seeded from hardcoded data.

### Write Endpoints (all POST, all form-encoded)

| Endpoint | Body Fields |
|----------|-------------|
| `POST /ascents/save` | `uuid`, `user_id`, `climb_uuid`, `angle`, `is_mirror`, `bid_count`, `quality`, `difficulty`, `is_benchmark`, `comment`, `climbed_at` |
| `POST /bids/save` | `uuid`, `user_id`, `climb_uuid`, `angle`, `is_mirror`, `bid_count`, `comment`, `climbed_at` |
| `POST /climbs/save` | `uuid`, `layout_id`, `setter_id`, `name`, `description`, `is_draft`, `frames_count`, `frames_pace`, `frames`, optionally `angle` |
| `POST /circuits/save` | `uuid`, `user_id`, `name`, `description`, `color`, `is_public` |
| `POST /tags/save` | `entity_uuid`, `user_id`, `name`, `is_listed` |
| `POST /follows/save` | `followee_id`, `follower_id`, `state` |
| `POST /walls/save` | `uuid`, `user_id`, `name`, `is_adjustable`, `angle`, `layout_id`, `product_size_id`, `set_ids[]` |

**Date format**: `yyyy-MM-dd HH:mm:ss.SSSSSS` (with microseconds)
**Booleans**: sent as `"0"` or `"1"`

### Delete Endpoints (all POST, body: `uuid=<the-uuid>`)

`/ascents/delete`, `/bids/delete`, `/climbs/delete`, `/circuits/delete`, `/walls/delete`

### Read Endpoints

| Endpoint | Method |
|----------|--------|
| `/users/{userId}` | GET |
| `/users/{userId}/logbook?types=...` | GET |
| `/climbs/{climbUuid}/info?angle={angle}&_version=2` | GET |
| `/climbs/{climbUuid}/beta` | GET |
| `/circuits/{circuitUuid}` | GET |
| `/explore?q=...&t=...` | GET |
| `/pins?gyms=1` | GET |

### CORS Proxy

All Aurora API calls go through Next.js API routes at `/api/aurora/[...path]`:
```
Browser → /api/aurora/sessions      → kilterboardapp.com/sessions
Browser → /api/aurora/sync          → kilterboardapp.com/sync
Browser → /api/aurora/ascents/save  → kilterboardapp.com/ascents/save
```
Token forwarded via `X-Aurora-Token` header → converted to `Cookie: token=...; appcheck=`

**Hosting**: Self-hosted via Cloudflare Tunnel (`kilter-app.darrentsung.com`)
because the Aurora API blocks requests from Vercel's datacenter IPs (sync returns
404 from AWS IPs even with valid auth).

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
│   │   ├── AscentModal.tsx         # Bottom-sheet for logging ascents
│   │   ├── ClimbCard.tsx          # Climb info + board visualization + actions
│   │   ├── BoardView.tsx          # SVG board image + colored hold circles
│   │   ├── FilterPanel.tsx        # Grade/quality/ascent/recency/aux filters
│   │   └── SwipeDeck.tsx          # Framer Motion drag + AnimatePresence
│   ├── lib/
│   │   ├── api/aurora.ts          # Login + ascent logging (POST /sessions, PUT /ascents/save)
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
│       ├── dislikeStore.ts        # Disliked climb UUIDs (persisted, key: kilter-dislikes)
│       └── deckStore.ts           # Shuffled climb list, current index, logged UUIDs
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

### Phase 4 — BLE Board Connection ✓
- [x] Web Bluetooth scanning + connection by name prefix
- [x] Auto-detect API level from device name (`@apiLevel` suffix)
- [x] V3 protocol: 3-byte encoding (position 16-bit + RGB 8-bit)
- [x] V2 protocol: 2-byte encoding (position 10-bit + power-scaled RGB)
- [x] Packet framing: header, checksum, 20-byte chunking with 10ms delays
- [x] Bottom-anchored "Light Up" button on climb card → send to board
- [x] BLE status indicator next to Light Up (green/gray, tap to reconnect)
- [x] Reconnect handler for `gattserverdisconnected` event

### Phase 5 — Ascent Logging ✓
- [x] "Log Send" button on climb card (shows when logged in)
- [x] Bottom-sheet modal with bid count stepper, quality stars, grade picker (±3), comment
- [x] `POST /ascents/save` via CORS proxy (form-encoded, per APK reverse-engineering)
- [x] UUID v4 without hyphens (32 hex chars, boardlib format)
- [x] Save to local IndexedDB after successful API call
- [x] ToS warning/disclaimer on first use (persisted in localStorage)
- [x] "Sent!" state persists across swipes (tracked in deckStore, not component state)
- [x] Dislike button — removes climb from deck and filters from future shuffles
- [x] Disliked UUIDs persisted in localStorage via `dislikeStore`

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
| AscentModal buttons hidden behind bottom nav | Both modal and nav used `z-50` | Bumped modal to `z-[60]`, added `pb-24` |
| `countMatchingClimbs` edge filter mismatch | Non-strict comparisons + missing `edge_top` check | Matched to `queryClimbs` strict checks |
| "Sent!" state lost on card swipe | `logged` was local component state, remounted by AnimatePresence | Moved to `loggedUuids` Set in deckStore |
| Ascent save returned 404 | boardlib used `PUT /ascents/save/{uuid}` with JSON, but APK uses `POST /ascents/save` with form-encoded body | Reverse-engineered APK v3.9.18 to get correct endpoint |
| Sync 404 on Vercel | Aurora API blocks requests from datacenter IPs | Self-host via Cloudflare Tunnel from residential IP |

---

## Ascent Logging — Writing Back to Kilter

**Implemented.** Endpoint confirmed by APK v3.9.18 reverse-engineering:
- `POST /ascents/save` — form-encoded, UUID in body (NOT `PUT /ascents/save/{uuid}`)
- `POST /bids/save` — log an attempt (not implemented)
- `POST /climbs/save` — create/save a climb (not implemented)

**Key details:**
- UUIDs are v4 without hyphens (32 hex chars): `crypto.randomUUID().replace(/-/g, "")`
- `climbed_at` format: `yyyy-MM-dd HH:mm:ss.SSSSSS` (with microseconds)
- Booleans (`is_mirror`, `is_benchmark`) sent as `"0"` or `"1"`
- Auth: `X-Aurora-Token` header → proxy converts to `Cookie: token=...; appcheck=`
- Content-Type: `application/x-www-form-urlencoded` (NOT JSON)

**Modal UX:**
- First use shows a ToS disclaimer (persisted in localStorage key `kilter-ascent-tos-accepted`)
- Bottom-sheet anchored above bottom nav (`z-[60]` to clear nav's `z-50`, `pb-24` for clearance)
- Grade picker shows ±3 grades from community consensus
- Quality is 1–3 stars (matching Aurora's scale)

---

## Reference Projects

- **[BoardLib](https://github.com/lemeryfertitta/BoardLib)** (Python) — De facto reference for Aurora API. Key source of truth for login, sync, and BLE encoding. Installed locally via pip.
- **[Climbdex](https://github.com/lemeryfertitta/Climbdex)** (local: `/Users/dtsung/documents/climbdex`, branch `darren/auxiliary-hold-filter`) — Key reference files:
  - `climbdex/static/js/bluetooth.js` — BLE V2/V3 with auto-detection
  - `climbdex/static/js/common.js` — `drawBoard()` coordinate mapping
  - `climbdex/db.py` lines 120-126 — Strict edge boundary filtering
  - `climbdex/db.py` lines 293–314 — Auxiliary hold filter SQL
- **[fake_kilter_board](https://github.com/1-max-1/fake_kilter_board)** — ESP32 board simulator for BLE testing
