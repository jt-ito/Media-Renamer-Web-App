#!/usr/bin/env python3
import sys
import json
try:
    from guessit import guessit
except Exception:
    guessit = None

def safe_print(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()

if guessit is None:
    safe_print({"error": "guessit_not_installed"})
    sys.exit(1)

for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
        fid = msg.get('id')
        path = msg.get('path') or msg.get('filename')
        if not path:
            safe_print({"id": fid, "error": "missing_path"})
            continue
        try:
            res = guessit(path, options={'single_episode': False})
            out = dict(res)
            # normalize a few fields
            if 'episode' in out and out.get('episode') is not None:
                # guessit may return episode number as int
                out['episodes'] = [out.get('episode')]
            if 'episode_number' in out and out.get('episode_number') is not None:
                out['episodes'] = out.get('episode_number') if isinstance(out.get('episode_number'), list) else [out.get('episode_number')]
            safe_print({"id": fid, "result": out})
        except Exception as e:
            safe_print({"id": fid, "error": str(e)})
    except Exception as e:
        safe_print({"error": "invalid_input", "raw": line, "err": str(e)})
