#!/usr/bin/env python3
"""Issue personal one-use links using the existing Supabase CLI account profile.
No service key or management token is written to disk/stdout. Run locally on macOS.
"""
import base64
import html
import json
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / 'config/public-supabase.json').read_text())
REF = CONFIG['url'].split('//')[1].split('.')[0]
profile = os.environ.get('FAMILJEN_CLI_PROFILE', 'supabase')
result = subprocess.run(['security', 'find-generic-password', '-s', 'Supabase CLI', '-a', profile, '-w'], capture_output=True, text=True)
if result.returncode:
    raise SystemExit('Supabase CLI credential is unavailable. Run supabase login with the intended account/profile.')
token = result.stdout.strip()
if token.startswith('go-keyring-base64:'):
    token = base64.b64decode(token.split(':', 1)[1]).decode()
request = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/api-keys', headers={'Authorization': 'Bearer ' + token})
with urllib.request.urlopen(request, timeout=30) as response:
    keys = json.load(response)
admin = next(key['api_key'] for key in keys if key['name'] == 'service_role')
folder = ROOT / 'private-registration'
folder.mkdir(mode=0o700, exist_ok=True)
os.chmod(folder, 0o700)
for person in ['tobias', 'neo', 'sally']:
    request = urllib.request.Request(CONFIG['url'] + '/auth/v1/admin/generate_link', data=json.dumps({'type': 'magiclink', 'email': person + '@devices.familjen.invalid'}).encode(), headers={'Authorization': 'Bearer ' + admin, 'apikey': admin, 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=30) as response:
        link = json.load(response)
    url = 'https://tobisen.github.io/familjen/#/registrera?token_hash=' + link['hashed_token'] + '&type=magiclink'
    output = folder / (person + '.html')
    body = '<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Personlig registrering</title><h1>Registrera ' + person.capitalize() + '</h1><p>Personlig engångslänk. Öppna på rätt enhet. Dela inte vidare och publicera inte filen.</p><p><a rel="noreferrer" href="' + html.escape(url, quote=True) + '">Registrera den här enheten</a></p><p>Om länken har gått ut behöver administratören utfärda en ny.</p></html>'
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as file:
        file.write(body)
    os.chmod(output, 0o600)
    print('Created private one-use registration artifact:', str(output.relative_to(ROOT)))
