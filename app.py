"""
Battle Grid — serveur Flask + Socket.IO
- Authentification Google (OAuth2 via Authlib), avec mode "invité" de secours
  pour tester sans avoir configuré de clés Google.
- Classement (MMR façon Elo) + rangs avec badges.
- Matchmaking 1v1 temps réel et parties jouées côté serveur (autoritaire,
  les clients ne connaissent jamais la flotte adverse).

Lancement :
    pip install -r requirements.txt
    python app.py
Puis ouvrir http://localhost:5000

Configuration Google OAuth (optionnelle pour tester, obligatoire en prod) :
  Voir README.md — variables d'environnement GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
"""
import os
import uuid

from flask import Flask, render_template, redirect, url_for, session, jsonify, request
from flask_login import (
    LoginManager, login_user, logout_user, login_required, current_user
)
from flask_socketio import SocketIO, emit, join_room, leave_room
from authlib.integrations.flask_client import OAuth
from dotenv import load_dotenv

from models import db, User, MatchHistory, rank_for_mmr, compute_elo_change, RANKS
from game_logic import MatchState, SHIP_DEFS

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'battlegrid.db')}"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)

login_manager = LoginManager(app)
login_manager.login_view = "index"

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
GOOGLE_CONFIGURED = bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)

oauth = OAuth(app)
if GOOGLE_CONFIGURED:
    google = oauth.register(
        name="google",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    user_data = current_user.to_public_dict() if current_user.is_authenticated else None
    return render_template(
        "index.html",
        google_configured=GOOGLE_CONFIGURED,
        ship_defs=SHIP_DEFS,
        authenticated=current_user.is_authenticated,
        user_json=user_data,
    )


# ---------------------------------------------------------------------------
# Authentification Google
# ---------------------------------------------------------------------------

@app.route("/login/google")
def login_google():
    if not GOOGLE_CONFIGURED:
        return "Google OAuth non configuré côté serveur (voir README.md).", 400
    redirect_uri = url_for("auth_callback", _external=True)
    return google.authorize_redirect(redirect_uri)


@app.route("/auth/callback")
def auth_callback():
    token = google.authorize_access_token()
    userinfo = token.get("userinfo")
    if not userinfo:
        return "Échec de l'authentification Google.", 400

    sub = userinfo["sub"]
    email = userinfo.get("email")
    name = userinfo.get("name") or email.split("@")[0]
    picture = userinfo.get("picture")

    user = User.query.filter_by(google_sub=sub).first()
    if not user:
        user = User.query.filter_by(email=email).first()
    if not user:
        user = User(google_sub=sub, email=email, name=name, avatar_url=picture, mmr=1000)
        db.session.add(user)
    else:
        user.google_sub = sub
        user.name = name
        user.avatar_url = picture
    db.session.commit()

    login_user(user)
    return redirect(url_for("index"))


@app.route("/login/dev", methods=["POST"])
def login_dev():
    """Connexion de secours SANS Google, pour développer/tester le matchmaking
    localement sans avoir configuré d'identifiants OAuth. À désactiver en prod
    (elle se désactive automatiquement si GOOGLE_CONFIGURED, sauf si DEV_LOGIN=1)."""
    if GOOGLE_CONFIGURED and os.environ.get("DEV_LOGIN") != "1":
        return "Connexion invité désactivée.", 403

    pseudo = (request.form.get("pseudo") or "").strip()[:40]
    if not pseudo:
        return "Pseudo requis.", 400

    email = f"dev-{pseudo.lower()}@local.battlegrid"
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(email=email, name=pseudo, mmr=1000)
        db.session.add(user)
        db.session.commit()

    login_user(user)
    return redirect(url_for("index"))


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("index"))


# ---------------------------------------------------------------------------
# API REST
# ---------------------------------------------------------------------------

