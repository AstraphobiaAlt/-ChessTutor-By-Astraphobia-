# Hunter audit — 1.8.1

The question: **is the "Aggressive hunter" really aggressive, does it make mistakes while "Natural mistakes"
is off, and does it take the mate in the fewest moves — in hunter mode and in the other modes?**

Everything below was measured with the extension's *own* decision code (`lib.js` `chooseMove` / `huntPool` /
`moveTraits` / `searchLimits`) driven from Node against the same Stockfish 19 build the extension downloads
(`stockfish-19-single`, sha256 `8725c265…0721`, verified byte-for-byte from the npm tarball), with
`MultiPV` = the extension's own values (12 while the hunter is on, 5 otherwise).

* 238 positions from 7 opening lines, replayed by the engine, both colours to move (119 / 119)
* Think time 1.2 s for the audit runs unless stated (the UI default is 5 s — the difference is called out)
* "Loss" = centipawns given up against a stronger reference search (1.8 s, single PV) of the same position
* Mate set: 6 positions with a proven mate in 2–6, collected by playing 12 games out to the end

## 1. Is it aggressive?

Yes, in the sense the style promises: it prefers pressure over the quiet top line, and it deviates from the
engine's best move far more often than not.

| pick at Full engine (238 positions) | count |
|---|---|
| "continued pressure vs best defence" (+ attack on the king / material) | 198 |
| mate | 0 in this corpus (no mates available) |
| check | 14 |
| bait | 9 |
| attack-only / capture-only | 14 |
| quiet fallback (nothing aggressive found) | 3 |

* The hunter's pick differs from the engine's own top line in **167 / 238** positions at Very aggressive
  (143 Balanced, 121 Sound vs only `hunter` deviations; the level's line is the reference).
* A real **check** is available in only 25 / 238 positions and a **bait** in 39 / 238 — most of the time the
  hunter's "aggression" is the sustained-pressure tag (`continuationPressure` + an attack on the king's ring),
  not a forcing move. `attacksKingRing` is true for 35 % of all pool entries, so "attack on the king" fires
  easily; requiring the move to *add* new king pressure changes 44 / 714 picks with a mean effect of −8 cp
  (i.e. no measured benefit), so the weights were left alone.
* Aggression is cheap to see in the panel: every pick carries a note ("hunter: check + bait (3 pts offered)").

**Verdict:** it is genuinely an attacking style, but "aggressive" mostly means sustained pressure, not a
sacrifice. If you want visible attacking chess, give it Think time (deeper searches prove more attacks and
mates) rather than expecting forcing moves in every position.

## 2. The "mistakes" with Natural mistakes off

With Natural mistakes off, only the hunter can still leave the engine's top line, and it does so by design
(the roll is skipped in hunter mode). The audit found the pattern behind the two bad moves:

| config | mean | median | p90 | worst | ≥0.7 pawn | ≥1.5 pawn | ≥3 pawn |
|---|---|---|---|---|---|---|---|
| Regular / fewest-move, Full engine (mistakes off) | 1.6 | 1 | 12 | 55 | 0 | 0 | 0 |
| **Hunter, Full engine, Very aggressive** | 27.7 | 15 | 81 | 217 | 37 | 2 | 0 |
| Hunter, 400 ELO, Very aggressive — before the fix | 29.0 | 11 | 89 | 306 | 34 | 6 | 1 |
| Hunter, 400 ELO, Very aggressive — after the fix | 27.7 | 15 | 81 | 217 | 37 | 2 | 0 |

The two ≥1.5-pawn picks are both **baits**: the hunter offered 3–5 points of material for an attack, and the
deeper reference search scored the offer worse than the tutor's own short search did. They are the style
working as specified, not a slipped move — the panel labels them, and the mate rule cannot be traded away by
them (a proven mate was taken in every mate position in every configuration).

Where the price actually comes from — the 74 positions in which the risk dial changes the pick:

| Hunter risk | mean loss | median | p90 | worst | ≥0.7 | ≥1.5 |
|---|---|---|---|---|---|---|
| Sound (0.3) | 14 | 7 | 43 | 103 | 2 | 0 |
| Balanced (0.6) | 31 | 30 | 66 | 104 | 5 | 0 |
| **Very aggressive (1.2)** | **70** | 64 | 119 | 252 | **33** | **3** |

