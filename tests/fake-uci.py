#!/usr/bin/env python3
"""Deterministic protocol fixture, NOT a chess engine. Only move: f7g7."""
import sys
for line in sys.stdin:
    command = line.strip()
    if command == 'uci':
        print('id name Stockfish protocol fixture')
        print('option name Threads type spin default 1 min 1 max 256')
        print('option name Hash type spin default 16 min 1 max 1024')
        print('option name MultiPV type spin default 1 min 1 max 500')
        print('uciok', flush=True)
    elif command == 'isready':
        print('readyok', flush=True)
    elif command.startswith('go'):
        print('info depth 1 score mate 1 nodes 1 time 1 pv f7g7')
        print('bestmove f7g7', flush=True)
    elif command == 'quit':
        break
