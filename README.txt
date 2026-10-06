CHESS TUTOR 1.5
Load this folder unpacked (chrome://extensions > Developer mode > Load unpacked), then open any chess.com page
(e.g. https://www.chess.com/analysis).

The engine is downloaded when the page loads (Stockfish 18 first, then 17.1, then 10). The panel shows the
name that the engine itself reports. If it does not say "Stockfish 18 confirmed", it is not running SF18.

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
(dev) the panel wiring end to end (jsdom + fake UCI engine) is tested: node tests/panel-logic.test.js
      it needs jsdom once - npm install --no-save jsdom - and skips itself when jsdom is missing