* Closest to the reference best move: Sound 54, Balanced 18, Very aggressive 2 (of 74).
* Sound: 1 bait, mean −15 cp (i.e. a good bait). Very aggressive: 3 baits, mean **+121 cp**.
* The dial is measured with the candidate's own line, so a short Think time makes it optimistic: the position
  that cost 1.2 pawns at 1.2 s picked a sound move at the UI default of 5 s.

**Verdict:** the bad moves are not the mistake roll slipping through — they are the risk dial buying pressure
with real pawns, and **Very aggressive (the default) is where they live**. If a move that looks like a blunder
must not happen, set Hunter risk to Sound or Balanced (those had no ≥1.5-pawn pick in the whole audit), or keep
Very aggressive and accept up to ~0.7 pawns per attacking decision.

## 3. Real defects found and fixed

1. **The quiet fallback ignored the risk dial.** When no attacking candidate passed the dial, the hunter played
   line 1 of its pool whatever that line scored. At a low level line 1 is the depth-1 line, so a 400 ELO hunter
   could answer a 12-candidate search with a move the same search had already thrown out — 1 blunder and 6
   mistakes in the audit before the fix. Now the fallback is the best line the hunter can see; the level's own
   line still wins whenever it is inside the budget. (Consequence, measured: the hunter's pick is now identical
   at 400 ELO and Full engine in all 238 positions — the attack no longer mixes in the level's shallow slips.)
2. **The pool could drop the deep proof.** A wide MultiPV list at the level's depth could fill the pool before
   the deepest iteration was read. A third of the pool is now reserved for the deep iteration, so the mate that
   only the long search proved always has a seat. (With the shipped 12 + 12 candidates the old code happened to
   fit, so this is a guard for wider lists, not the cause of a user-visible move.)
3. **The forced-mate rule sat inside the hunter branch.** It ran after the hunter's mate-first check by luck, so
   nothing was broken *yet* — but any future filter in the aggression path could have bypassed a proven mate.
   The rule now runs before the style split: no style can pass a proven mate on its way to an aggression pick or
   a risk-budget filter. (One deliberate side effect: the hunter's mate is now labelled "hunter mate M3" from a
   single place instead of two.)

## 4. Mates — "checks in the least amount of moves"

On every one of the 6 mate positions, **all** configurations (fewest-move, regular, hunter × Full engine / 400
ELO) played a mating move, and the mate was taken with the smallest positive mate score in the pool
(`fastestMateLine`, deepest line wins a tie). At 400 ELO the hunter found a *faster* mate than the full-engine
fewest-move style in two of the six — that is the deep pool doing its job. The regular style also kept mates
whenever the engine's own top line was one (it does not hunt for them by design).

## 5. What was not changed, on purpose

* The other styles (`Mate in the fewest moves`, `Regular best move`) still answer from the level's depth only.
  That is their documented contract: the hunter is the mode that reads the deepest iteration. With mistakes off
  they never produced a ≥0.7-pawn loss in 238 positions.
* The aggression weights (check 10 > bait 8 > king attack 4 > capture 2) and the ×2 dial in winning positions
  stayed as they are: tightening "attack on the king" measured as a wash (−8 cp mean).
* `Natural mistakes` still applies only to the non-hunter styles, and a proven mate is still never traded.

## 6. Reproduce

The audit harness lives outside the repo (it needs the ~200 MB engine build):

    /tmp/sf/uci.js          minimal UCI client (spawn + stdio)
    /tmp/sf/harness.js      Tutor pipeline copy (searchLimits/mpvFor/Presets) + reference scoring
    /tmp/sf/positions.js    238 FENs from 7 book lines
    /tmp/sf/scan.js         stage 1: hunter search per position, pool traits, picks per risk setting
    /tmp/sf/verify.js       stage 2: before/after scoring of every pick (this report's tables)
    /tmp/sf/riskcompare.js  the risk-dial table on the positions where the dial changes the pick
    /tmp/sf/mates.js, mates-test.js   mate set + the mate audit

Unit tests for the fixes are in `tests/autoplay.test.js` (section 12b) — `node tests/autoplay.test.js`.
