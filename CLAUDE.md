# Kilter Board Mobile Web App

Mobile web app for the Kilter climbing board — climb randomizer workflow:
sync climbs, filter by grade/criteria, get a shuffled list, swipe through them,
and light them up on the physical board via Bluetooth.

## Dev Setup

```bash
pnpm dev   # starts on http://localhost:3000
```

### Visual testing with Playwright CLI

Playwright CLI is installed globally and configured as a Claude Code skill
in `.claude/skills/playwright-cli/`.

```bash
playwright-cli open http://localhost:3000 --browser=chrome
playwright-cli resize 390 844              # mobile viewport
playwright-cli snapshot                    # accessibility tree (primary inspection)
playwright-cli screenshot --filename=x.png # visual check
playwright-cli click e15                   # click by ref from snapshot
playwright-cli close
```

- Use `snapshot` as the primary way to inspect page state (faster and more
  reliable than screenshots for asserting content).
- Refs like `e15` come from snapshot YAML and change on every page load —
  always take a fresh snapshot before clicking.
- Use `screenshot` sparingly for visual layout verification.

#### Seeding test data (IndexedDB + localStorage)

The app uses lazy DB initialization — IndexedDB stores are only created when
the app first calls `getDB()`. The randomizer page only triggers DB init when
both auth AND sync state are set (otherwise it shows a placeholder message).

**Important**: The app's `getDB()` opens the DB with a specific version number.
If you call `indexedDB.open('kilter-app')` without a version before the app
does, it creates a version 1 empty DB that blocks the app's versioned upgrade.
Always let the app open the DB first by setting localStorage and reloading.

Also: after changing `DB_VERSION` or the upgrade handler in `lib/db/index.ts`,
Turbopack may serve stale code. Close the browser (`playwright-cli close`) and
reopen to get a clean in-memory DB. If stores are still missing, `touch` the
file and retry.

```bash
# 1. Set auth + sync state in localStorage (both required for filter panel)
playwright-cli run-code "async page => {
  await page.evaluate(() => {
    localStorage.setItem('kilter-auth', JSON.stringify({
      state: { token: 'fake-token', userId: 12345, username: 'testuser', isLoggedIn: true },
      version: 0
    }));
    localStorage.setItem('kilter-sync', JSON.stringify({
      state: { lastSyncedAt: '2024-01-01T00:00:00.000Z', isSyncing: false, syncProgress: null, syncError: null },
      version: 0
    }));
  });
}"

# 2. Reload so the app picks up auth/sync AND initializes IndexedDB
playwright-cli goto http://localhost:3000/randomizer

# 3. Verify DB is ready (should show all stores at correct version)
playwright-cli run-code "async page => {
  const result = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('kilter-app', 2);
      req.onsuccess = () => {
        const db = req.result;
        const names = [];
        for (let i = 0; i < db.objectStoreNames.length; i++) {
          names.push(db.objectStoreNames[i]);
        }
        db.close();
        resolve({ count: names.length, names });
      };
      req.onerror = () => reject(req.error);
    });
  });
  return JSON.stringify(result);
}"

# 4. Seed IndexedDB — specify version 2 to match app's DB
playwright-cli run-code "async page => {
  const result = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('kilter-app', 2);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['climbs', 'climb_stats'], 'readwrite');
        // ... put test data ...
        tx.oncomplete = () => { db.close(); resolve('ok'); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
  return result;
}"

# 5. Reload AGAIN so the app reads the seeded data with a fresh connection
playwright-cli goto http://localhost:3000/randomizer
```

#### Clearing IndexedDB

`indexedDB.deleteDatabase()` will hang indefinitely if the app holds an open
connection. Close the browser and reopen it instead:

```bash
playwright-cli close
playwright-cli open http://localhost:3000 --browser=chrome
```

This works because the default session uses an in-memory profile.

### Climb library / snapshot data

`public/data/db-snapshot.json` is the shared climb library the app loads into
IndexedDB on first run. It is generated (and gitignored) from the committed
`data/climb-library.json`, which holds only shared tables (no personal
ascents/circuits/tags):

```bash
pnpm snapshot-from-backup            # regenerate from data/climb-library.json
pnpm snapshot-from-backup backup.json # regenerate from an app backup export
```

`pnpm dev` and `pnpm build` run this automatically with `--if-missing`, so a
fresh clone or a Docker deploy gets the library without any manual step. When
Aurora comes back, `pnpm generate-snapshot` can refresh it from the API.

