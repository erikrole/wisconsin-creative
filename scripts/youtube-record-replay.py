"""Record read-only YouTube Data API responses for the /youtube preview replay.

Usage: python3 scripts/youtube-record-replay.py tmp/youtube-replay
Then set WC_PREVIEW_YOUTUBE_REPLAY_DIR=tmp/youtube-replay in .env.development.local.
Recordings include unlisted titles; keep them in the gitignored tmp/ folder.

GET requests only, using the read-only audit grant. The refreshed access token
is held in memory and never written. Output: <out>/manifest.json + one JSON file
per request keyed by method + path + sorted query.
"""
import hashlib, json, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(sys.argv[1])
TOKEN_FILE = Path.home() / "Code/Certificates/yt-audit-token_readonly.json"
API = "https://www.googleapis.com/youtube/v3/"
CHANNEL = "UCwGvYcF_PDvOvvADzEbrT0A"

grant = json.loads(TOKEN_FILE.read_text())
body = urllib.parse.urlencode({
    "client_id": grant["client_id"], "client_secret": grant["client_secret"],
    "refresh_token": grant["refresh_token"], "grant_type": "refresh_token",
}).encode()
token = json.load(urllib.request.urlopen(urllib.request.Request(grant["token_uri"], data=body)))["access_token"]

OUT.mkdir(parents=True, exist_ok=True)
entries = []


def key_for(path, query):
    return "GET " + path + "?" + urllib.parse.urlencode(sorted(query.items()))


def get(path, **query):
    query = {k: v for k, v in query.items() if v is not None}
    url = API + path + "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status, data = resp.status, json.load(resp)
    except urllib.error.HTTPError as err:
        status, data = err.code, json.loads(err.read() or b"null")
    key = key_for(path, query)
    name = hashlib.sha256(key.encode()).hexdigest()[:20] + ".json"
    (OUT / name).write_text(json.dumps({"key": key, "status": status, "body": data}, indent=1))
    entries.append(key)
    if status != 200:
        raise SystemExit(f"{key} -> {status}")
    return data


channels = get("channels", part="snippet,contentDetails", mine="true")
channel = next(c for c in channels["items"] if c["id"] == CHANNEL)
uploads = channel["contentDetails"]["relatedPlaylists"]["uploads"]

page_token, ids = None, []
for _ in range(6):
    page = get("playlistItems", part="contentDetails", playlistId=uploads, maxResults="50", pageToken=page_token)
    page_ids = [item["contentDetails"]["videoId"] for item in page.get("items", [])]
    fresh = [i for i in dict.fromkeys(page_ids) if i not in ids]
    ids += fresh
    if fresh:
        get("videos", part="snippet,status", id=",".join(fresh))
    page_token = page.get("nextPageToken")
    if not page_token:
        break

playlists, page_token = [], None
while True:
    page = get("playlists", part="snippet,contentDetails,status", mine="true", maxResults="50", pageToken=page_token)
    playlists += page.get("items", [])
    page_token = page.get("nextPageToken")
    if not page_token:
        break

wanted = [p for p in playlists if "2026" in p["snippet"]["title"] or "conference" in p["snippet"]["title"].lower()]
for playlist in wanted:
    page_token = None
    for _ in range(100):
        page = get("playlistItems", part="snippet", playlistId=playlist["id"], maxResults="50", pageToken=page_token)
        page_token = page.get("nextPageToken")
        if not page_token:
            break

(OUT / "manifest.json").write_text(json.dumps({
    "recordedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "channelId": CHANNEL,
    "requests": len(entries),
    "uploads": len(ids),
    "playlists": len(playlists),
    "playlistMembershipsRecorded": [p["snippet"]["title"] for p in wanted],
}, indent=1))
print(f"{len(entries)} requests, {len(ids)} uploads, {len(playlists)} playlists, {len(wanted)} playlist item sets")
