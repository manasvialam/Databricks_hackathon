"""Probe the deployed app's model features (understanding, fit scoring, translation) with timings.   python databricks/probe_model.py"""
import json, os, subprocess, sys, time
import requests

APP = "https://facility-finder-7474656106086877.aws.databricksapps.com"
LOC = {"lat": 25.6049, "lon": 85.1465, "label": "Patna"}


def token():
    r = subprocess.run(["databricks", "auth", "token", "-o", "json"], capture_output=True, text=True, env=dict(os.environ, MSYS_NO_PATHCONV="1"))
    return json.loads(r.stdout)["access_token"]


T = token()


def post(path, body):
    t0 = time.time()
    for _ in range(5):
        r = requests.post(APP + path, headers={"Authorization": f"Bearer {T}"}, json=body, timeout=90)
        if r.status_code != 429:
            break
        time.sleep(20)
    return r.status_code, r.json(), round(time.time() - t0, 2)


for text in ["headache hospitals", "mere pita ko dialysis chahiye", "मेरे पिता को डायलिसिस की ज़रूरत है", "எனக்கு டயாலிசிஸ் வேண்டும்", "severe chest pain and sweating",
             "breathless when I climb stairs", "my child has had fever for three days"]:
    code, d, secs = post("/api/triage", {"message": text})
    tr = d.get("triage", {})
    print(f"TRIAGE {secs:>5}s {code} src={tr.get('source')} urgency={tr.get('urgency')} services={tr.get('services')} emergency={bool(tr.get('emergency'))} need={tr.get('need')!r} | {text}")
    if tr.get("services") and not tr.get("emergency"):
        c2, r2, s2 = post("/api/recommend", {"services": tr["services"], "urgency": tr["urgency"], "location": LOC, "need": tr.get("need")})
        res = r2.get("results", [])
        print(f"   RECOMMEND {s2:>5}s {c2} rankedBy={r2.get('rankedBy')} top={[(x['name'][:28], x['distanceKm']) for x in res[:3]]}")
