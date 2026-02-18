# Kilter Board Mobile Web App — Plan

## Overview

A mobile web app for the Kilter climbing board focused on a **climb randomizer** workflow:
log in, sync climbs, filter by grade/criteria, get a shuffled list, swipe through
them, and light them up on the physical board via Bluetooth.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js** (App Router) | File-based routing, API routes for CORS proxy, good PWA story |
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

### Why a web app (not native)?

- The Kilter Board official app already exists natively. This is a companion tool.
- Faster to ship, no app store review.
- Personal use — only needs to work on one device.

---

## Screens & Navigation

Bottom tab bar with icons, always visible. Two tabs:

```
┌─────────────────────────────┐
│                             │
│                             │
│        [Screen Content]     │
│                             │
│                             │
├─────────────────────────────┤
│    🎲 Randomizer    │    ⚙️ Settings    │
└─────────────────────────────┘
```

### 1. Randomizer (main screen)

The core feature. Two sub-states:

**a) Filter / Configure view**
- Grade range selector (dual-handle slider, e.g. V4–V6)
- Minimum quality rating (star threshold, e.g. ≥ 2.5 stars)
- Minimum ascensionist count (e.g. ≥ 10 ascents — filters out obscure/broken climbs)
- Recency filter: "Exclude climbs I've sent in the last ___ days" (slider or preset: 7 / 30 / 90 / never)
- Board angle selector (e.g. 40°, 45°, 50° — depends on gym setup)
- Auxiliary hold filters (Kilter 7x10 homewall, layout_id 8):
  - "Uses Aux Holds" — climb includes any placement from aux set (set_id 27)
  - "Uses Aux Hand Holds" — climb uses aux holds as hands, not just feet
- Live "X climbs match" count updates as filters change (debounced / non-blocking
  so the UI stays responsive — can show "calculating..." briefly)
- "Shuffle" button → generates the randomized list and transitions to the card view

**b) Card swipe view**
- Full-screen climb card showing:
  - Climb name, setter
  - Grade (community consensus + benchmark if available)
  - Quality stars
  - Hold visualization (rendered on a board image)
  - Your history with this climb (last sent date, attempts)
- **Swipe left** → next climb
- **Swipe right** → previous climb
- **Bottom-anchored action bar** (separated from swipe gesture area):
  - **"Light Up"** button — large, full-width, primary CTA. Sends climb to board via BLE.
  - **BLE status indicator** next to Light Up (green = connected, gray = disconnected).
    Tap when disconnected to trigger reconnect.
- "Re-shuffle" and "Back to filters" as secondary actions (small, top area)
- **Empty state**: if 0 climbs match filters, show message with suggestions to
  widen grade range or relax filters instead of an empty deck

### 2. Settings

- Kilter account login / logout
- Sync status (last synced timestamp) & manual re-sync trigger
- Board connection (BLE pairing status)
- Board angle preference (default angle)
- Board size / layout selection

---

## Data Flow

### CORS Proxy

The Aurora API doesn't serve CORS headers, so browser-direct calls will fail.
All Aurora API calls go through Next.js API routes on Vercel, acting as a thin
proxy:

```
Browser → /api/aurora/login    → api.kilterboardapp.com/login
Browser → /api/aurora/sync     → api.kilterboardapp.com/sync
Browser → /api/aurora/ascents  → api.kilterboardapp.com/v1/ascents/
```

These are simple pass-through routes — no business logic, just forward the
request with the user's token and return the response.

### Authentication & Sync

```
User enters credentials
        │
        ▼
POST /api/aurora/login (our proxy)
  → api.kilterboardapp.com/login
  → { token, user_id }
        │
        ▼
Store token in Zustand (persisted to localStorage)
        │
        ▼
POST /api/aurora/sync (our proxy)
  → api.kilterboardapp.com/sync
  → Incremental database tables (climbs, climb_stats,
     placements, holes, leds, walls, etc.)
        │
        ▼
Upsert into IndexedDB
  → Tables: climbs, climb_stats, placements, holes,
     leds, placement_roles, difficulty_grades, ascents
```

The sync endpoint supports incremental updates — we send timestamps of our last
sync and it returns only new/changed rows. This keeps re-syncs fast.

### Filtering & Randomization

All filtering happens **client-side against IndexedDB**. No network required after
initial sync.

