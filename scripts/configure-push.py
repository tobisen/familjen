#!/usr/bin/env python3
"""Operator bootstrap: preserve VAPID keys, deploy worker, configure Vault/cron.
Run after migrations 010–011. Admin tokens and private keys never enter frontend or Git.
"""
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
config = json.loads((ROOT / 'config/public-supabase.json').read_text())
ref = config['url'].split('//')[1].split('.')[0]
token = os.environ.get('SUPABASE_ACCESS_TOKEN')
if not token:
    result = subprocess.run(['security', 'find-generic-password', '-s', 'Supabase CLI', '-a', os.environ.get('FAMILJEN_CLI_PROFILE', 'supabase'), '-w'], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit('Supabase CLI-inloggning krävs; alternativt SUPABASE_ACCESS_TOKEN i operatörens processmiljö.')
    token = result.stdout.strip()
    if token.startswith('go-keyring-base64:'):
        token = base64.b64decode(token.split(':', 1)[1]).decode()

def api(path, body=None):
    req = urllib.request.Request('https://api.supabase.com/v1/projects/' + ref + path, data=json.dumps(body).encode() if body is not None else None, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=40) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def query(sql):
    return api('/database/query', {'query': sql})

if not query("select to_regprocedure('public.push_expire_leases()') is not null as ready")[0]['ready']:
    raise SystemExit('Kör migrationerna 010–011 före push-konfigurationen.')
names = {item['name'] for item in api('/secrets')}
public = json.loads((ROOT / 'config/public-push.json').read_text()).get('publicKey', '')
redact = [token]
if 'VAPID_PRIVATE_KEY' not in names:
    js = "const c=require('node:crypto'),p=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});process.stdout.write(JSON.stringify({privateKey:p.d,publicKey:Buffer.concat([Buffer.from([4]),Buffer.from(p.x,'base64url'),Buffer.from(p.y,'base64url')]).toString('base64url')}))"
    generated = json.loads(subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout)
    redact.append(generated['privateKey'])
    api('/secrets', [{'name': 'VAPID_PRIVATE_KEY', 'value': generated['privateKey']}, {'name': 'VAPID_PUBLIC_KEY', 'value': generated['publicKey']}])
    public = generated['publicKey']
    (ROOT / 'config/public-push.json').write_text(json.dumps({'publicKey': public}, indent=2) + '\n')
# Preserve the existing scheduler credential as well as the VAPID pair.
vault = query("select decrypted_secret from vault.decrypted_secrets where name='familjen_push_worker_secret'")
worker_secret = vault[0]['decrypted_secret'] if vault else secrets.token_urlsafe(32)
redact.append(worker_secret)
api('/secrets', [{'name': 'PUSH_WORKER_SECRET', 'value': worker_secret}])
if not vault:
    query("select vault.create_secret('" + worker_secret + "','familjen_push_worker_secret');")
result = subprocess.run(['npx', '--yes', 'supabase', 'functions', 'deploy', 'push-worker', '--project-ref', ref, '--use-api'], cwd=ROOT, env={**os.environ, 'SUPABASE_ACCESS_TOKEN': token}, capture_output=True, text=True)
output = result.stdout + result.stderr
for value in redact:
    output = output.replace(value, '[redacted]')
print(output)
if result.returncode:
    raise SystemExit(result.returncode)
with urllib.request.urlopen(config['url'] + '/functions/v1/push-worker/config', timeout=40) as response:
    hosted_public = json.load(response)['publicKey']
if len(hosted_public) != 87 or (public and public != hosted_public):
    raise SystemExit('Publik VAPID-konfiguration stämmer inte. Rotera inte nycklar; kontrollera serverns konfiguration.')
(ROOT / 'config/public-push.json').write_text(json.dumps({'publicKey': hosted_public}, indent=2) + '\n')
scheduler = (ROOT / 'supabase/push-scheduler.sql').read_text().replace('https://mulsuwdmpixzukzwpocf.supabase.co', config['url'])
query(scheduler)
print('Push-worker publicerad. En minutjobbsregistrering finns. Endast publik VAPID-nyckel skrivs till frontend.')