### Hold usage stats

`public/data/hold-stats.json` (also generated + gitignored, ~234 KB raw /
~46 KB gzipped) powers the tooltip shown while you pick a role for a hold in
the climb editor. For every angle it stores, per board placement:

- how many climbs at that angle use the hold (popularity)
- a 24-bucket histogram of those climbs' grades (bucket 0 = difficulty 10)
- how often it is used as a hand / foot / start / finish hold

```bash
pnpm hold-stats                       # regenerate from data/climb-library.json
pnpm hold-stats --if-missing          # skip when newer than the library
```

Grading follows the app's own rounding (`difficultyToGrade` → `Math.round`),
and the climb filter is shared with the snapshot generator via
`scripts/lib/climb-library.ts`, so the two files always describe the same set
of climbs. Role names map to categories with the same name matching as
`InteractiveBoardView` (`scripts/hold-stats.ts` `roleCategory`); role colours
live in `src/lib/holdStats.ts` (`ROLE_COLORS`) so the tooltip and the radial
menu always match.

`src/lib/holdStats.ts` loads and summarizes it on the client;
`src/components/HoldStatsPanel.tsx` renders the tooltip, which sits above the
radial role menu (below it when the hold is too close to the top of the board)
and includes a magnified view of the hold on its left.

### Climber body overlay (beta planner)

The person button in the climb editor's header toggles a poseable climber drawn
over the board, to sanity-check reach and weight before you commit to a set of
holds. Tapping and holding is not needed — plain drags:

- drag the **torso or head** to move the climber
- drag a **hand or foot** onto a hold to pin it there, or onto bare wall to make
  it a **smear**
