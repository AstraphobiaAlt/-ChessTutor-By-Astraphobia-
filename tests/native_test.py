import io
import json
import os
import pathlib
import struct
import sys
import unittest
import tempfile
import subprocess
import shutil
import select
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'native'))
from host import read_message, allowed_command, validate_config


class NativeTests(unittest.TestCase):
    def test_framing(self):
        data = json.dumps({'command': 'uci'}).encode()
        self.assertEqual(read_message(io.BytesIO(struct.pack('<I', len(data)) + data)), {'command': 'uci'})
        with self.assertRaises(EOFError):
            read_message(io.BytesIO(b'\x01'))
        with self.assertRaises(ValueError):
            read_message(io.BytesIO(struct.pack('<I', 1000000)))

    def test_allowlist(self):
        for c in ['uci', 'stop', 'position startpos', 'go wtime 5000 btime 5000', 'setoption name MultiPV value 1',
                  'position startpos moves e2e4 e7e5 g1f3', 'position fen 8/P6k/8/8/8/8/8/K7 w - - 0 1 moves a7a8q',
                  'go wtime 178500 btime 180000 winc 2000 binc 2000', 'go movetime 1000', 'go depth 10 movetime 8000',
                  'setoption name Move Overhead value 150', 'setoption name Ponder value false']:
            self.assertTrue(allowed_command(c), c)
        for c in ['uci\nquit', 'setoption name EvalFile value /tmp/a', 'unknown', None,
                  'position startpos moves e2e4 quit', 'position fen ../../etc/passwd', 'go searchmoves e2e4',
                  'setoption name Move Overhead value 99999', 'setoption name SyzygyPath value /tmp']:
            self.assertFalse(allowed_command(c), c)

    def test_ponder_is_opt_in(self):
        ponder = ['go ponder wtime 60000 btime 60000 winc 1000 binc 1000', 'ponderhit', 'setoption name Ponder value true']
        for c in ponder:
            self.assertFalse(allowed_command(c), 'refused without host opt-in: ' + c)
            self.assertTrue(allowed_command(c, True), 'allowed with --allow-ponder: ' + c)

    def test_host_subprocess(self):
        with Host(ENGINE_FIXTURE, threads=2, hash_mb=32) as host:
            lines = host.handshake()
            self.assertTrue(any('CT Threads 2' in x for x in lines))
            self.assertIn('info string CT-CAPS ponder=0', lines, 'host announces that pondering is not allowed')
            host.send('position fen 7k/5Q2/6K1/8/8/8/8/8 w - - 0 1')
            host.send('go movetime 50')
            host.receive_until(lambda l: l == 'bestmove f7g7')
            host.process.stdin.close()
            self.assertEqual(host.process.wait(timeout=5), 0)

    def test_host_refuses_ponder_without_opt_in(self):
        with Host(ENGINE_FIXTURE) as host:
            host.handshake()
            host.send('go ponder wtime 1000 btime 1000')
            self.assertEqual(host.receive_error(), 'Unsupported UCI command')

    def test_host_announces_ponder_opt_in(self):
        with Host(ENGINE_FIXTURE, ponder=True) as host:
            lines = host.handshake()
            self.assertIn('info string CT-CAPS ponder=1', lines)
            self.assertTrue(any('Ponder allowed by host config' in x for x in lines))

    def test_config(self):
        self.assertEqual(validate_config({'engine': sys.executable})['threads'], 2)
        self.assertIs(validate_config({'engine': sys.executable})['ponder'], False, 'pondering defaults off')
        self.assertIs(validate_config({'engine': sys.executable, 'ponder': True})['ponder'], True)
        for value in [-1, True, 0, 999999]:
            with self.assertRaises(ValueError):
                validate_config({'engine': sys.executable, 'threads': value})
        for value in ['yes', 1, None]:
            with self.assertRaises(ValueError):
                validate_config({'engine': sys.executable, 'ponder': value})


ROOT = pathlib.Path(__file__).resolve().parents[1]
ENGINE_FIXTURE = str(ROOT / 'tests/fake-uci.py')
REAL_ENGINE = os.environ.get('CT_STOCKFISH', '')