@app.route("/api/me")
def api_me():
    if not current_user.is_authenticated:
        return jsonify({"authenticated": False, "google_configured": GOOGLE_CONFIGURED})
    return jsonify({"authenticated": True, "user": current_user.to_public_dict()})


@app.route("/api/leaderboard")
def api_leaderboard():
    top = User.query.order_by(User.mmr.desc()).limit(50).all()
    return jsonify([u.to_public_dict() for u in top])


@app.route("/api/ranks")
def api_ranks():
    return jsonify([rank_for_mmr(t) for t, _, _ in RANKS])


# ---------------------------------------------------------------------------
# Matchmaking & parties en temps réel (Socket.IO)
# ---------------------------------------------------------------------------

queue = []                 # liste de {"sid", "user_id", "name", "mmr"}
matches = {}                # match_id -> MatchState
sid_to_context = {}         # sid -> {"user_id", "match_id"}


def user_public(user):
    return {"id": user.id, "name": user.name, "avatar_url": user.avatar_url,
            "mmr": user.mmr, "rank": rank_for_mmr(user.mmr)}


@socketio.on("connect")
def on_connect():
    if not current_user.is_authenticated:
        return False  # refuse la connexion socket si pas connecté


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    # retirer de la queue si présent
    global queue
    queue = [q for q in queue if q["sid"] != sid]

    ctx = sid_to_context.pop(sid, None)
    if ctx and ctx.get("match_id"):
        match = matches.get(ctx["match_id"])
        if match and not match.finished:
            _forfeit_match(match, ctx["user_id"])


@socketio.on("queue_join")
def on_queue_join():
    user = current_user
    sid = request.sid

    if any(q["user_id"] == user.id for q in queue):
        return

    entry = {"sid": sid, "user_id": user.id, "name": user.name, "mmr": user.mmr}
    queue.append(entry)
    emit("queue_status", {"in_queue": True, "position": len(queue)})

    _try_matchmake()


@socketio.on("queue_leave")
def on_queue_leave():
    global queue
    sid = request.sid
    queue = [q for q in queue if q["sid"] != sid]
    emit("queue_status", {"in_queue": False})


def _try_matchmake():
    """Apparie les deux joueurs dont le MMR est le plus proche (parmi la file)."""
    if len(queue) < 2:
        return
    queue.sort(key=lambda q: q["mmr"])
    a, b = queue[0], queue[1]
    queue.remove(a)
    queue.remove(b)

    match_id = uuid.uuid4().hex[:12]
    user_a = db.session.get(User, a["user_id"])
    user_b = db.session.get(User, b["user_id"])

    match = MatchState(match_id, user_public(user_a), user_public(user_b))
    match.sids[1] = a["sid"]
    match.sids[2] = b["sid"]
    matches[match_id] = match

    sid_to_context[a["sid"]] = {"user_id": a["user_id"], "match_id": match_id}
    sid_to_context[b["sid"]] = {"user_id": b["user_id"], "match_id": match_id}

    join_room(match_id, sid=a["sid"])
    join_room(match_id, sid=b["sid"])

    socketio.emit("match_found", {
        "match_id": match_id, "you": 1, "opponent": user_public(user_b),
        "ship_defs": SHIP_DEFS,
    }, to=a["sid"])
    socketio.emit("match_found", {
        "match_id": match_id, "you": 2, "opponent": user_public(user_a),
        "ship_defs": SHIP_DEFS,
    }, to=b["sid"])

    # s'il reste des joueurs en attente, retenter un appariement
    _try_matchmake()


def _get_match_and_slot(match_id):
    match = matches.get(match_id)
    if not match:
        return None, None
    slot = match.slot_of_user(current_user.id)
    if slot is None:
        return None, None
    return match, slot


