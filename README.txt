CHESS TUTOR 1.3
Load this folder unpacked (chrome://extensions > Developer mode > Load unpacked), then open any chess.com page
(e.g. https://www.chess.com/analysis).
The engine is downloaded when the page loads (Stockfish 18 first, then 17.1, then 10). The panel shows what the
engine itself reports as its name - if it does not say "Stockfish 18 confirmed", it is not running SF18.
The tutor runs on every chess.com page, including live and daily games.

AUTO-PLAY (new in 1.3)
Switch "Auto-play" on and the tutor plays the moves itself, for whatever "Show moves for" is set to (your side by
default), at the selected play level - the same move the panel would show for that level, mistakes and all.
"Play speed" is the rhythm it plays at:
    0        instant - a move the moment the engine has one (no waiting for a deeper search at all)
    0.3      about one move every third of a second
    1        about one move per second, with the engine thinking for up to that long
Everything it plays goes through chess.com's own board object and is checked against the board's legal move list
first, so a stale or wrong move is refused instead of forced. If the board ignores a move, the tutor tries it
again a couple of times and then stops and says so in the status line. Auto-play only ever moves for the side the
panel is analysing, so "Show moves for: Side to move" means both colours.
Note: auto-playing in live games against another person is against chess.com's fair-play rules and can get the
account closed. Bot games, analysis boards and playing both sides yourself are what this is for.

MAX TIME 0 = INSTANT (new in 1.3)
The Max time slider now goes down to 0 and moves in 0.1s steps, because 0.2s felt like half a second. 0 means
instant: instead of waiting out a clock, the panel takes the engine's first complete result and stops the search
there, so the answer (and the move, with auto-play on) is out in a blink. Any value above 0 is a real time cap,
so 0.1 and 0.2 are usable in between. With auto-play on at play speed 0, a move never waits on the clock either,
whatever Max time is set to.

MOVING THE PANEL (new in 1.2)
There is no tuck button any more - you move the panel by dragging its title bar, and the screen edges do not stop
it. Push it half past a wall and it stays there; push it further and only a slim grab strip is left on screen.
Grab that strip (or hover / tap it) and the panel slides back out; drag or push it back on screen and it is whole
again. Corners work too, and it behaves the same in every mode and on every page the tutor runs on. "Hide" and
the "Chess Tutor" button still show and hide the panel completely.

(dev) panel geometry is unit-tested: node tests/panel-geom.test.js
(dev) auto-play pacing, instant searches and the level pick are unit-tested: node tests/autoplay.test.js
