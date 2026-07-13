# Command Centre Launcher — one click to operational truth

## Install (once)

```powershell
powershell -ExecutionPolicy Bypass -File launch\operations\create-desktop-shortcut.ps1
```

Creates **"Catch Comics Command Centre"** on your Desktop, plus a **"Catch Comics — Operations"** folder containing Command Centre, Smoke Test V4 and Production shortcuts.

## What one click does

1. Finds the repo (the scripts locate it relative to themselves — survives folder moves).
2. `npm run launch:health` — read-only data/trust snapshot (needs `.env.local`; ~30s).
3. `npm run launch:smoke` — 20 public production checks (~15s).
4. Ensures the Mission Control static server is running on **localhost:8317** (reuses an existing one — never starts a duplicate; complains clearly if something else holds the port).
5. Opens **Mission Control** in your default browser — only after the server actually responds.

Every result is printed with an explicit **PASSED / PASSED WITH WARNINGS / FAILED**, and on any failure the window **stays open** (never closes on red). Mission Control then shows the same results with timestamps, plus its deep links to GitHub, Vercel, the runbook, health reports, incident response and rollback.

## What it will never do

No retailer syncs, no enrichment, no cover backfills, no paid API calls, no production database writes. It runs exactly the two read-only launch commands and a localhost static file server.

## Daily workflow (launch week)

1. Double-click **Catch Comics Command Centre**.
2. Watch the two check results (green = carry on; red = window stays open, follow [incident-response.md](incident-response.md)).
3. Mission Control opens — read the **Operations & health** panel and the next-action box.
4. Tick anything you've genuinely completed; action the top item.
5. Close the window. Done — ~10 minutes with coffee.

## Notes

- The "Smoke Test V4" shortcut uses the same launcher with `-SkipChecks` — instant open, still guarantees the server.
- The static server stays running between uses (that's fine — it serves local files only). To stop it: close the minimised `http-server` window or end the `node` task holding port 8317.
- Flags for scripting: `-SkipChecks`, `-NoBrowser`, `-NonInteractive`, `-Page <file.html>`.
