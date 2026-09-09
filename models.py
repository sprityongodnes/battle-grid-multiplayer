"""
Modèles de données pour Battle Grid.
- User : compte joueur (connecté via Google), MMR (classement Elo), stats.
- MatchHistory : historique des parties 1v1 terminées.
"""
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin

db = SQLAlchemy()

# ---------- Système de rangs ----------
# Liste ordonnée (mmr minimum, id, nom affiché, fichier badge dans /static/img/ranks/)
RANKS = [
    (0,    "recrue",    "Recrue"),
    (1000, "matelot",   "Matelot"),
    (1200, "officier",  "Officier"),
    (1400, "capitaine", "Capitaine"),
    (1600, "amiral",    "Amiral"),
    (1800, "legende",   "Légende"),
]


def rank_for_mmr(mmr: int):
    """Retourne (id, nom, badge_url, mmr_du_rang_suivant_ou_None) pour un MMR donné."""
    current = RANKS[0]
    next_threshold = None
    for i, (threshold, rid, name) in enumerate(RANKS):
        if mmr >= threshold:
            current = (threshold, rid, name)
            next_threshold = RANKS[i + 1][0] if i + 1 < len(RANKS) else None
        else:
            break
    _, rid, name = current
    return {
        "id": rid,
        "name": name,
        "badge": f"/static/img/ranks/{rid}.png",
        "mmr": mmr,
        "next_threshold": next_threshold,
    }


class User(UserMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    google_sub = db.Column(db.String(64), unique=True, nullable=True, index=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    avatar_url = db.Column(db.String(500), nullable=True)

    mmr = db.Column(db.Integer, default=1000, nullable=False)
    wins = db.Column(db.Integer, default=0, nullable=False)
    losses = db.Column(db.Integer, default=0, nullable=False)
    games_played = db.Column(db.Integer, default=0, nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_public_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "avatar_url": self.avatar_url,
            "mmr": self.mmr,
            "wins": self.wins,
            "losses": self.losses,
            "games_played": self.games_played,
            "rank": rank_for_mmr(self.mmr),
        }


class MatchHistory(db.Model):
    __tablename__ = "match_history"

    id = db.Column(db.Integer, primary_key=True)
    player1_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    player2_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    winner_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    player1_shots = db.Column(db.Integer, default=0)
    player2_shots = db.Column(db.Integer, default=0)
    turns = db.Column(db.Integer, default=0)
    mmr_change = db.Column(db.Integer, default=0)
    forfeit = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)


def compute_elo_change(winner_mmr: int, loser_mmr: int, k: int = 32):
    """Calcul Elo standard. Retourne (delta_gagnant, delta_perdant) — le perdant perd |delta|."""
    expected_winner = 1 / (1 + 10 ** ((loser_mmr - winner_mmr) / 400))
    expected_loser = 1 - expected_winner
    delta_winner = round(k * (1 - expected_winner))
    delta_loser = round(k * (0 - expected_loser))
    return delta_winner, delta_loser
