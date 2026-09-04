"""
MEME-CAM backend.

Serves the front end and exposes the memes in the static/memes/ folder.
"""

import io
import os
import sqlite3
import subprocess
import tempfile

from flask import Flask, jsonify, render_template, request, send_file, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(BASE_DIR, "meme_cam.db")
# Keep media under Flask's static directory. The project already stores its
# video meme here, and this gives the API and the browser one consistent path.
MEMES_DIR = os.path.join(BASE_DIR, "static", "memes")

MEME_FILES = ("family-guy.mp4", "meme-1.mp4", "meme-2.mp4", "meme-3.mp4", "meme-4.mp4")

app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = os.environ.get("MEME_CAM_SECRET", "local-development-secret")
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024


@app.errorhandler(413)
def request_entity_too_large(_error):
    return jsonify({"error": "file-too-large", "message": "Recordings must be smaller than 100 MB."}), 413


def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with get_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                parent_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
            """
        )
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(comments)")}
        if "parent_id" not in columns:
            connection.execute("ALTER TABLE comments ADD COLUMN parent_id INTEGER")


init_db()


def list_memes():
    """Return the bundled meme videos in their playback order."""
    return [
        filename
        for filename in MEME_FILES
        if os.path.isfile(os.path.join(MEMES_DIR, filename))
    ]


@app.get("/")
@app.get("/index.html")
def index():
    """Serve the root monitor page from the project root."""
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/login.html")
def login_page():
    return render_template("login.html")


@app.get("/register.html")
def register_page():
    return render_template("register.html")


@app.route("/api/random-meme")
def random_meme():
    """Return the available meme playlist and a compatible selected item."""
    memes = list_memes()
    if not memes:
        return jsonify(
            {
                "error": "no-memes",
                "message": "No memes found. Drop images or MP4s into static/memes/.",
            }
        ), 404

    playlist = [
        {
            "filename": meme,
            "url": f"/static/memes/{meme}",
            "type": "video" if meme.lower().endswith(".mp4") else "image",
        }
        for meme in memes
    ]
    choice = playlist[0]
    return jsonify(
        {
            **choice,
            "count": len(memes),
            "playlist": playlist,
        }
    )


@app.route("/api/convert-recording", methods=["POST"])
def convert_recording():
    """Convert a browser WebM recording into an MP4 download."""
    recording = request.files.get("recording")
    if recording is None:
        return jsonify({"error": "missing-recording", "message": "No recording was provided."}), 400

    with tempfile.TemporaryDirectory() as directory:
        source = os.path.join(directory, "recording.webm")
        output = os.path.join(directory, "recording.mp4")
        recording.save(source)
        try:
            conversion = subprocess.run(
                [
                    "ffmpeg", "-y", "-i", source,
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-movflags", "+faststart", output,
                ],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        except FileNotFoundError:
            return jsonify({"error": "ffmpeg-unavailable", "message": "MP4 conversion is unavailable on this server."}), 503
        if conversion.returncode != 0:
            conversion = subprocess.run(
                [
                    "ffmpeg", "-y", "-i", source,
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-an", "-movflags", "+faststart", output,
                ],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        if conversion.returncode != 0:
            return jsonify({"error": "conversion-failed", "message": "The recording could not be converted to MP4."}), 422

        with open(output, "rb") as converted:
            data = converted.read()
    response = send_file(
        io.BytesIO(data),
        mimetype="video/mp4",
        as_attachment=True,
        download_name="meme-cam-recording.mp4",
    )
    return response


@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    if len(username) < 3 or len(username) > 30 or not username.replace("_", "").isalnum():
        return jsonify({"message": "Username must be 3-30 characters using letters, numbers, or underscores."}), 400
    if len(password) < 6:
        return jsonify({"message": "Password must be at least 6 characters."}), 400
    try:
        with get_db() as connection:
            cursor = connection.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, generate_password_hash(password)),
            )
            session["user_id"] = cursor.lastrowid
            session["username"] = username
    except sqlite3.IntegrityError:
        return jsonify({"message": "That username is already registered."}), 409
    return jsonify({"username": username}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    with get_db() as connection:
        user = connection.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (str(data.get("username", "")).strip(),),
        ).fetchone()
    if user is None or not check_password_hash(user["password_hash"], str(data.get("password", ""))):
        return jsonify({"message": "Invalid username or password."}), 401
    session["user_id"] = user["id"]
    session["username"] = user["username"]
    return jsonify({"username": user["username"]})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"message": "Signed out."})


@app.get("/api/me")
def current_user():
    return jsonify({"username": session.get("username")})


@app.get("/api/comments")
def get_comments():
    with get_db() as connection:
        rows = connection.execute(
            "SELECT comments.id, comments.text, comments.parent_id, users.username FROM comments "
            "JOIN users ON users.id = comments.user_id ORDER BY comments.id DESC"
        ).fetchall()
    return jsonify({"comments": [dict(row) for row in rows]})


@app.post("/api/comments")
def create_comment():
    user_id = session.get("user_id")
    if user_id is None:
        return jsonify({"message": "Sign in to comment."}), 401
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", "")).strip()
    if not text or len(text) > 500:
        return jsonify({"message": "Comments must contain 1-500 characters."}), 400
    parent_id = data.get("parent_id")
    if parent_id is not None:
        with get_db() as connection:
            parent = connection.execute("SELECT id FROM comments WHERE id = ?", (parent_id,)).fetchone()
        if parent is None:
            return jsonify({"message": "The comment you are replying to does not exist."}), 404
    with get_db() as connection:
        cursor = connection.execute(
            "INSERT INTO comments (user_id, text, parent_id) VALUES (?, ?, ?)",
            (user_id, text, parent_id),
        )
    return jsonify(
        {"id": cursor.lastrowid, "text": text, "parent_id": parent_id, "username": session["username"]}
    ), 201


@app.delete("/api/comments/<int:comment_id>")
def delete_comment(comment_id):
    user_id = session.get("user_id")
    if user_id is None:
        return jsonify({"message": "Sign in to delete comments."}), 401
    with get_db() as connection:
        cursor = connection.execute(
            "DELETE FROM comments WHERE id = ? AND user_id = ?", (comment_id, user_id)
        )
    if cursor.rowcount == 0:
        return jsonify({"message": "Comment not found or owned by another user."}), 404
    return jsonify({"message": "Comment deleted."})


if __name__ == "__main__":
    os.makedirs(MEMES_DIR, exist_ok=True)
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", "5001")))
