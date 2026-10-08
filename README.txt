CHESS TUTOR 1.9
Load this folder unpacked (chrome://extensions > Developer mode > Load unpacked), then open any chess.com page
(e.g. https://www.chess.com/analysis).

UPDATE 1.9 — MAXIMUM STRENGTH
Select Checkmate style > Maximum Strength (competitive): full-depth, single-PV search,
no simulated mistakes, no speculative Hunter concessions, final UCI bestmove selection.
Readable clocks use Stockfish time management; otherwise Think time (minimum 1 second).
An optional native Stockfish host adds configurable CPU threads/hash and local Syzygy.
Startup falls back explicitly to the browser engine if the host is unavailable.
Reload the extension and approve nativeMessaging, then refresh board tabs.
Setup, limitations and paired-match testing instructions: native/README.md.
No instant-mate or unbeatable-strength claim. Bot training/analysis/sanctioned matches only.

UPDATE 1.8
Reload the unpacked extension at chrome://extensions, approve the new unlimitedStorage permission if
prompted, then refresh chess.com tabs. Keep the same extension installed: uninstalling deletes its cache.
The large WASM now lives under the extension origin, not chess.com, with unlimitedStorage to protect it
from routine quota eviction. Redirects and clearing chess.com data no longer remove that copy. Existing
site-cache copies are migrated when found. Wait for the first download/save to finish before navigating;
an interrupted first download or manually deleted extension data can still require another download.
The small JS loader is still fetched and verified at startup. This is not a fully offline engine.

Hunter now also traces up to five own moves in each candidate's engine PV, rewarding repeated checks and
king pressure against the engine's best defence. A sustained attacking setup can outrank a single check.
This is a pressure heuristic, not a trap solver or a guarantee of mate in five. The risk limit still applies,
forced mates take priority, and the actual board is searched again after each reply (including declined baits).
For bot games/analysis try Aggressive hunter, Very aggressive, Full engine, and 5–10 seconds think time.

ENGINE
The tutor runs the strongest Stockfish it can load, in this order:

    Stockfish 19, full network   ~95 MB wasm
    Stockfish 18, full network  ~108 MB wasm
    Stockfish 19 / 18 / 17.1 Lite, small network   only if the full builds cannot be fetched
    Stockfish 10 (asm.js)                          2019 build, last resort

The full builds are the single-threaded ones ("-single"): the same network as the multi-threaded builds, so the
same strength per move - they only search on one core, because multi-threaded wasm needs COOP/COEP headers that
a chess.com page does not give a content script. The "Lite" builds (1.8 MB) carry a small network and are quite
a bit weaker; they report a Stockfish version too, which is why the panel used to say "Stockfish 18 confirmed"
while actually running one. They are only a fallback now, and the panel labels them as lite.

The first chess.com page after install downloads the engine: unpkg first, then jsDelivr, then the npm registry
tarball (gunzipped and unpacked in the page - it is the only mirror with no per-file size cap). The status line
shows the mirror and the percentage while that runs. Every file is checked against the sha256 and size that the
npm package and the v19.0.0 / v18.0.0 GitHub releases publish, and the engine's own `id name` has to agree, so a
mirror cannot hand over a lite build or something else and have it run. The verified wasm is then kept in the
extension's Cache Storage: the next visit starts the engine from disk instead of downloading 95 MB again (if that
cache is missing or was cleared, it simply downloads once more).

The panel's engine line shows what the engine itself reported, e.g. "id name Stockfish 19 WASM by the Stockfish
developers" plus "✓ Stockfish 19 confirmed (engine reported it)". A lite fallback says "- lite net" in the same
line, and anything unverified is marked as such.

WHY IT USED TO DOWNLOAD AGAIN ON EVERY REDIRECT (fixed in 1.7)
The frame runs in a sandbox with no origin of its own, so all it can hand the panel is the file NAME; the panel
is what turns that into the Cache Storage key. It used to be a relative key ('./ct-engine-<sha256>.wasm'), and
Cache Storage resolves a relative key against the page it is used on. That made one cache entry per page path:
/game/live/12345 stored the engine as /game/live/ct-engine-<sha>.wasm, while /analysis, /play/computer and /home
each looked somewhere else. So the moment chess.com redirected you off the game page - finishing a match, opening
the analysis board - the tutor saw a cache miss and downloaded the full 99 MB again, and left another 99 MB copy
behind every time. Three things fix that now:

* the key is anchored on the origin, not on the page path: https://www.chess.com/ct-engine-<sha256>.wasm, so the
  whole chess.com origin shares one copy and any redirect finds it;
* the old copies (one per path) are deleted as soon as the right entry is written or read, giving the disk space
  back and keeping the origin away from its storage quota;
* the panel asks for persistent storage once per page load, so Chrome does not evict the engine under disk
  pressure - and a slow disk read is no longer mistaken for a miss (the panel says "the file is here" before the
  bytes, and the frame waits for them).

The engine line tells you where the 99 MB came from: "(from cache)" or "(downloaded)" next to the size, plus
"cache persistent" or "cache best-effort (browser may evict it)", and "not cached: <reason>" if the browser
refused to store it. If a download still happens, that line is the answer: a new engine build (a version bump)
legitimately downloads once, clearing chess.com's site data drops the cached copy, a private/incognito window
never keeps one, and a full disk makes it best-effort.

THINK TIME (this used to be called "Max time")
Think time is how long the AI actually thinks - for an "Analyze now" click and for every auto-play move. Set it to
5 seconds and the engine searches for 5 seconds, then answers / plays. Set it to 0.3 and it thinks for 0.3s.
It is one setting for both paths, and it is independent from the ELO level:

    5s at 2500 ELO   thinks 5s, plays the 2500 ELO lines
    5s at 800 ELO    thinks 5s too, then plays the move its depth-3 look produced
    0 (instant)      no clock at all: the first complete engine result is used and the search is stopped
The slider moves in 0.1s steps, so anything from "instant" to a minute is available.

That separation matters: the ELO level no longer cuts the search short. A level used to be a depth cap, so a
"5 second think" at 400 ELO finished in about 30 milliseconds. Now the level caps which depth the answer is READ
from, and Think time decides how long the engine searches. The status line reports both, e.g.
"Thought 5.01s · played from depth 3/3 (searched to 26) · 1.9M nodes". Long think times are real CPU time in
the tab, so a low level with a 30s window costs the same as a high one.

CHECKMATE STYLE (this really decides the move - it is not a display setting)
All three styles govern the move choice used by auto-play and "What would X play?" A mate is only claimed when
the engine reports a positive `score mate +N` proof. The shortest-mate style uses those proofs but otherwise uses
the selected-level move (or a Natural mistakes deviation). The hunter also ranks non-mate candidates for pressure;
Regular always follows the top line. A selected mate or hunter attack is shown as the headline/first arrow, so the
panel's main move matches that deliberate choice. Thus mate styles may look like they do nothing in a position
with no forced win, while the hunter can still prefer a sound check or attack:

    Mate in the fewest moves   the shortest positive mate proof reported anywhere during the think-time search is
                               taken - even if it was not line 1 of the MultiPV list or was found deeper than the
                               selected ELO depth. Ordinary non-mate moves still come from the selected level, so
                               a long think does not silently turn 400 ELO into full engine. With no mate proof,
                               the selected-depth move (or a Natural mistakes slip, if enabled) is used.
    Aggressive hunter          every proven mate from the think-time search is taken (fewest moves first), even
      (checks + bait)         if it was not line 1 or was proved deeper than the selected level. With no mate it
                               plays for pressure instead of the quiet best line: a check, then a bait (a piece it
                               leaves en prise on purpose), then a move that attacks the enemy king. Every
                               candidate still has to stay within "Hunter risk" of the best line the engine can
                               see, so the attack is sound rather than reckless.
    Regular best move          no mate hunting: it plays the top line of the search, which is often a long, quiet
                               win instead of the fastest one.

HUNTER RISK (shown only while the hunter is selected)
    Sound (0.3 pawns)          only an attacking move the engine scores within 0.3 of the best line
    Balanced (0.6 pawns)       within 0.6
    Very aggressive (1.2)      within 1.2 - and twice that (2.4) when the position is already +2.5 or better,
                               which is the "the attack is winning anyway, play it" case
    The dial is not a promise to play badly: the engine's own evaluation is the guard rail, so the hunter attacks
    with sound moves. A bait that the engine scores as losing (say -3.0) is refused at every setting.

WHAT THE HUNTER ACTUALLY DOES WITH THE ENGINE
    - it asks for 12 MultiPV candidates instead of the usual 3 in analysis (5 in auto-play), because a bait or a
      checking move is often nowhere near line 1. MultiPV splits the same Think time over more lines, so each
      iteration is slower - that is the search-speed cost, paid only while the hunter is selected.
    - it reads the board itself (a pure attack/defence trace of the position, lib.js moveTraits) to know whether
      a candidate gives check, offers material or points at the enemy king. The tracer only classifies moves the
      engine already produced; chess.com's own legal-move list still decides what can be played.
    - the natural-mistake roll is skipped in hunter mode: an attack is a decision, not an accident (a proven mate
      was never traded away for a slip in any style).
    - the hunter's candidates come from the deepest iteration the search reached as well as the level's own depth,
      so the ELO level matters less while it is attacking: at 400 ELO + hunter + a 5s think time it plays the
      attack (or the mate) that the whole 5 seconds of searching proved, not the depth-1 line. The level still
      decides when nothing aggressive is available (then its own top line is played), and mistakes stay off.
    - the panel says what it saw, e.g. "hunter: check + bait (3 pts offered)" or "hunter mate M3", so an unusual
      move is explainable instead of mysterious.
What a mate-proof can reach is bounded by how deep the search got, so deeper mates still need Think time (and the
hunter also sees the deepest iteration the window reached). "Full engine" plus a few seconds finds long mates.

NATURAL MISTAKES
    On   (default) a low level sometimes makes a random deviation from the best line among the engine's candidate
               moves - 400 ELO deviates often, 1800 rarely, 2000+ never. When the deviation roll fires, it always
               chooses a different candidate (the chance matches the level's configured error rate).
    Off  disables that random deviation. The engine still uses the selected level's search depth, so a shallow
               search can miss tactics or choose a move that later looks like a mistake. A checkmate style can
               also deliberately choose a different line: shortest-mate takes a proven mate and the hunter selects
               an aggressive candidate. The hunter ignores this switch because its attacking move is intentional.
The switch also drives the "What would X play?" button. Random deviations never replace an engine-proven forced
mate: the shortest-mate and hunter styles prioritize the fastest proven mate found during the think-time search.
"Top 3 moves" only hides/shows arrows; it does not remove the candidate lines used for mate checks or random
mistakes, so hiding arrows cannot silently turn the Natural mistakes setting off.

AUTO-PLAY
Switch "Auto-play" on and the tutor plays moves itself for the selected "Show moves for" side. It only attempts
a move when it is genuinely that side's turn, checks the current board position again before playing, and sends
the move through chess.com's own legal-move list. A stale or illegal move is refused instead of forced.

Auto-play ELO is independent from the normal Play level: it is the strength used for the moves it plays. Both
share Think time. In shortest-mate and regular styles, the Natural mistakes switch controls random deviations
(with proven mates protected); the hunter ignores it because its aggressive choices are deliberate. The "Move
dispatch" line in the panel reads "After 5s thinking" (or "Immediate (instant)" at 0) because that think time is
the only wait before a move goes out - there is no separate pacing timer.

MOVING THE PANEL
Move the panel by dragging its title bar. The screen edges do not stop it: push it half past a wall and it stays
there; push it further and a slim grab strip remains on screen. Hover, tap, or drag the strip to bring the panel
back. "Hide" and the "Chess Tutor" button still show and hide the panel completely.

FAIR PLAY
Auto-playing in live games against another person is against chess.com's fair-play rules and can get an account
closed. Bot games, analysis boards, and playing both sides yourself are what this is for.

(dev) panel geometry is unit-tested: node tests/panel-geom.test.js
(dev) think time / played-depth / mate + mistake policy, the search limits and the hunter's board trace
      (check / bait / king attack, the risk dial, the deep-mate pool) are unit-tested: node tests/autoplay.test.js
(dev) which build of Stockfish is fetched first, the mirrors/fallbacks, the sha256 pins, unpacking the npm
      tarball and the engine cache are unit-tested: node tests/engine-frame.test.js
(dev) the engine cache surviving a redirect (one copy per origin, path-keyed duplicates pruned, the two-step
      cache answer) is integration-tested: node tests/panel-logic.test.js
(dev) the panel wiring end to end (jsdom + fake UCI engine) is tested: node tests/panel-logic.test.js
      it needs jsdom once - npm install --no-save jsdom - and skips itself when jsdom is missing
