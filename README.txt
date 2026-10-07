CHESS TUTOR 1.8.1
Load this folder unpacked (chrome://extensions > Developer mode > Load unpacked), then open any chess.com page
(e.g. https://www.chess.com/analysis).

UPDATE 1.8.1 (hunter audit - see HUNTER-AUDIT.md for the measurements)
The aggressive hunter was re-measured on 238 real positions against a strong reference search. The style is
aggressive (it leaves the engine's top line in about 70% of positions) and its mate handling is sound; the audit
found one defect with a user-visible effect and two hardening fixes, none of which changes the style itself:

* Defect: the quiet fallback could play a move the same search had just scored far outside the risk dial. When no
  attacking candidate passed the dial, the hunter used to play line 1 of its pool no matter what that line
  scored - and at a low level line 1 is the depth-1 line, so a 400 ELO hunter could answer a 12-candidate search
  with a move that search had already scored a piece down. It now plays the best line the hunter can see; the
  level's own top line still wins whenever it is inside the same budget, so ordinary positions still play at the
  level's strength. Before the fix: 1 blunder and 6 mistakes (>=1.5 pawns) in 238 positions at 400 ELO; after:
  0 blunders and 2 mistakes (those two are deliberate baits at the "Very aggressive" setting - see below).
* Hardening: the pool could lose the deep proof. A wide list at the level's depth could fill the whole
  pool before the deepest iteration was read; a third of it is now reserved for the deep iteration, so the
  mate the level is too shallow to see always has a seat at the table.
* Hardening: the forced-mate rule now runs in one place, before the style split, instead of inside the hunter
  branch. It was not broken (the hunter checked its own pool for a mate first), but the mate check and the
  aggression pick lived in the same function, where any later filter could have been put in front of it - and
  the audit's mate run proved the promise ("the mate in the fewest moves, including one only the deepest
  iteration proved") holds for every style, so it is now pinned there.

WHAT THE AUDIT SAYS ABOUT "VERY AGGRESSIVE" (the default risk dial)
The dial is the engine's own evaluation, but it is measured by the search that produced the candidate - and the
real cost shows up when a deeper search looks again. On the 74 positions where the dial changes the pick:

    Sound (0.3)             mean 14 cp, worst 103 cp, 0 picks >=150
    Balanced (0.6)          mean 31 cp, worst 104 cp, 0 picks >=150
    Very aggressive (1.2)   mean 70 cp, worst 252 cp, 3 picks >=150 (all of them baits)

So "Very aggressive" is where the moves that look like blunders come from, and the bait - a piece offered on
purpose - is the riskiest part (3 baits, mean 121 cp true cost). Two of the three >=150 cp picks are the two
"mistakes" a user reported with Natural mistakes off: in hunter mode the mistake roll is skipped by design, so
what looked like a slip was the style's own aggression pick, and the panel labels it ("hunter: check + bait (5 pts
offered)"). If you want the attack without that price, set Hunter risk to Sound or Balanced (or give it a longer
Think time: with 5s instead of 1.2s the same position picked a sound move).
Mate handling itself held up: on every mate position the hunter, the fewest-move style and the regular style all
took the mate, at Full engine and at 400 ELO, and the hunter at 400 even found the faster mate in two of them.

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
All three styles pick the UCI move that auto-play sends and that "What would X play?" reports; none of them
changes the arrows, the evaluation or the search itself. Two of them can only act on a mate the engine's own
search actually proved (a `score mate +N` line), which is why the style can look like it does nothing in a
position with no forced win. The third one, the hunter, is the one that changes how the engine's candidates are
USED, so it acts in almost every position:

    Mate in the fewest moves   when the search proves a win, the shortest engine-verified mate is taken - even if
                               it was not line 1 of the MultiPV list. A proven mate is never traded away.
                               No mate proven -> identical move to "Regular best move".
    Aggressive hunter          every proven mate is taken (fewest moves first), AND it looks for that mate one
      (checks + bait)         level deeper than the other styles: the candidate list is the level's own depth
                               PLUS the deepest iteration the Think time reached, so a 400 ELO hunter still plays
                               a mate in 3 that only the long search proved. With no mate on the board it plays
                               for pressure instead of the quiet best line: a check, then a bait (a piece it
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
    What the dial costs when a deeper search looks again (measured on the 74 audit positions where it changed the
    pick): Sound mean 14 cp, worst 103; Balanced mean 31, worst 104; Very aggressive mean 70, worst 252, with
    three >=150 cp picks, all of them baits. The dial is measured by the search that produced the candidate, so
    a short Think time makes it optimistic - the same position that cost 1.2 pawns at 1.2s picked a sound move
    at 5s. Very aggressive is the default because it is the flashiest; Sound/Balanced is the choice when the
    move should still be objectively good.

WHAT THE HUNTER ACTUALLY DOES WITH THE ENGINE
    - it asks for 12 MultiPV candidates instead of 5, because a bait or a checking move is usually nowhere near
      line 1 of the search. MultiPV splits the same Think time over more lines, so each iteration is a bit
      slower - that is the price of the style (and it is only paid while the hunter is selected).
    - it reads the board itself (a pure attack/defence trace of the position, lib.js moveTraits) to know whether
      a candidate gives check, offers material or points at the enemy king. The tracer only classifies moves the
      engine already produced; chess.com's own legal-move list still decides what can be played.
    - the natural-mistake roll is skipped in hunter mode: an attack is a decision, not an accident (a proven mate
      was never traded away for a slip in any style).
    - the hunter's candidates come from the deepest iteration the search reached as well as the level's own depth,
      so the ELO level matters less while it is attacking: at 400 ELO + hunter + a 5s think time it plays the
      attack (or the mate) that the whole 5 seconds of searching proved, not the depth-1 line. The level's own
      top line still wins the quiet answer whenever it is inside the same risk budget; it is not allowed to win
      it while the hunter's own search scores that line outside the budget, because at a low level that excuse
      was a depth-1 line the same search had already rejected (the 1.8.1 audit). In practice that makes the
      hunter's pick level-independent in nearly every position (measured: identical at 400 ELO and Full engine
      in all 238 audit positions) - if you want the ELO to shape the move, use the two non-hunter styles, or
      Natural mistakes with them. Mistake-free: the roll stays off in hunter mode at every ELO.
    - the panel says what it saw, e.g. "hunter: check + bait (3 pts offered)" or "hunter mate M3", so an unusual
      move is explainable instead of mysterious.
What a mate-proof can reach is bounded by how deep the search got, so deeper mates still need Think time (and the
hunter also sees the deepest iteration the window reached). "Full engine" plus a few seconds finds long mates.

NATURAL MISTAKES
    On   (default) a low level sometimes picks a reasonable-looking line from the engine's candidates instead of
               its best one - 400 ELO slips often, 1800 rarely, 2000+ never. This is what makes a bot level look
               like a person rather than a machine that forgot to be weak.
    Off  it always plays the best line its search found at that level, at any ELO.
The switch also drives the "What would X play?" button, and it is skipped entirely while a proven mate is on the
board (mate mode on): a forced win is never thrown away to look more natural.

AUTO-PLAY
Switch "Auto-play" on and the tutor plays moves itself for the selected "Show moves for" side. It only attempts
a move when it is genuinely that side's turn, checks the current board position again before playing, and sends
the move through chess.com's own legal-move list. A stale or illegal move is refused instead of forced.

Auto-play ELO is independent from the normal Play level: it is the strength used for the moves it plays. Both
share Think time, and both get the natural-mistake roll (with the mate exception above). The "Move dispatch" line
in the panel reads "After 5s thinking" (or "Immediate (instant)" at 0) because that think time is the only wait
before a move goes out - there is no separate pacing timer.

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