class Host:
    """native/host.py in a temp dir with its own config.json, spoken to with Chrome's framing."""

    def __init__(self, engine, threads=1, hash_mb=16, ponder=False):
        self.engine, self.config = engine, dict(engine=engine, threads=threads, hash_mb=hash_mb, ponder=ponder)

    def __enter__(self):
        self.tmp = tempfile.TemporaryDirectory()
        directory = pathlib.Path(self.tmp.name)
        shutil.copy(ROOT / 'native/host.py', directory / 'host.py')
        (directory / 'config.json').write_text(json.dumps(self.config))
        self.process = subprocess.Popen([sys.executable, str(directory / 'host.py')],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0)
        return self

    def __exit__(self, *exc):
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        self.process.stdout.close()
        try:
            self.process.stdin.close()
        except OSError:
            pass
        self.tmp.cleanup()

    def send(self, command):
        data = json.dumps({'command': command}).encode()
        self.process.stdin.write(struct.pack('<I', len(data)) + data)
        self.process.stdin.flush()

    def receive(self, timeout=10):
        if not select.select([self.process.stdout], [], [], timeout)[0]:
            raise AssertionError('host timed out')
        return read_message(self.process.stdout)

    def receive_until(self, test, timeout=30):
        lines = []
        while True:
            message = self.receive(timeout)
            if 'error' in message:
                raise AssertionError('host error: ' + message['error'])
            lines.append(message.get('line', ''))
            if test(lines[-1]):
                return lines

    def receive_error(self):
        while True:
            message = self.receive()
            if 'error' in message:
                return message['error']

    def quiet_for(self, seconds, test):
        """True when no line matching `test` arrives within `seconds`."""
        end = __import__('time').monotonic() + seconds
        while True:
            left = end - __import__('time').monotonic()
            if left <= 0 or not select.select([self.process.stdout], [], [], left)[0]:
                return True
            if test(read_message(self.process.stdout).get('line', '')):
                return False

    def handshake(self):
        self.send('uci')
        lines = self.receive_until(lambda l: l == 'uciok', 60)
        self.send('isready')
        self.receive_until(lambda l: l == 'readyok', 60)
        return lines


def score_of(lines):
    """(type, value) of the last scored PV line before bestmove."""
    scored = [l for l in lines if l.startswith('info') and ' score ' in l and ' pv ' in l]
    parts = scored[-1].split()
    i = parts.index('score')
    return parts[i + 1], int(parts[i + 2])


@unittest.skipUnless(REAL_ENGINE, 'set CT_STOCKFISH=/path/to/stockfish for the real-engine protocol checks')
class RealEngineTests(unittest.TestCase):
    """The exact commands the extension now sends, against a real Stockfish through the real host."""

    # White is a queen up. The kings have shuffled g1/h1 and g8/h8 twice; Black to move.
    ROOT_FEN = '6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1'
    SHUFFLE = 'g1h1 g8h8 h1g1 h8g8 g1h1 g8h8 h1g1'
    NOW_FEN = '7k/5ppp/8/8/8/8/5PPP/3Q2K1 b - - 7 4'

    def test_history_makes_the_repetition_draw_visible(self):
        with Host(REAL_ENGINE) as host:
            host.handshake()
            # FEN only (the old behaviour): the engine cannot know Kg8 repeats the position a third time
            host.send('position fen ' + self.NOW_FEN)
            host.send('go depth 12')
            kind, value = score_of(host.receive_until(lambda l: l.startswith('bestmove')))
            self.assertTrue(kind == 'mate' or value < -500, 'FEN only: lost (%s %s)' % (kind, value))
            # start position + every move: Kg8 is a threefold repetition, the engine takes the draw
            host.send('position fen %s moves %s' % (self.ROOT_FEN, self.SHUFFLE))
            host.send('go depth 12')
            lines = host.receive_until(lambda l: l.startswith('bestmove'))
            self.assertEqual(lines[-1].split()[1], 'h8g8', 'history-aware: claims the repetition')
            kind, value = score_of(lines)
            self.assertEqual(kind, 'cp')
            self.assertLessEqual(abs(value), 2, 'scored as a draw')

    def test_ponder_then_ponderhit(self):
        with Host(REAL_ENGINE, ponder=True) as host:
            self.assertIn('info string CT-CAPS ponder=1', host.handshake())
            host.send('setoption name Ponder value true')
            host.send('position startpos moves e2e4 e7e5')
            host.send('go ponder wtime 20000 btime 20000 winc 500 binc 500')
            self.assertTrue(host.quiet_for(1.5, lambda l: l.startswith('bestmove')), 'a ponder search waits for ponderhit/stop')
            host.send('ponderhit')
            lines = host.receive_until(lambda l: l.startswith('bestmove'), 30)
            self.assertRegex(lines[-1], r'^bestmove [a-h][1-8][a-h][1-8]')

    def test_ponder_cancel_then_search_real_position(self):
        with Host(REAL_ENGINE, ponder=True) as host:
            host.handshake()
            host.send('setoption name Ponder value true')
            host.send('position startpos moves e2e4 e7e5')
            host.send('go ponder wtime 20000 btime 20000 winc 0 binc 0')
            self.assertTrue(host.quiet_for(0.5, lambda l: l.startswith('bestmove')))
            host.send('stop')                          # the opponent played something else
            host.receive_until(lambda l: l.startswith('bestmove'))   # discarded by the extension
            host.send('position startpos moves e2e4 c7c5')
            host.send('go wtime 20000 btime 20000 winc 0 binc 0')
            best = host.receive_until(lambda l: l.startswith('bestmove'), 30)[-1].split()[1]
            # a reply to 1...c5 (e.g. Nf3), not a stale answer to 1...e5 that might not even be legal
            self.assertRegex(best, r'^[a-h][1-8][a-h][1-8]')


if __name__ == '__main__':
    unittest.main()
