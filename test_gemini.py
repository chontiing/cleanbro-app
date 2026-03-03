import urllib.request
import urllib.error
import json

key = 'AIzaSyA2UASZL_FGYTNoOOmPN2wZavDl9RyRQoc'
models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-lite-001']

for m in models:
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}'
    body = json.dumps({'contents':[{'parts':[{'text':'hi'}]}]}).encode()
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
    try:
        res = urllib.request.urlopen(req)
        data = json.loads(res.read().decode())
        print(f"{m}: OK - {data['candidates'][0]['content']['parts'][0]['text'][:20]}")
    except urllib.error.HTTPError as e:
        error_msg = e.read().decode()
        print(f"{m}: ERROR {e.code} - {error_msg}")