```
IndexedDB query:
  SELECT climbs + climb_stats
  WHERE angle = selected_angle
    AND display_difficulty BETWEEN min_grade AND max_grade
    AND quality_average >= min_quality
    AND ascensionist_count >= min_ascents
  EXCLUDE climb UUIDs where user has ascent within recency_window
  IF usesAuxiliary:
    frames must contain a placement_id from set_id 27
  IF usesAuxHandHold:
    frames must contain a set_id 27 placement in a non-foot role
        │
        ▼
Fisher-Yates shuffle in memory
        │
        ▼
Store shuffled list in Zustand → render card stack
```

**Auxiliary hold filtering approach** (ported from climbdex `db.py`):
In climbdex this is done via SQL `EXISTS` + `LIKE '%p' || id || 'r%'` against the
frames string. In our app, we pre-compute boolean flags per climb **at sync time**
and store them as indexed fields in IndexedDB — this avoids scanning frames
strings on every filter operation:
```typescript
// At sync time: compute once per climb, store as indexed booleans
const auxPlacementIds = new Set(
  placements.filter(p => p.set_id === 27 && p.layout_id === 8).map(p => p.id)
);
for (const climb of climbs) {
  const frames = parseFrames(climb.frames);
  climb.has_aux_hold = frames.some(f => auxPlacementIds.has(f.placementId));
  climb.has_aux_hand_hold = frames.some(
    f => auxPlacementIds.has(f.placementId) && f.roleId !== footRoleId
  );
  // upsert climb with new boolean fields into IndexedDB
}
// At filter time: just check the indexed boolean
```

**Hold set IDs (Kilter 7x10 homewall, layout_id 8):**
- 26: Mainline holds (234 placements)
- 27: Auxiliary holds (238 placements)
- 28: Mainline Kickboard (13 placements)
- 29: Auxiliary Kickboard (14 placements)

### BLE Board Communication

Reference implementation: `climbdex/static/js/bluetooth.js`

```
User taps "Light Up" on a climb card
        │
        ▼
Parse climb frames string: "p123r14p456r15p789r13"
  → [{ placement_id: 123, role_id: 14 }, ...]
        │
        ▼
Look up each placement → LED position (from leds table)
Look up each role → hex color (from placement_roles led_color)
        │
        ▼
Detect protocol version from device name:
  Device name format: "Kilter#serial@apiLevel"
  apiLevel >= 3 → V3 protocol (3 bytes/hold)
  apiLevel < 3  → V2 protocol (2 bytes/hold, e.g. homewall)
        │
        ▼
Encode holds per protocol version (see below)
        │
        ▼
Wrap each packet: [0x01, length, checksum, 0x02, ...data, 0x03]
  Checksum = ~(sum of data bytes) & 0xFF
        │
        ▼
Chunk into 20-byte BLE writes with 10ms delay between chunks
```

**BLE reconnect:** Listen for `gattserverdisconnected` event on the device. When
the user taps "Light Up" while disconnected, auto-reconnect to the cached device
before sending. Surface connection state via the BLE indicator next to the Light
Up button.

**BLE Constants:**
- UART Service UUID: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- Write Characteristic UUID: `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- Max BLE chunk: 20 bytes
- Max packet body: 255 bytes

**V3 Protocol (API level ≥ 3) — 3 bytes per hold:**
```
[position_lo, position_hi, color_byte]
  position: 16-bit little-endian LED address
  color: 0bRRRGGGBB where R = hex/32, G = hex/32, B = hex/64
    packed as: (R << 5) | (G << 2) | B
```
Packet type markers: R=first(82), Q=middle(81), S=last(83), T=only(84)

**V2 Protocol (API level < 3, e.g. homewall) — 2 bytes per hold:**
```
[position_lo, color_and_position_hi]
  position: 10-bit (max 1024 holds)
  color: power-scaled RGB packed into upper 6 bits
    byte2 = (rScaled << 6) | (gScaled << 4) | (bScaled << 2) | posHigh
    where scaledColor = floor(scale * colorValue / 64)
    scale defaults to 1.0 (full brightness)
