# Maximum Strength — optional native backend

Select **Checkmate style → Maximum Strength (competitive)** in Chess Tutor 1.10.
Reload the extension after updating, approve the new `nativeMessaging` permission,
then refresh the board tab. Existing modes and saved ELO settings are retained.

## What the mode does

- Uncapped search, MultiPV 1, no random mistakes or Hunter evaluation concessions.
- Uses the final UCI `bestmove`, not an older search iteration's mate claim.
- Lets Stockfish prioritize sound attacks and forced mates. No forced/instant mate
  is promised in positions where it does not exist; no strength gain is claimed
  without measured matches.
- Sends the **start position plus every move** (`position startpos moves …`), so
  Stockfish sees repetition history (see *Move history* below).
- During auto-play, the **clock adapter** gives Stockfish's own time manager
  `wtime/btime/winc/binc` (see *Clocks* below). If the clock data is uncertain,
  it falls back to Think time (one-second minimum) and shows why.
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

## Move history

A FEN describes one position, not how the game got there. The extension now
rebuilds the game's move list and sends `position startpos moves …` for every
search (all modes, browser and native engines):

- Each stable board reading must be one legal move (or two, for an instant
  premove reply) from the previous one. A repeated position is still a legal move,
  so repetitions are recorded. A return to an earlier position that is *not* one
  move away truncates the history (takeback / analysis navigation). Anything
  else starts a new history (new game).
- The history is **complete** when it starts at the initial position, or when its
  oldest position lies at or before the last irreversible move (halfmove clock).
  No earlier position can recur, which is also as far back as Stockfish looks.
- Joined mid-game, the board's own move list (if the page exposes one) is replayed
  with the extension's legal-move generator and used **only** if it reaches exactly
  the current position. Otherwise the FEN is sent and the panel says repetitions
  before the first seen position are unknown.
- The command is shortened (losslessly, to the last irreversible move) only if it
  would exceed the 16 KB transport limit.
- Standard chess only: Chess960 castling is not generated, so such games fall back
  to FEN (honestly labelled).

Proof against a real engine (`tests/native_test.py`, with `CT_STOCKFISH` set): in a
queen-down position where the losing side can repeat for the third time,
FEN-only Stockfish scores it as lost; with the move history it plays the
repeating move and scores it 0.00.

## Clocks

During Maximum Strength auto-play the clock adapter reads:

- **Both remaining times.** Exactly one white and one black clock, each with one
  readable time. Its display resolution (whole seconds, or tenths under 20 s) is
  part of the reserve.
- **The running side.** The page's active-clock marker, or failing that, the one
  clock seen ticking in the current position. It must match the side to move.
- **The increment.** From the game's PGN `TimeControl` and/or a time-control label.
  Sources that disagree, or a declared value contradicted by two observed clock
  jumps after our moves, make it *unknown*. Without a declaration, three tight
  observations agreeing on the same second are accepted.
- **Move-submission latency.** Measured from the engine's `bestmove` to the board
  accepting the move. Reserve = 1.5 × the worst of the last 8 measurements + 100 ms
  (range 250 ms–5 s; 500 ms before anything is measured) + display resolution.

The reserve comes off our clock, and the read age comes off the running clock.
Stockfish then allocates its own time. Missing, ambiguous, or contradictory clocks
fall back to Think time, and the panel's *Clock* line shows the reason. An unknown
increment is sent as 0, the conservative bound, and labelled.

## Pondering on the web board (opt-in)

When the native host allows it, Stockfish searches during the opponent's turn:

1. After our move, Stockfish's `bestmove … ponder X` (or the PV's second move)
   gives the expected reply. Once our move is on the board, the extension sends
   `position <history> X` + `go ponder …` with the current clocks.
2. If the opponent plays X (the history matches exactly), it sends `ponderhit`.
   The same search continues and its move is played. Its elapsed time includes the
   pondering, so it never overspends our clock.
3. Any other reply, a takeback, a new game, a page change, or switching auto-play
   or pondering off sends `stop`. The ponder answer is **discarded** and a normal
   search runs on the real position.

Pondering only runs when **all** of these hold, and the panel names the first
that fails: the panel switch *Ponder on opponent's time* is on, Maximum Strength,
auto-play, the native backend, a host installed with `--allow-ponder`, an engine
with a `Ponder` option, a complete move history, and certain clock data. It uses
CPU during the opponent's time. Whether pondering is permitted is a rule of the
match, so it is off on both sides by default:

```sh
python3 native/install.py --extension-id YOUR_EXTENSION_ID \
  --engine /absolute/path/to/stockfish --threads 4 --hash-mb 512 --allow-ponder
```

(or set `"ponder": true` in `native/config.json`). Without it, the host refuses
`go ponder`, `ponderhit` and `setoption name Ponder value true`. The host now
accepts only the exact grammar of the UCI commands the extension uses.

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
CPU contention. Web-board pondering is the opt-in described above.

## Tests

```sh
node tests/game.test.js
node tests/maximum.test.js
python3 tests/native_test.py
# Integration suite needs jsdom:
npm install --no-save --package-lock=false jsdom
node tests/panel-logic.test.js
# Optional: real-engine checks (repetition draw, go ponder / ponderhit / stop, and
# the extension's full ponder flow through native/host.py):
CT_STOCKFISH=/path/to/stockfish python3 tests/native_test.py
CT_STOCKFISH=/path/to/stockfish node tests/panel-logic.test.js
```

The host uses only Python's standard library. `python-chess` is needed only for
the match harness. Actual multi-core performance, installed Syzygy coverage, and
Chrome OS integration must be checked on your machine.