- the **size** button opens height (56"–80", default 5'7") and ape-index
  (−4" to +6") steppers

Each limb is a two-bone chain solved with inverse kinematics. Limbs keep their
targets when the body moves, so they stretch and then flag **"out of reach"**
once the distance exceeds the reach — which is how the overlay answers "how
extended would this be?". A limb with no target hangs, and with no contacts at
all the body just floats. `Hands N% · Feet M%` plus a per-limb percentage and a
green→red colour ramp give the load distribution.

**All geometry is in board inches**, not pixels: `hole.x`/`hole.y` are already
inches, and the board drawing is uniformly scaled (`xSpacing ≈ ySpacing ≈
12.27` SVG units per inch for the layout-8 homewall image), so the model can use
real anthropometry. `src/lib/bodyModel.ts` holds the proportions (arm span =
stature, shoulder joint at 0.818 H, hip joint at 0.530 H), the IK, the
auto-assignment and the load heuristic; `src/components/BodyPositioner.tsx` is
the overlay, rendered as a second `<svg>` with the same `viewBox`,
`preserveAspectRatio` and padding classes as the board so the two coordinate
systems line up exactly. We view the climber from behind, so `lh`/`lf` are at
−x and `rh`/`rf` at +x.

The load model is a **heuristic, not a rigid-body solve**: each contact's share
is proportional to `1 / (horizontal distance to the centre of mass + 0.15 H)`,
damped when the contact sits above the centre of mass (those only pull) and
scaled by how vertically stacked the limb is over its own joint. It matches
intuition at the extremes — standing over two footholds puts ~70% on the feet,
hanging with nothing underneath puts 100% on the hands.

While the overlay is open the board SVG gets `pointer-events: none`, so hold
editing cannot happen underneath it.

## Working Style

- **Test-driven**: verify with Playwright screenshots after each change
- **Commit often**: one commit per logical change, even small UI tweaks
- **TypeScript check**: run `npx tsc --noEmit` before committing
- **Dev server logs**: `tail /tmp/kilter-dev.log` to check API proxy requests

## Tech Stack

- **Next.js** (App Router) — file-based routing, API routes for CORS proxy
- **TypeScript** — type safety across API types, BLE messages, UI state
- **Tailwind CSS** — mobile-first utility classes
- **Framer Motion** — swipe gestures, spring physics, layout animations
- **Zustand** — lightweight persisted state
- **IndexedDB** (via `idb`) — client-side climb database for offline/fast filtering
- **Web Bluetooth API** — native browser BLE for board communication
- **pnpm** — package manager

### Platform target

Android Chrome + desktop Chrome only. Web Bluetooth is not supported on
Safari/iOS. This is a personal tool, so the limitation is accepted.

## Aurora API Gotchas

- **Circuit colors** are stored as 6-char hex without `#` (e.g. `FF0000`,
  `00CC00`). The APK prepends `#` at render time. Black (`000000`) is remapped
  to gray (`808080`), pure blue (`0000FF`) to brighter blue (`0080FF`).
  See `normalizeCircuitColor` in `queries.ts`.
- **Circuit climbs** sync via the `circuits_climbs` user table — there is no
  `GET /circuits/{uuid}` endpoint (returns 404). Writing uses
  `POST /circuit_climbs/save` with `circuit_uuid` + repeated `climb_uuids[]`.
- **IndexedDB schema** is at version 2. Version 1 stores: climbs, climb_stats,
  placements, holes, leds, placement_roles, difficulty_grades,
  product_sizes_layouts_sets, ascents, sync_state. Version 2 adds: circuits,
  circuits_climbs.
- **APK decompiled source** is at `/tmp/kilter-apk/decompiled_full/` — useful
  for checking data formats, color constants, endpoint behavior.

## Hosting

Deployed on Fly.io (`kilter-darrent.fly.dev`). Public hostname is
`kilter-app.darrentsung.com` via a Cloudflare Tunnel running on a local
machine (`~/.cloudflared/`, LaunchAgent `com.darrent.cloudflared-kilter`).

Note: the tunnel was originally added on the theory that Aurora blocks
Vercel's datacenter IPs. That theory is **not confirmed**, and the tunnel
is not required for the app to function — `kilter-darrent.fly.dev` serves
the UI directly. The tunnel does add a hard dependency on the local
machine being awake. Consider repointing the hostname at Fly directly
(Fly custom domain + Cloudflare DNS) and retiring the tunnel.

See "Aurora API outage" above before attributing proxy failures to IP
blocking.

## Aurora API outage (observed 2026-09-12)

`kilterboardapp.com` resolves (IONOS, 74.208.236.228) and TCP :443
accepts connections, but the TLS handshake is rejected with `alert 80`
(`ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`). Identical failure from a
residential IP and from Fly, so this is **not** IP-based blocking.

Effect: all `/api/aurora/*` routes return 502. Locally cached IndexedDB
data still powers filtering and the randomizer; syncing and ascent
logging are unavailable until Aurora recovers.

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout with bottom nav
│   ├── page.tsx                # Redirect to /randomizer
│   ├── api/aurora/[...path]/
│   │   └── route.ts           # CORS proxy to Aurora API
│   ├── randomizer/
│   │   └── page.tsx           # Filter panel ↔ swipe deck
│   └── settings/
│       └── page.tsx           # Auth, angle, sync, debug
├── components/
│   ├── BottomNav.tsx          # Two-tab bottom navigation
│   ├── AscentModal.tsx        # Bottom-sheet for logging ascents
│   ├── CircuitPicker.tsx      # Bottom-sheet circuit selector
│   ├── ClimbCard.tsx          # Climb info + board visualization + actions
│   ├── BoardView.tsx          # SVG board image + colored hold circles
│   ├── InteractiveBoardView.tsx  # Hold editing + radial role menu + tooltip
│   ├── HoldStatsPanel.tsx     # Per-hold popularity/grade/role tooltip
│   ├── BodyPositioner.tsx     # Poseable climber overlay (reach + load)
│   ├── FilterPanel.tsx        # Grade/quality/ascent/recency/aux filters
│   └── SwipeDeck.tsx          # Framer Motion drag + AnimatePresence
├── lib/
│   ├── api/aurora.ts          # Login, ascent logging, circuit management
│   ├── bodyModel.ts           # Anthropometry, limb IK, load heuristic
│   ├── holdStats.ts           # Hold usage stats loader + summarizer
│   ├── db/
│   │   ├── index.ts           # IndexedDB schema v2 (idb) — 12 stores
│   │   ├── sync.ts            # Sync engine + aux flag computation + grade seeding
│   │   └── queries.ts         # Filter queries + count + circuit cache
│   └── utils/
│       ├── frames.ts          # Parse "p123r14..." strings
│       └── shuffle.ts         # Fisher-Yates
└── store/
    ├── authStore.ts           # Token, userId, username (persisted)
    ├── syncStore.ts           # Last sync time, progress (persisted)
    ├── filterStore.ts         # Grade range, quality, ascents, recency, aux (persisted)
    ├── dislikeStore.ts        # Disliked climb UUIDs (persisted)
    └── deckStore.ts           # Shuffled climb list, current index, logged UUIDs
```