```
Packet type markers: N=first(78), M=middle(77), O=last(79), P=only(80)

**Connection flow:**
```typescript
// 1. Request device by name prefix
const device = await navigator.bluetooth.requestDevice({
  filters: [{ namePrefix: "Kilter" }],
  optionalServices: [SERVICE_UUID],
});
// 2. Connect GATT → service → characteristic
const server = await device.gatt.connect();
const service = await server.getPrimaryService(SERVICE_UUID);
const char = await service.getCharacteristic(CHARACTERISTIC_UUID);
// 3. Write 20-byte chunks with 10ms delays
for (const chunk of chunks) {
  await char.writeValue(chunk);
  await sleep(10);
}
```

---

## Data Model (IndexedDB Stores)

Key stores mirroring the Aurora API database:

```typescript
// Core climb data
interface Climb {
  uuid: string;
  name: string;
  setter_username: string;
  description: string;
  frames: string;            // "p{id}r{role}p{id}r{role}..."
  frames_count: number;
  is_draft: boolean;
  is_listed: boolean;
  layout_id: number;
  edge_left: number;
  edge_right: number;
  edge_bottom: number;
  edge_top: number;
}

// Per-angle stats (separate store, keyed by climb_uuid + angle)
interface ClimbStats {
  climb_uuid: string;
  angle: number;
  ascensionist_count: number;
  display_difficulty: number;
  difficulty_average: number;
  benchmark_difficulty: number | null;
  quality_average: number;
}

// User's ascent history
interface Ascent {
  uuid: string;
  climb_uuid: string;
  user_id: number;
  angle: number;
  is_mirror: boolean;
  bid_count: number;
  quality: number;
  difficulty: number;
  climbed_at: string;         // ISO date
}

// Physical board mapping
interface Placement {
  id: number;
  hole_id: number;
  set_id: number;
  layout_id: number;
}

interface Hole {
  id: number;
  x: number;
  y: number;
  mirrored_hole_id: number | null;
}

interface Led {
  id: number;
  hole_id: number;
  position: number;           // LED address for BLE
  product_size_id: number;
}

interface PlacementRole {
  id: number;
  name: string;               // "start" | "middle" | "finish" | "foot"
  screen_color: string;       // hex for UI rendering
  led_color: string;          // for BLE
}

