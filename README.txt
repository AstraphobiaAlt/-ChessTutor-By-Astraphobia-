CHESS TUTOR 1.12
Load this folder unpacked (chrome://extensions > Developer mode > Load unpacked), then open any chess.com page
(e.g. https://www.chess.com/analysis).

UPDATE 1.12 — NO MISTAKES ARE ALLOWED (every checkmate style)
1.11 + a hard guarantee for the move-selection layer, after Full engine + auto-play + Think time 0 was caught
making real mistakes on Stockfish 19. Three holes, all closed:
    1. Instant was shallow. Think time 0 stopped the search at the engine's first complete MultiPV iteration -
       depth 1 - and played that, even at Full engine, so "the objectively best move" was a guess that hangs
       pieces. Now an instant answer waits for a complete result AT THE LEVEL'S STRENGTH: a capped level stops
       at its own read depth, and Full engine answers AT MAX DEPTH - the instant search is never stopped early,
       it runs at full speed to the end of the safety window and plays the deepest iteration reached, so the
       answer arrives the moment a max-depth result exists and no shallower one is ever played. Instant saves
       the think-time clock; it no longer replaces the engine with a shallow guess.
    2. Stale mate claims. A "score mate +N" found by an early iteration used to stay a candidate even when a
       deeper iteration of the SAME move replaced it with a normal score - the shortest-mate and hunter styles
       would then play a mate that was never real, and game review calls that a mistake. Every mate proof is
       now confirmed against the deepest search evidence for the same move before any style may take it.
    3. The hunter ignored the Natural mistakes switch. It could give up 0.3-2.4 pawns for an attack even with
       mistakes off and even at Full engine. Now the switch and the level govern EVERY style: with Natural
       mistakes off - or at any zero-error level (2000+, Full engine) - no style plays anything but the
       engine's best move, except a verified forced mate. Hunter concessions and random slips are human
       simulation and exist only with mistakes ON at a below-2000 level, each one labelled in the panel
       ("hunter: check + bait", "natural 400 ELO slip"). An attack that TIES the best move is always allowed -
       a tie is not a mistake.
Maximum Strength is unchanged (the final UCI bestmove was already authoritative there).

UPDATE 1.11 — TROLL MODE
Update 1.11 is 1.10 with a joke layer bolted on top. It is OFF by default and the whole section is hidden
until you open "Troll mode" and switch it on; with it off the tutor behaves exactly as it did in 1.10.

Two rules govern everything in it:
    1. Nothing in Troll mode changes what the engine is asked. Directives and rage tactics only choose which
       of the legal moves to play AFTER the search has answered, so the analysis path is untouched and real
       analysis cannot be broken by a joke.
    2. Every taunt, index and fake number is rendered inside your own panel. Nothing is written to the page,
       sent to chat, or shown to another player. Every readout is aimed at you.

Troll mode has three parts.

DIRECTIVES - one dumb rule, played completely sincerely
A directive filters the legal move list down to the moves that obey a single deranged constraint, then plays
the best of what survives. There are 39 of them, in six groups:

    Pawn family          pawn storm (push a pawn, any pawn) - rook pawn rampage (a- and h-pawns only) -
                         pawn pacifism (never move a pawn) - the Great Wall (no pawn past the third rank) -
                         phalanx (only a pawn beside another pawn) - leapfrog (only the most backward pawn)
    Geometry             dark-/light-square devotion - homebody (never cross the midline) - monorail (one file) -
                         elevator (no diagonals) - diagonal zealot (no straight lines) - bank rank - corner
                         office - checkerboard
    Relationships        leash law (never end a move alone) - social distancing (never end one beside a friend) -
                         wingman (stay next to the queen) - tag team (two pieces, strictly alternating) -
                         monkey see, monkey do (mirror the opponent's last move)
    Personality          berserker (capture if you can) - pacifist (never capture) - check junkie - full retreat -
                         all gas no brakes - turtle - bull in a china shop - tempo terrorist (leave them the
                         fewest legal replies)
    Piece fixation       knights of the round table - the long walk (the king walks to the far side) - the
                         queen's world tour (all four quadrants, in order) - bishop simp
    Deliberate disasters bongcloud - blunder chicken (second best, then third, until it panics) - worst legal
                         move - roll for it - magnet mode - salute mode (one good move, then the game is
                         thrown) - time troll (instant for ten moves, then thirty seconds on the eleventh)

    Sincerity       how the surviving move is chosen. "Best move that obeys" is the default and the funny one:
                    a pawn storm that pushes the BEST pawn is a character, a random pawn push is just noise.
    Chaos mode      a new random directive every N moves, announced in the panel.
    Preview         when on, the arrows and the "What would X play?" button obey the rule too, so the board
                    shows the move that is about to be played instead of the one the engine preferred.

A directive that has no legal move left (no pawns to push, no dark square to reach) is SUSPENDED for that
move: the engine's real move is played and the panel says "DIRECTIVE SUSPENDED". The breakdown is the joke,
so it is announced rather than swallowed.

THE RAGE BRAIN - win on the board AND on the clock, then refuse to engage
Not a rule but a gate. It switches the play style from "win fast" to "win annoyingly" only when you are
winning by at least the configured margin AND have at least as much time as the opponent - being annoying
takes time, so the clock is half the condition. Any missing input fails closed and says why in the panel, the
same way the tutor's clock handling does everywhere else: no clock, no siege. It then picks from:

    Denial          teflon (never end on a square they attack) - trade refusal (never capture, ever) - material
                    hoarding (refuse all simplification) - zebra cage (stay two squares from everything) - the
                    tease (offer a piece, then slide it away) - squatter's rights - no-contact fortress - wall
                    of Berlin (no pawn breaks, ever)
    Clock warfare   clock siege (fast, safe, pointless moves that force them to think) - the freeze (maximum
                    think time on every move) - denial by speed (instant, every move) - tick-tock
    Slow win        the long goodbye (the slowest forced mate; never mate in one) - the yawn (the least
                    committal legal move) - lap of honour (underpromote to a knight) - the escort (the king
                    walks a passed pawn in) - the carousel (a three-move cycle, forever) - wall of Berlin

A big clock gap wins outright: humiliation tactics need time on your clock and grinding them down needs time
off theirs, so the two are never mixed. The tactic never repeats twice running. Tactics that own a timing
(clock siege, denial by speed, the freeze) override the Think time for the next search, and the panel says
"troll timing" so the window is never a mystery.

    Frustration Index   a 0-100% bar built from what the opponent has been ALLOWED to do: captures they
                        managed, checks they landed, trades completed, entries into your half, and how
                        cramped their position is. "Pieces they have captured: 0 · moves played: 47."
    Tilt detector       watches their average move time and reports a collapse ("dropped 61%. Notable.").
                        Reported, never acted on.

PANEL PRANKS AND COMMENTARY (they troll you, nobody else)
    Confidence meter that lies   99% when the engine is winning, 4% when you are. A fabricated number.
    Loading theater              "41%... defragmenting the knights... re-teaching the bishops to move
                                 diagonally..." while the real 95 MB download runs.
    Gaslight mode                labels silently mutate: "Think time" becomes "Vibes". Cosmetic only - the
                                 control behind the label does not change.
    Runaway panel                the panel sidles away as you reach for a control. It holds still while a
                                 control has focus, so it never actually blocks you.
    The button that moves        once per session, "Analyze now" swaps places with "Hide" for one hover.
    Mirror mode                  the panel reads back to front for thirty seconds after a loss.
    Judgmental tips              the tip line stops explaining and starts commenting.
    Soundboard                   sad trombone on a blunder, airhorn on a mate, vinyl scratch on a hung queen,
                                 applause on a genuinely good move. Everything is synthesised with WebAudio,
                                 so the extension ships no media and works offline. Optional "voice quips" use
                                 your browser's own speech synthesis and are opt-in, because it talks out loud.
    Commentary                   a sports commentator, a grandpa, or an armchair GM grading every move
                                 ("B+. Solid. Boring, but solid."), plus a sarcastic eval ("+2.3 (and yet,
                                 here we are)") and ELO shaming ("That move was rated 412. You are rated
                                 1200. Math is math.").

FAIR PLAY
Troll mode adds nothing that talks to another player: no chat, no emotes, no network, nothing written to the
chess.com page. Every taunt is a line of text in your own panel. The play styles themselves sit on exactly the
same footing as auto-play already did - bot games, analysis boards, and playing both sides yourself. Auto-
playing in live games against another person is against chess.com's fair-play rules and can get an account
closed, with or without a joke attached.

(dev) directives, the Rage gate and tactics, the frustration index and the tilt detector are unit-tested:
      node tests/troll.test.js
(dev) the panel wiring - directives really change the move auto-play sends, suspended rules are announced,
      settings persist, and the Rage gate really does stay shut - is integration-tested in jsdom:
      node tests/troll-ui.test.js   (needs jsdom once: npm install --no-save jsdom)

UPDATE 1.10 — GAME CONTEXT: MOVE HISTORY, REAL CLOCKS, PONDERING
Move history: every search (all styles, browser and native engine) now gets the start position plus every
move ("position startpos moves ..."), not just a FEN, so Stockfish sees repetitions: it takes a threefold
draw when losing and avoids one when winning. The tutor follows the game move by move (each new board must be
one or two LEGAL moves from the last, otherwise it is a takeback or a new game). Joined mid-game, it uses the
board's own move list only if replaying it reaches exactly the current position; otherwise it sends the FEN
and the panel says "repetitions before the first seen position unknown". The panel's History line shows
what the engine was told.
Clocks (Maximum Strength + auto-play): both remaining times, whose clock is running, and the increment (game
TimeControl / time-control label, cross-checked against observed clock jumps) go to Stockfish's time
manager. A safety reserve (measured move-submission latency + clock display resolution) is held back.
Uncertain clock data falls back explicitly to Think time, with the reason shown. An unknown increment is
treated as 0 and labelled.
Pondering (opt-in): "Ponder on opponent's time" lets native Stockfish search the predicted reply while the
opponent thinks, then continue with ponderhit, or stop and discard if another move is played. It needs
Maximum Strength, auto-play, a complete history, certain clocks, and a native host installed with
--allow-ponder. Use it only where the match rules allow pondering. Details: native/README.md.

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
    0 (instant)      no clock at all: the search stops as soon as a complete result AT THE LEVEL'S STRENGTH
                     exists - the level's own read depth, or, for Full engine, max depth: the search runs at
                     full speed to the end of the safety window and answers from the deepest iteration reached,
                     so instant play is real play, not a depth-1 guess (see UPDATE 1.12)
The slider moves in 0.1s steps, so anything from "instant" to a minute is available.

That separation matters: the ELO level no longer cuts the search short. A level used to be a depth cap, so a
"5 second think" at 400 ELO finished in about 30 milliseconds. Now the level caps which depth the answer is READ
from, and Think time decides how long the engine searches. The status line reports both, e.g.
"Thought 5.01s · played from depth 3/3 (searched to 26) · 1.9M nodes". Long think times are real CPU time in
the tab, so a low level with a 30s window costs the same as a high one.

CHECKMATE STYLE (this really decides the move - it is not a display setting)
All three styles govern the move choice used by auto-play and "What would X play?" A mate is only claimed when
the engine reports a positive `score mate +N` proof AND the deepest search evidence for that move still confirms
it (UPDATE 1.12: a claim a later iteration refuted is dropped, never played). The shortest-mate style uses those
verified proofs but otherwise uses the selected-level move (or a Natural mistakes deviation). The hunter also
ranks non-mate candidates for pressure;
Regular always follows the top line. A selected mate or hunter attack is shown as the headline/first arrow, so the
panel's main move matches that deliberate choice. Thus mate styles may look like they do nothing in a position
with no forced win, while the hunter can still prefer a sound check or attack:

    Mate in the fewest moves   the shortest verified mate proof reported anywhere during the think-time search is
                               taken - even if it was not line 1 of the MultiPV list or was found deeper than the
                               selected ELO depth. Ordinary non-mate moves still come from the selected level, so
                               a long think does not silently turn 400 ELO into full engine. With no mate proof,
                               the selected-depth move (or a Natural mistakes slip, if enabled) is used.
    Aggressive hunter          every verified mate from the think-time search is taken (fewest moves first), even
      (checks + bait)         if it was not line 1 or was proved deeper than the selected level. With no mate it
                               plays for pressure instead of the quiet best line: a check, then a bait (a piece it
                               leaves en prise on purpose), then a move that attacks the enemy king. Every
                               candidate still has to stay within "Hunter risk" of the best line the engine can
                               see, so the attack is sound rather than reckless - and the allowance is ZERO with
                               Natural mistakes off or at a 2000+/Full engine level (UPDATE 1.12: no mistakes are
                               allowed), so there it only takes an attack that is exactly as good as the best move.
    Regular best move          no mate hunting: it plays the top line of the search, which is often a long, quiet
                               win instead of the fastest one.

HUNTER RISK (shown only while the hunter is selected)
    Sound (0.3 pawns)          only an attacking move the engine scores within 0.3 of the best line
    Balanced (0.6 pawns)       within 0.6
    Very aggressive (1.2)      within 1.2 - and twice that (2.4) when the position is already +2.5 or better,
                               which is the "the attack is winning anyway, play it" case
    The dial is not a promise to play badly: the engine's own evaluation is the guard rail, so the hunter attacks
    with sound moves. A bait that the engine scores as losing (say -3.0) is refused at every setting. The dial is
    also OFF unless it can be deliberate: with Natural mistakes off - or at a 2000+/Full engine level - the
    allowance is zero and the hunter only plays an attack that ties the best move (UPDATE 1.12).

WHAT THE HUNTER ACTUALLY DOES WITH THE ENGINE
    - it asks for 12 MultiPV candidates instead of the usual 3 in analysis (5 in auto-play), because a bait or a
      checking move is often nowhere near line 1. MultiPV splits the same Think time over more lines, so each
      iteration is slower - that is the search-speed cost, paid only while the hunter is selected.
    - it reads the board itself (a pure attack/defence trace of the position, lib.js moveTraits) to know whether
      a candidate gives check, offers material or points at the enemy king. The tracer only classifies moves the
      engine already produced; chess.com's own legal-move list still decides what can be played.
    - the natural-mistake roll is skipped in hunter mode: an attack is a decision, not an accident (a verified
      mate was never traded away for a slip in any style). The decision itself is still gated: the hunter only
      spends its risk margin while Natural mistakes is on at a below-2000 level (UPDATE 1.12).
    - the hunter's candidates come from the deepest iteration the search reached as well as the level's own depth,
      so the ELO level matters less while it is attacking: at 400 ELO + hunter + a 5s think time it plays the
      attack (or the mate) that the whole 5 seconds of searching proved, not the depth-1 line. The level still
      decides when nothing aggressive is available (then its own top line is played), and slips stay off.
    - the panel says what it saw, e.g. "hunter: check + bait (3 pts offered)" or "hunter mate M3", so an unusual
      move is explainable instead of mysterious.
What a mate-proof can reach is bounded by how deep the search got, so deeper mates still need Think time (and the
hunter also sees the deepest iteration the window reached). "Full engine" plus a few seconds finds long mates.

NATURAL MISTAKES (the switch now governs EVERY checkmate style - UPDATE 1.12)
    On   (default) at a below-2000 level, a deliberate deviation from the best line is allowed: sometimes a random
               one among the engine's candidate moves - 400 ELO deviates often, 1800 rarely, 2000+ never - and,
               in the aggressive hunter, up to the selected Hunter risk in evaluation for an attack. Both are
               human simulation, both are labelled in the panel ("natural 400 ELO slip", "hunter: check + bait").
    Off  NO mistakes are allowed: every checkmate style plays the engine's objectively best move, except a
               verified forced mate. No random deviation, no hunter concession - the hunter's risk allowance
               becomes zero and it only takes an attack that TIES the best move. 2000+ and Full engine behave
               this way with the switch on as well: their error rate is zero, so no style may deviate there.
The switch also drives the "What would X play?" button. Deviations never replace an engine-verified forced mate:
the shortest-mate and hunter styles prioritize the fastest verified mate found during the think-time search, and
a mate claim the deepest search evidence refutes is dropped before any style sees it.
"Top 3 moves" only hides/shows arrows; it does not remove the candidate lines used for mate checks or random
mistakes, so hiding arrows cannot silently turn the Natural mistakes setting off.

AUTO-PLAY
Switch "Auto-play" on and the tutor plays moves itself for the selected "Show moves for" side. It only attempts
a move when it is genuinely that side's turn, checks the current board position again before playing, and sends
the move through chess.com's own legal-move list. A stale or illegal move is refused instead of forced.

Auto-play ELO is independent from the normal Play level: it is the strength used for the moves it plays. Both
share Think time. The Natural mistakes switch controls every style's deliberate deviations: random slips in
shortest-mate and regular play, the Hunter-risk concessions in the aggressive hunter (verified mates always
protected and never replaced). With mistakes off - or at Full engine / any 2000+ level - auto-play plays the
engine's best move every time (UPDATE 1.12). The "Move dispatch" line in the panel reads "After 5s thinking"
(or "Immediate (instant)" at 0) because that think time is the only wait before a move goes out - there is no
separate pacing timer; instant still waits for the level-strength result itself (see UPDATE 1.12).

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
(dev) legal moves (perft), the move-history tracker, position commands, the clock adapter and the ponder gate
      are unit-tested: node tests/game.test.js
(dev) the panel wiring end to end (jsdom + fake UCI engine) is tested: node tests/panel-logic.test.js
      with CT_STOCKFISH=/path/to/stockfish it also plays ponder/ponderhit/cancel against a real engine
      it needs jsdom once - npm install --no-save jsdom - and skips itself when jsdom is missing
