#!/usr/bin/env python3
"""Chrome Native Messaging <-> persistent Stockfish UCI. Stdlib only."""
import json
import pathlib
import struct
import subprocess
import sys
import threading

ROOT = pathlib.Path(__file__).resolve().parent


def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            raise EOFError
        data.extend(chunk)
    return bytes(data)


def read_message(stream):
    size = struct.unpack('<I', read_exact(stream, 4))[0]
    if size > 65536:
        raise ValueError('Native message too large')
    return json.loads(read_exact(stream, size))


def validate_config(config):
    if not isinstance(config.get('engine'), str) or not pathlib.Path(config['engine']).is_file():
        raise ValueError('config.json must specify an existing absolute Stockfish executable path')
    if not pathlib.Path(config['engine']).is_absolute():
        raise ValueError('Engine path must be absolute')
    for key, default, maximum in [('threads', 2, 256), ('hash_mb', 256, 65536)]:
        value = config.get(key, default)
        if type(value) is not int or not 1 <= value <= maximum:
            raise ValueError('Invalid ' + key)
        config[key] = value
    syzygy = config.get('syzygy_path', '')
    if not isinstance(syzygy, str) or '\n' in syzygy or '\r' in syzygy:
        raise ValueError('Invalid Syzygy path')
    return config


def allowed_command(command):
    if not isinstance(command, str) or len(command) > 16384 or '\n' in command or '\r' in command:
        return False
    return (command in ('uci', 'isready', 'stop', 'ucinewgame', 'quit')
            or command.startswith(('position ', 'go ', 'setoption name MultiPV value ',
                                   'setoption name UCI_LimitStrength value false',
                                   'setoption name Skill Level value 20',
                                   'setoption name Move Overhead value 150')))


def main():
    output_lock = threading.Lock()

    def emit(message):
        data = json.dumps(message).encode()
        with output_lock:
            sys.stdout.buffer.write(struct.pack('<I', len(data)) + data)
            sys.stdout.buffer.flush()

    engine = None
    try:
        config = validate_config(json.loads((ROOT / 'config.json').read_text()))
        engine = subprocess.Popen([config['engine']], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=sys.stderr, text=True, bufsize=1)
        input_lock = threading.Lock()

        def send(command):
            with input_lock:
                engine.stdin.write(command + '\n')
                engine.stdin.flush()

        def relay():
            try:
                for line in engine.stdout:
                    line = line.strip()
                    if line == 'uciok':
                        send('setoption name Threads value ' + str(config['threads']))
                        send('setoption name Hash value ' + str(config['hash_mb']))
                        send('setoption name Syzygy50MoveRule value true')
                        syzygy = config.get('syzygy_path', '')
                        if syzygy:
                            send('setoption name SyzygyPath value ' + syzygy)
                        emit({'line': 'info string CT Threads %d · Hash %d MB · Syzygy %s' % (
                            config['threads'], config['hash_mb'],
                            'path configured (coverage depends on installed files)' if syzygy else 'not configured')})
                    emit({'line': line})
                emit({'error': 'Stockfish exited'})
            except (BrokenPipeError, OSError):
                pass

        threading.Thread(target=relay, daemon=True).start()
        while True:
            message = read_message(sys.stdin.buffer)
            command = message.get('command')
            if not allowed_command(command):
                raise ValueError('Unsupported UCI command')
            send(command)
            if command == 'quit':
                break
    except EOFError:
        pass
    except Exception as exc:
        emit({'error': str(exc)})
    finally:
        if engine is not None:
            engine.terminate()
            try:
                engine.wait(timeout=2)
            except subprocess.TimeoutExpired:
                engine.kill()
                engine.wait()


if __name__ == '__main__':
    main()
