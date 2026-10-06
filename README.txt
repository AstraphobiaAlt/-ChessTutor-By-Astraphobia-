CHESS TUTOR 1.6
Load this folder unpacked (chrome://extensions > Developer mode > Load unpacked), then open any chess.com page
(e.g. https://www.chess.com/analysis).

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
page's Cache Storage: the next visit starts the engine from disk instead of downloading 95 MB again (if that
cache is missing or was cleared, it simply downloads once more).

The panel's engine line shows what the engine itself reported, e.g. "id name Stockfish 19 WASM by the Stockfish
developers" plus "✓ Stockfish 19 confirmed (engine reported it)". A lite fallback says "- lite net" in the same
line, and anything unverified is marked as such.

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

CHECKMATE STYLE
    Mate in the fewest moves   when the search proves a win, the shortest engine-verified mate is taken - even if
                               it was not line 1 of the MultiPV list. A proven mate is never traded away.
    Regular best move          no mate hunting: it plays the top line of the search, which is often a long, quiet
                               win instead of the fastest one.
What it can prove is bounded by the level's depth, so deeper mates need a higher level; Think time buys the
search those deeper iterations. "Full engine" plus a few seconds is what finds long forced mates.

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
(dev) think time / played-depth / mate + mistake policy and the search limits are unit-tested: node tests/autoplay.test.js
(dev) which build of Stockfish is fetched first, the mirrors/fallbacks, the sha256 pins, unpacking the npm
      tarball and the engine cache are unit-tested: node tests/engine-frame.test.js
(dev) the panel wiring end to end (jsdom + fake UCI engine) is tested: node tests/panel-logic.test.js
      it needs jsdom once - npm install --no-save jsdom - and skips itself when jsdom is missing