@socketio.on("place_ships")
def on_place_ships(data):
    match_id = data.get("match_id")
    ships = data.get("ships")
    match, slot = _get_match_and_slot(match_id)
    if not match:
        emit("error_msg", {"message": "Partie introuvable."})
        return
    try:
        match.set_ships(slot, ships)
    except ValueError as e:
        emit("error_msg", {"message": str(e)})
        return

    emit("placement_ack", {}, to=match.sids[slot])
    other_slot = match.other(slot)
    socketio.emit("opponent_ready", {"ready": True}, to=match.sids[other_slot])

    if match.maybe_start():
        for s in (1, 2):
            socketio.emit("battle_start", {
                "your_turn": match.turn == s,
            }, to=match.sids[s])


@socketio.on("fire")
def on_fire(data):
    match_id = data.get("match_id")
    r, c = data.get("r"), data.get("c")
    match, slot = _get_match_and_slot(match_id)
    if not match or not match.started or match.finished:
        return
    if match.turn != slot:
        emit("error_msg", {"message": "Ce n'est pas votre tour."})
        return
    try:
        result = match.fire(slot, r, c)
    except ValueError as e:
        emit("error_msg", {"message": str(e)})
        return

    target_slot = match.other(slot)
    payload = {"r": r, "c": c, "shooter": slot, **result}
    socketio.emit("fire_result", payload, to=match.sids[1])
    socketio.emit("fire_result", payload, to=match.sids[2])

    if not match.finished:
        socketio.emit("turn_update", {"your_turn": match.turn == 1}, to=match.sids[1])
        socketio.emit("turn_update", {"your_turn": match.turn == 2}, to=match.sids[2])
    else:
        _finish_match(match, winner_slot=slot)


def _finish_match(match, winner_slot):
    match.finished = True
    loser_slot = match.other(winner_slot)
    winner = db.session.get(User, match.users[winner_slot]["id"])
    loser = db.session.get(User, match.users[loser_slot]["id"])

    delta_w, delta_l = compute_elo_change(winner.mmr, loser.mmr)
    winner.mmr = max(0, winner.mmr + delta_w)
    loser.mmr = max(0, loser.mmr + delta_l)
    winner.wins += 1
    winner.games_played += 1
    loser.losses += 1
    loser.games_played += 1

    hist = MatchHistory(
        player1_id=match.users[1]["id"], player2_id=match.users[2]["id"],
        winner_id=winner.id,
        player1_shots=match.shots_fired_count[1], player2_shots=match.shots_fired_count[2],
        turns=match.turns_played, mmr_change=abs(delta_w),
    )
    db.session.add(hist)
    db.session.commit()

    socketio.emit("game_over", {
        "winner_slot": winner_slot,
        "mmr_change_winner": delta_w, "mmr_change_loser": delta_l,
        "your_new_mmr": winner.mmr, "rank": rank_for_mmr(winner.mmr),
    }, to=match.sids[winner_slot])
    socketio.emit("game_over", {
        "winner_slot": winner_slot,
        "mmr_change_winner": delta_w, "mmr_change_loser": delta_l,
        "your_new_mmr": loser.mmr, "rank": rank_for_mmr(loser.mmr),
    }, to=match.sids[loser_slot])

    matches.pop(match.match_id, None)


def _forfeit_match(match, disconnected_user_id):
    slot_left = match.slot_of_user(disconnected_user_id)
    if slot_left is None:
        return
    winner_slot = match.other(slot_left)
    if not match.started:
        # partie jamais commencée : pas de classement affecté, juste prévenir l'autre joueur
        socketio.emit("opponent_left", {}, to=match.sids[winner_slot])
        matches.pop(match.match_id, None)
        return
    socketio.emit("opponent_left", {}, to=match.sids[winner_slot])
    _finish_match(match, winner_slot)


@socketio.on("leave_match")
def on_leave_match(data):
    match_id = data.get("match_id")
    match, slot = _get_match_and_slot(match_id)
    if match and not match.finished:
        _forfeit_match(match, current_user.id)


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    debug_mode = os.environ.get("FLASK_DEBUG", "1") == "1"
    socketio.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)),
                 debug=debug_mode, use_reloader=False)
