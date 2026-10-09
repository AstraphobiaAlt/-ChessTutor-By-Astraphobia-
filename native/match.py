#!/usr/bin/env python3
"""Paired-opening Stockfish matches with equal resources, clocks, PGNs and uncertainty."""
import argparse
import json
import math
import pathlib
import time
import chess
import chess.engine
import chess.pgn


def configure(engine, args):
    options = {'Threads': args.threads, 'Hash': args.hash_mb, 'UCI_LimitStrength': False,
               'Skill Level': 20, 'Move Overhead': 150, 'Syzygy50MoveRule': True}
    if args.syzygy_path:
        options['SyzygyPath'] = args.syzygy_path
    engine.configure({k: v for k, v in options.items() if k in engine.options})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--openings', type=pathlib.Path, help='One legal FEN per line; both colours per FEN')
    parser.add_argument('--rounds', type=int, default=4, help='Opening pairs (two games per pair)')
    parser.add_argument('--seconds', type=float, default=30)
    parser.add_argument('--increment', type=float, default=.3)
    parser.add_argument('--threads', type=int, default=1)
    parser.add_argument('--hash-mb', type=int, default=64)
    parser.add_argument('--syzygy-path', default='')
    parser.add_argument('--ponder', action='store_true', help='Both engines ponder; shared-hardware contention affects results')
    parser.add_argument('--max-plies', type=int, default=600)
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('native/results'))
    args = parser.parse_args()
    if min(args.rounds, args.seconds, args.threads, args.hash_mb, args.max_plies) <= 0 or args.increment < 0:
        parser.error('Limits must be positive; increment must be nonnegative')
    openings = ([x.strip() for x in args.openings.read_text().splitlines() if x.strip() and not x.startswith('#')]
                if args.openings else [chess.STARTING_FEN])
    if not openings or any(not chess.Board(f).is_valid() for f in openings):
        parser.error('Openings must contain valid standard-chess FENs')
    args.output.mkdir(parents=True, exist_ok=True)
    engines = [chess.engine.SimpleEngine.popen_uci(x) for x in (args.candidate, args.baseline)]
    records, pairs = [], []
    try:
        for engine in engines:
            configure(engine, args)
        with (args.output / 'games.pgn').open('w') as pgn:
            for pair in range(args.rounds):
                pair_scores = []
                for candidate_white in (True, False):
                    # Clear hash at game boundaries; preserve it throughout each game.
                    for engine in engines:
                        if 'Clear Hash' in engine.options:
                            engine.configure({'Clear Hash': None})
                    board = chess.Board(openings[pair % len(openings)])
                    game = chess.pgn.Game()
                    game.setup(board)
                    game.headers.update(White='Candidate' if candidate_white else 'Baseline',
                                        Black='Baseline' if candidate_white else 'Candidate')
                    node, clocks, token = game, {chess.WHITE: args.seconds, chess.BLACK: args.seconds}, object()
                    winner, reason = None, 'ply-cap adjudicated draw'
                    for _ in range(args.max_plies):
                        outcome = board.outcome(claim_draw=True)
                        if outcome:
                            winner, reason = outcome.winner, outcome.termination.name
                            break
                        turn = board.turn
                        index = 0 if turn == candidate_white else 1
                        start = time.monotonic()
                        try:
                            result = engines[index].play(board, chess.engine.Limit(
                                white_clock=clocks[chess.WHITE], black_clock=clocks[chess.BLACK],
                                white_inc=args.increment, black_inc=args.increment), game=token, ponder=args.ponder)
                        except chess.engine.EngineError:
                            winner, reason = not turn, 'engine failure'
                            break
                        clocks[turn] -= time.monotonic() - start
                        if clocks[turn] <= 0:
                            winner, reason = not turn, 'time forfeit'
                            # FIDE: no win if the opponent has insufficient mating material.
                            if board.has_insufficient_material(not turn):
                                winner = None
                            break
                        if result.move not in board.legal_moves:
                            winner, reason = not turn, 'illegal move'
                            break
                        board.push(result.move)
                        node = node.add_variation(result.move)
                        clocks[turn] += args.increment
                    else:
                        outcome = board.outcome(claim_draw=True)
                        if outcome:
                            winner, reason = outcome.winner, outcome.termination.name
                    # Stop any outstanding ponder before clearing hash for the next game.
                    for engine in engines:
                        engine.ping()
                    score = .5 if winner is None else float(winner == candidate_white)
                    pair_scores.append(score)
                    game.headers['Result'] = '1/2-1/2' if winner is None else '1-0' if winner else '0-1'
                    game.headers['Termination'] = reason
                    print(game, file=pgn, end='\n\n')
                    records.append(dict(pair=pair, candidate_white=candidate_white, score=score, reason=reason))
                    print(records[-1], flush=True)
                pairs.append(sum(pair_scores) / 2)
    finally:
        for engine in engines:
            try:
                engine.quit()
            except chess.engine.EngineError:
                pass
    mean = sum(pairs) / len(pairs)
    se = (math.sqrt(sum((x - mean) ** 2 for x in pairs) / (len(pairs) - 1) / len(pairs))
          if len(pairs) > 1 else None)
    # Approximate paired normal CI, not a strength proof (especially at small samples).
    report = dict(games=records, candidate_score=mean, opening_pairs=len(pairs),
                  approximate_95_percent_interval=([max(0, mean - 1.96 * se), min(1, mean + 1.96 * se)]
                                                    if se is not None else None),
                  warning='Small samples/repeated openings are not strength evidence; no automatic promotion.',
                  time_forfeits=sum(r['reason'] == 'time forfeit' for r in records),
                  configuration={k: str(v) if isinstance(v, pathlib.Path) else v for k, v in vars(args).items()})
    (args.output / 'summary.json').write_text(json.dumps(report, indent=2))
    print('Candidate score:', mean, 'Report:', args.output / 'summary.json')


if __name__ == '__main__':
    main()
