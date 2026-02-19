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

Self-hosted via Cloudflare Tunnel (`kilter-app.darrentsung.com`) because
the Aurora API blocks requests from Vercel's datacenter IPs.

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
│   ├── FilterPanel.tsx        # Grade/quality/ascent/recency/aux filters
│   └── SwipeDeck.tsx          # Framer Motion drag + AnimatePresence
├── lib/
│   ├── api/aurora.ts          # Login, ascent logging, circuit management
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
