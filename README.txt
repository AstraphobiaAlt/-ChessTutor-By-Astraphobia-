CHESS TUTOR 1.4
Load this folder unpacked (chrome://extensions > Developer mode > Load unpacked), then open any chess.com page
(e.g. https://www.chess.com/analysis).

The engine is downloaded when the page loads (Stockfish 18 first, then 17.1, then 10). The panel shows the
name that the engine itself reports. If it does not say "Stockfish 18 confirmed", it is not running SF18.

AUTO-PLAY
Switch "Auto-play" on and the tutor plays moves itself for the selected "Show moves for" side. It only attempts
a move when it is genuinely that side's turn, checks the current board position again before playing, and sends
the move through chess.com's own legal-move list. A stale or illegal move is refused instead of forced.

Auto-play ELO is independent from the normal Play level. It controls the depth preset used for auto-play:
    400 through 2500  progressively deeper ELO-style search presets
    Full engine (max)  unrestricted depth, bounded by Max time
Auto-play does not add random mistakes after the search: it uses the best move found at that ELO so that a
known mating line is never deliberately thrown away.

IMMEDIATE DISPATCH AND MATE PRIORITY
There is no Play speed setting. When auto-play is enabled, the extension watches the board and sends a legal
move immediately after its engine result and final stale-position check; it does not insert a pacing timer.
Browser scheduling, Stockfish search, chess.com board updates, and network/game-clock handling are physical
limits, so no browser extension can truthfully guarantee a sub-nanosecond end-to-end move.

When Stockfish reports one or more winning mate scores, auto-play explicitly selects the smallest positive mate
score among its candidate lines: the shortest engine-verified forced mate. If it has not found a forced mate,
it selects the top engine line at the chosen Auto-play ELO. To find deeper mates, raise Auto-play ELO and/or Max
time. A forced mate cannot be mathematically guaranteed until the engine has searched it sufficiently deeply.

MAX TIME 0 = FIRST COMPLETE RESULT
The Max time slider goes down to 0 and moves in 0.1s steps. Zero means the first complete engine result is used
and the search is stopped; it is fast but may not see a deeper forced mate. Any value above 0 is a real engine
search cap. Auto-play still has no added move-dispatch delay at every Max time.

MOVING THE PANEL
Move the panel by dragging its title bar. The screen edges do not stop it: push it half past a wall and it stays
there; push it further and a slim grab strip remains on screen. Hover, tap, or drag the strip to bring the panel
back. "Hide" and the "Chess Tutor" button still show and hide the panel completely.

FAIR PLAY
Auto-playing in live games against another person is against chess.com's fair-play rules and can get an account
closed. Bot games, analysis boards, and playing both sides yourself are what this is for.

(dev) panel geometry is unit-tested: node tests/panel-geom.test.js
(dev) auto-play limits, immediate dispatch rules, and mate selection are unit-tested: node tests/autoplay.test.js
