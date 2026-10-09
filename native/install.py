#!/usr/bin/env python3
"""Install the native host for Google Chrome on Linux/macOS or Windows."""
import argparse
import json
import pathlib
import re
import sys

p = argparse.ArgumentParser()
p.add_argument('--extension-id', required=True)
p.add_argument('--engine', required=True, type=pathlib.Path)
p.add_argument('--threads', type=int, default=2)
p.add_argument('--hash-mb', type=int, default=256)
p.add_argument('--syzygy-path', default='')
a = p.parse_args()
if not re.fullmatch('[a-p]{32}', a.extension_id):
    p.error('Copy the 32-character extension ID from chrome://extensions')
from host import validate_config
root = pathlib.Path(__file__).resolve().parent
config = validate_config(dict(engine=str(a.engine.resolve()), threads=a.threads,
                              hash_mb=a.hash_mb, syzygy_path=a.syzygy_path))
(root / 'config.json').write_text(json.dumps(config, indent=2))
if sys.platform == 'win32':
    launcher = root / 'launch.bat'
    launcher.write_text('@echo off\r\n"%s" "%s"\r\n' % (sys.executable, root / 'host.py'))
    destination = root / 'ai.chess_tutor.stockfish.json'
else:
    import shlex
    launcher = root / 'launch.sh'
    launcher.write_text('#!/bin/sh\nexec %s %s\n' % (shlex.quote(sys.executable), shlex.quote(str(root / 'host.py'))))
    launcher.chmod(0o700)
    base = (pathlib.Path.home() / 'Library/Application Support/Google/Chrome/NativeMessagingHosts'
            if sys.platform == 'darwin' else pathlib.Path.home() / '.config/google-chrome/NativeMessagingHosts')
    destination = base / 'ai.chess_tutor.stockfish.json'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(dict(name='ai.chess_tutor.stockfish', description='Chess Tutor native Stockfish',
    path=str(launcher), type='stdio', allowed_origins=['chrome-extension://' + a.extension_id + '/']), indent=2))
if sys.platform == 'win32':
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Google\Chrome\NativeMessagingHosts\ai.chess_tutor.stockfish') as key:
        winreg.SetValueEx(key, '', 0, winreg.REG_SZ, str(destination))
print('Installed:', destination)
print('Reload Chess Tutor; select Maximum Strength. Keep this native directory in place.')