interface DifficultyGrade {
  difficulty: number;
  boulder_name: string;       // "V4", "V5", etc.
}
```

---

## Project Structure

```
kilter-app/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx          # Root layout with bottom nav
│   │   ├── page.tsx            # Redirect to /randomizer
│   │   ├── api/
│   │   │   └── aurora/
│   │   │       └── [...path]/
│   │   │           └── route.ts  # CORS proxy to Aurora API
│   │   ├── randomizer/
│   │   │   └── page.tsx        # Randomizer screen
│   │   └── settings/
│   │       └── page.tsx        # Settings screen
│   ├── components/
│   │   ├── BottomNav.tsx
│   │   ├── ClimbCard.tsx       # Swipeable climb card
│   │   ├── BoardView.tsx       # Visual hold rendering
│   │   ├── GradeSlider.tsx     # Dual-handle grade range
│   │   ├── FilterPanel.tsx     # All filter controls
│   │   └── SwipeDeck.tsx       # Framer Motion swipe container
│   ├── lib/
│   │   ├── api/
│   │   │   ├── aurora.ts       # Aurora API client (login, sync)
│   │   │   └── types.ts        # API response types
│   │   ├── ble/
│   │   │   ├── connection.ts   # BLE connect/disconnect
│   │   │   ├── protocol.ts     # Packet encoding, chunking
│   │   │   └── commands.ts     # High-level: lightUpClimb()
│   │   ├── db/
│   │   │   ├── index.ts        # IndexedDB setup (idb)
│   │   │   ├── sync.ts         # Sync API → IndexedDB
│   │   │   └── queries.ts      # Filtering queries
│   │   └── utils/
│   │       ├── frames.ts       # Parse "p123r14..." strings
│   │       └── shuffle.ts      # Fisher-Yates
│   └── store/
│       ├── authStore.ts        # Token, user_id, login state
│       ├── syncStore.ts        # Last sync timestamps, status
│       ├── filterStore.ts      # Current filter selections
│       ├── deckStore.ts        # Current shuffled climb list
│       └── bleStore.ts         # BLE connection state
├── public/
│   ├── board/                  # Board images per layout/size
│   └── manifest.json           # PWA manifest
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── PLAN.md
```

---

## Implementation Phases

### Phase 1 — Skeleton & Auth
- [ ] Initialize Next.js + TypeScript + Tailwind + pnpm
- [ ] Bottom nav with two tabs (Randomizer + Settings)
- [ ] Settings page: login form → Aurora API auth
- [ ] Persist token in Zustand + localStorage
- [ ] Basic sync trigger (download climb data to IndexedDB)
- [ ] Pre-compute `has_aux_hold` and `has_aux_hand_hold` booleans per climb at sync time

### Phase 2 — Filtering & Randomization
- [ ] Build filter panel (grade range, quality, ascensionist count, recency, angle)
- [ ] Auxiliary hold filter toggles (homewall only)
- [ ] Live "X climbs match" count (debounced, non-blocking)
- [ ] Implement IndexedDB queries with compound filters
- [ ] Empty state with filter-widening suggestions when 0 results
- [ ] Fisher-Yates shuffle
- [ ] Wire "Shuffle" button to generate deck

### Phase 3 — Card Swipe UI
- [ ] Climb card component with climb info
- [ ] Board visualization (render holds on board image with colored dots)
- [ ] Framer Motion swipe deck (drag gestures, spring animations)
- [ ] Re-shuffle, back-to-filters

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
- [ ] Responsive — primarily phone, but usable on tablet

---

## Ascent Logging — Writing Back to Kilter

We want to log ascents back to the Kilter API so you can mark climbs as sent
directly from this app. Here's what the research found:

**It is technically possible.** BoardLib added write support in v0.5.0 (March 2024):
- `PUT /v1/ascents/` — log a successful send
- `PUT /v2/climbs/` — create/save a climb
- UUIDs are v4 without hyphens (32 hex chars)
- `attempt_id` is always `0` (hardcoded in both BoardLib and climbdex)
- `climbed_at` format: `YYYY-MM-DD HH:MM:SS` (use Swedish locale: `new Date().toLocaleString('sv')`)

**Why most open-source projects don't do it:**
1. **Aurora's ToS prohibits third-party API access.** Their terms explicitly ban
   reverse engineering, automated systems, and connecting to Aurora products
   outside their official apps. Write operations are more detectable than reads.
2. **Account ban risk.** Abnormal write patterns could trigger detection. Users
   risk losing access to their climbing data.
3. **Low demand.** The official app handles logging well, so third-party tools
   focus on features the official app lacks (search, filtering, randomization).
4. **Technical complexity.** The ascent endpoint requires many fields
   (`climb_uuid`, `user_id`, `attempt_id`, `angle`, `is_mirror`, `bid_count`,
   `quality`, `difficulty`, `is_benchmark`, `comment`, `climbed_at`) all in
   specific formats with no official documentation.

**Our approach:** Include ascent logging as an opt-in feature with clear warnings
about ToS risk. The API calls are straightforward (BoardLib has working
implementations to reference), but users should understand they're using an
unofficial API. We'll keep the write pattern minimal and human-like (one ascent
at a time, no bulk operations).

---

## Board Image Assets (Resolved)

Board images are available via `boardlib images kilter db.sqlite <output_dir>`,
which downloads layout images from Aurora's servers. The image filename for a
given board configuration comes from the `product_sizes_layouts_sets` table
(keyed by `layout_id`, `product_size_id`, `set_id`).

For the 7x10 homewall, we download the image once and ship it as a static asset
in `public/board/`. The `BoardView` component renders it as an SVG with the board
image as background and colored circles overlaid at hold positions — porting the
`drawBoard()` function from `climbdex/static/js/common.js`.

```
SVG structure:
  <svg viewBox="0 0 {width} {height}">
    <image href="/board/kilter-7x10.png" />
    <!-- per-hold circles, positioned from holes.x / holes.y -->
    <circle cx={x} cy={y} r={radius} fill={role.screen_color} />
    ...
  </svg>
```

Hold positions are calculated from the hole x/y coordinates scaled to the image
pixel dimensions, bounded by the climb's `edge_left/right/bottom/top` values.

---

## Reference Projects

- **[BoardLib](https://github.com/lemeryfertitta/BoardLib)** — Python library for Aurora API. The de facto reference for API endpoints, sync protocol, and BLE encoding. We'll port relevant parts to TypeScript.
- **[Climbdex](https://github.com/lemeryfertitta/Climbdex)** (local: `/Users/dtsung/documents/climbdex`, branch `darren/auxiliary-hold-filter`) — Flask + JS search engine for Aurora boards. Key reference files:
  - `climbdex/static/js/bluetooth.js` — Full BLE implementation with V2/V3 auto-detection. Port to TypeScript.
  - `climbdex/db.py` lines 293–314 — Auxiliary hold filter SQL queries. Adapt to client-side IndexedDB.
  - `climbdex/static/js/results.js` — Integration of BLE illuminate with climb data.
- **[fake_kilter_board](https://github.com/1-max-1/fake_kilter_board)** — ESP32 board simulator. Useful for testing BLE without a physical board.
