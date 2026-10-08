import io
import json
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
        for c in ['uci', 'stop', 'position startpos', 'go wtime 5000 btime 5000', 'setoption name MultiPV value 1']:
            self.assertTrue(allowed_command(c))
        for c in ['uci\nquit', 'setoption name EvalFile value /tmp/a', 'unknown', None]:
            self.assertFalse(allowed_command(c))

    def test_host_subprocess(self):
        root = pathlib.Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            directory = pathlib.Path(directory)
            shutil.copy(root / 'native/host.py', directory / 'host.py')
            (directory / 'config.json').write_text(json.dumps({
                'engine': str(root / 'tests/fake-uci.py'), 'threads': 2, 'hash_mb': 32}))
            process = subprocess.Popen([sys.executable, str(directory / 'host.py')],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0)
            def send(command):
                data = json.dumps({'command': command}).encode()
                process.stdin.write(struct.pack('<I', len(data)) + data)
                process.stdin.flush()
            def receive_until(expected):
                lines = []
                while True:
                    self.assertTrue(select.select([process.stdout], [], [], 5)[0], 'host timed out')
                    result = read_message(process.stdout)
                    self.assertNotIn('error', result)
                    lines.append(result.get('line', ''))
                    if lines[-1] == expected:
                        return lines
            try:
                send('uci')
                lines = receive_until('uciok')
                self.assertTrue(any('CT Threads 2' in x for x in lines))
                send('isready')
                receive_until('readyok')
                send('position fen 7k/5Q2/6K1/8/8/8/8/8 w - - 0 1')
                send('go movetime 50')
                receive_until('bestmove f7g7')
                process.stdin.close()
                self.assertEqual(process.wait(timeout=5), 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stdout.close()

    def test_config(self):
        self.assertEqual(validate_config({'engine': sys.executable})['threads'], 2)
        for value in [-1, True, 0, 999999]:
            with self.assertRaises(ValueError):
                validate_config({'engine': sys.executable, 'threads': value})


if __name__ == '__main__':
    unittest.main()
