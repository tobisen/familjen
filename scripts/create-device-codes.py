#!/usr/bin/env python3
"""Issue high-entropy, reusable codes. Admin credentials never leave memory."""
import base64
import hashlib
import html
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
config = json.loads((ROOT / 'config/public-supabase.json').read_text())
ref = config['url'].split('//')[1].split('.')[0]
people = sys.argv[1:] or ['tobias', 'neo', 'sally']
if any(person not in ['tobias', 'neo', 'sally'] for person in people):
    raise SystemExit('Usage: python3 scripts/create-device-codes.py [tobias|neo|sally ...]')
r = subprocess.run(['security', 'find-generic-password', '-s', 'Supabase CLI', '-a', os.environ.get('FAMILJEN_CLI_PROFILE','supabase'), '-w'], capture_output=True, text=True)
if r.returncode:
    raise SystemExit('Supabase CLI login unavailable.')
token = r.stdout.strip()
if token.startswith('go-keyring-base64:'):
    token = base64.b64decode(token.split(':',1)[1]).decode()
folder = ROOT / 'private-registration'
folder.mkdir(mode=0o700,exist_ok=True)
os.chmod(folder,0o700)
for person in people:
    code=''.join(secrets.choice('0123456789ABCDEFGHJKMNPQRSTVWXYZ') for _ in range(16))
    digest=hashlib.sha256((person+':'+code).encode()).hexdigest()
    sql="""begin;
    update private.device_registration_codes set revoked_at=now() where revoked_at is null and profile_id=(select id from public.profiles where profile_key='%s');
    insert into private.device_registration_codes(code_hash,profile_id,expires_at)
    select '%s',id,'infinity'::timestamptz from public.profiles where profile_key='%s' and auth_user_id is not null;
    commit;""" % (person,digest,person)
    req=urllib.request.Request('https://api.supabase.com/v1/projects/'+ref+'/database/query', data=json.dumps({'query':sql}).encode(),method='POST',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as response:
        response.read()
    formatted='-'.join(code[i:i+4] for i in range(0,16,4))
    output=folder/(person+'-code.html')
    document='<!doctype html><html lang="sv"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Personlig inloggningskod</title><style>body{font:18px system-ui;max-width:500px;margin:10vh auto;padding:24px;line-height:1.6}code{font-size:22px;overflow-wrap:anywhere}</style><h1>'+person.capitalize()+'</h1><p>Din personliga inloggningskod:</p><p><code>'+html.escape(formatted)+'</code></p><p>Ingen tidsgräns. Kan återanvändas tills den ersätts med en ny kod. Dela endast med rätt person. Förvara inte filen publikt.</p><a href="https://tobisen.github.io/familjen/register/" rel="noreferrer">Öppna registreringssidan</a></html>'
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as file:file.write(document)
    os.chmod(output,0o600)
    print('Issued private code artifact:',str(output.relative_to(ROOT)))
