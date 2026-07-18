#!/usr/bin/env python3
"""Blocky Pong server: serves the game's static files and a small
leaderboard REST API backed by leaderboard.json.

Endpoints:
  GET  /api/leaderboard  -> [{name, wins, losses, bestStreak}, ...] sorted by wins
  POST /api/result       <- {name, won, score, opponentScore, durationMs}

Stdlib only; run with: python3 server.py
"""
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "leaderboard.json")
DB_LOCK = threading.Lock()
PORT = 8642
MAX_NAME_LEN = 20


def load_db():
    try:
        with open(DB_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_db(db):
    tmp = DB_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(db, f, indent=2)
    os.replace(tmp, DB_PATH)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path == "/api/leaderboard":
            with DB_LOCK:
                db = load_db()
            rows = sorted(
                db.values(), key=lambda r: (-r["wins"], r["losses"], r["name"].lower())
            )[:25]
            self.send_json(rows)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path != "/api/result":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length))
            name = str(data["name"]).strip()[:MAX_NAME_LEN]
            won = bool(data["won"])
            if not name:
                raise ValueError("empty name")
        except (KeyError, ValueError, TypeError, json.JSONDecodeError):
            self.send_error(400, "bad request")
            return
        key = name.lower()
        with DB_LOCK:
            db = load_db()
            rec = db.get(key) or {
                "name": name,
                "wins": 0,
                "losses": 0,
                "streak": 0,
                "bestStreak": 0,
            }
            if won:
                rec["wins"] += 1
                rec["streak"] += 1
                rec["bestStreak"] = max(rec["bestStreak"], rec["streak"])
            else:
                rec["losses"] += 1
                rec["streak"] = 0
            db[key] = rec
            save_db(db)
        self.send_json(rec)

    def send_json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # keep the console quiet


if __name__ == "__main__":
    print(f"Blocky Pong server: http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
