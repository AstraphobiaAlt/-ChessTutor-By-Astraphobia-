# Maximum Strength — optional native backend

Select **Checkmate style → Maximum Strength (competitive)** in Chess Tutor 1.9.
Reload the extension after updating, approve the new `nativeMessaging` permission,
then refresh the board tab. Existing modes and saved ELO settings are retained.

## What the mode does

- Uncapped search, MultiPV 1, no random mistakes or Hunter evaluation concessions.
- Uses the final UCI `bestmove`, not an older search iteration's mate claim.
- Lets Stockfish prioritize sound attacks and forced mates. No forced/instant mate
  is promised in positions where it does not exist; no strength gain is claimed
  without measured matches.
- During auto-play, when both colour-labelled web clocks are readable, passes remaining time to
  Stockfish's own adaptive time manager, reserving 250 ms per clock. Web increments
  are unknown and conservatively treated as zero. Stockfish handles search
  instability and forced replies internally. Otherwise uses Think time, with a
  one-second minimum (the ordinary modes still support instant answers).
- Attempts the native host first. If unavailable at startup, uses the existing
  browser engine and explicitly labels the fallback in Engine details. It does
  **not** pretend the fallback is multi-core or tablebase-enabled.
- Reuses the running engine and hash between moves. Native computation is outside
  the tab; navigation/tab closure ends that tab's host connection and process.

Use for analysis, bot training, or sanctioned engine matches, not hidden assistance
against human players.

## Install native Stockfish (optional, on YOUR computer)

1. Install Python 3.10+ and a trusted native Stockfish executable appropriate for
   your CPU. This repository does not bundle or download a native binary.
2. Keep the `native` folder at a stable path. Find this extension's ID at
   `chrome://extensions` (Developer mode).
3. Run, replacing the values with your actual paths/ID:

   ```sh
   python3 native/install.py --extension-id YOUR_EXTENSION_ID \
     --engine /absolute/path/to/stockfish --threads 4 --hash-mb 512
   ```

   On Windows use `python` and an absolute Windows executable path. The installer
   registers Google Chrome's user-level host on Linux, macOS, or Windows. Other
   Chromium browsers use different host registry locations; this installer does
   not register those automatically. Keep total thread and memory budgets below
   your machine's available resources.
4. Refresh the tab, then select Maximum Strength. Engine details must say
   **Native backend connected**. The engine reports its identity; this is not a
   cryptographic authenticity check. For reconfiguration, edit `native/config.json`
   or rerun the installer and refresh the tab.

No server, open network port, or browser-to-localhost request is needed. Only the
extension ID in the installed Native Messaging manifest can connect. The host
launches only the executable in its local config; web requests cannot change its
executable, network, or file paths. A failed/disconnected native search is cancelled
rather than playing a stale result. Press Analyze to reconnect (startup may fall
back to the browser engine).

### Syzygy

Install compatible `.rtbw` and `.rtbz` files yourself and pass
`--syzygy-path /absolute/path/to/tablebases` to the installer. Stockfish handles
root move selection, WDL/DTZ probing and the fifty-move rule; the host explicitly
sets `Syzygy50MoveRule=true`. Exact coverage requires the relevant files and a
supported position. A configured path is **not** evidence of a tablebase hit.
No tablebases are shipped; large tablebase sets should not be committed to Git.

Web analysis currently sends a FEN, not the complete game history. FEN preserves
the halfmove clock but cannot encode repetition history. Missing board API FENs
may use the existing DOM-derived fallback. For rigorous match results use the
harness below, which supplies complete legal move histories.

## Paired engine matches

```sh
python3 -m venv .venv
.venv/bin/pip install -r native/requirements.txt
.venv/bin/python native/match.py --candidate /path/to/new/stockfish \
  --baseline /path/to/reference/stockfish --rounds 50 \
  --seconds 30 --increment 0.3 --threads 1 --hash-mb 64 \
  --openings /path/to/openings.fen
```

Each opening is played twice with colours reversed. Both engines receive equal
threads/hash, clocks/increment and tablebase settings. Hash is cleared between
games, retained between moves. Output: `native/results/games.pgn` and
`summary.json` with candidate score, per-game termination, time forfeits,
configuration and an approximate 95% interval over opening-pair scores.

The default repeats the starting position: useful as a smoke test, **not** a
representative strength benchmark. Supply diverse legal FENs, many pairs and
repeated independent runs. Small samples, repeated openings, and zero-variance
scores make the approximate interval unreliable. Ply-cap draws are adjudicated
and explicitly labelled. No change is automatically promoted based on this report.
Run different configurations/binaries as candidate and baseline; this harness
measures native engine play, not browser UI or Hunter policy overhead.

`--ponder` enables python-chess/UCI pondering for **both** engines in this local,
controlled match environment. It is disabled by default to avoid shared-machine
CPU contention. Web-board pondering is deliberately not enabled: the extension
cannot reliably establish opponent-turn permissions and full move history there.

## Tests

```sh
node tests/maximum.test.js
python3 tests/native_test.py
# Integration suite needs jsdom:
npm install --no-save --package-lock=false jsdom
node tests/panel-logic.test.js
```

The host uses only Python's standard library. `python-chess` is needed only for
the match harness. Actual multi-core performance, installed Syzygy coverage, and
Chrome OS integration must be checked on your machine.
