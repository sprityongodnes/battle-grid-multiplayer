"""
Logique de bataille navale côté serveur (autoritaire).
Le serveur connaît les deux flottes ; les clients ne reçoivent jamais
la position des navires adverses, seulement les résultats de tirs (touché/manqué/coulé).
"""
import random

SIZE = 10

SHIP_DEFS = [
    {"id": "porte-avions", "name": "Porte-avions", "size": 5},
    {"id": "croiseur", "name": "Croiseur", "size": 4},
    {"id": "contre-torpilleur", "name": "Contre-torpilleur", "size": 3},
    {"id": "sous-marin", "name": "Sous-marin", "size": 3},
    {"id": "torpilleur", "name": "Torpilleur", "size": 2},
]
SHIP_SIZES_BY_ID = {s["id"]: s["size"] for s in SHIP_DEFS}


def cells_for(r, c, size, orientation):
    if orientation == "h":
        if c + size > SIZE:
            return None
        return [(r, c + k) for k in range(size)]
    else:
        if r + size > SIZE:
            return None
        return [(r + k, c) for k in range(size)]


def validate_and_build_occupancy(ships_payload):
    """
    ships_payload: liste de dicts {id, r, c, orientation} envoyés par le client.
    Retourne (occupancy_dict, ships_state) ou lève ValueError si invalide (triche/bug client).
    occupancy_dict: {(r,c): ship_id}
    ships_state: {ship_id: {"name", "size", "cells": [(r,c),...], "hits": 0, "sunk": False}}
    """
    seen_ids = set()
    occupancy = {}
    ships_state = {}

    if not isinstance(ships_payload, list) or len(ships_payload) != len(SHIP_DEFS):
        raise ValueError("Flotte incomplète")

    for item in ships_payload:
        sid = item.get("id")
        if sid not in SHIP_SIZES_BY_ID or sid in seen_ids:
            raise ValueError("Navire invalide")
        seen_ids.add(sid)
        size = SHIP_SIZES_BY_ID[sid]
        r, c = int(item.get("r", -1)), int(item.get("c", -1))
        orientation = item.get("orientation")
        if orientation not in ("h", "v"):
            raise ValueError("Orientation invalide")
        if not (0 <= r < SIZE and 0 <= c < SIZE):
            raise ValueError("Position hors grille")
        cells = cells_for(r, c, size, orientation)
        if not cells:
            raise ValueError("Navire hors grille")
        for cell in cells:
            if cell in occupancy:
                raise ValueError("Chevauchement de navires")
        for cell in cells:
            occupancy[cell] = sid
        name = next(s["name"] for s in SHIP_DEFS if s["id"] == sid)
        ships_state[sid] = {"name": name, "size": size, "cells": cells, "hits": 0, "sunk": False}

    if seen_ids != set(SHIP_SIZES_BY_ID.keys()):
        raise ValueError("Flotte incomplète")

    return occupancy, ships_state


def resolve_shot(occupancy, ships_state, shot_status, r, c):
    """
    Applique un tir sur la flotte représentée par occupancy/ships_state.
    shot_status: dict {(r,c): 'hit'|'miss'} déjà joués sur CETTE grille (pour empêcher de rejouer une case).
    Retourne dict avec le résultat.
    """
    if (r, c) in shot_status:
        raise ValueError("Case déjà jouée")

    ship_id = occupancy.get((r, c))
    if ship_id:
        shot_status[(r, c)] = "hit"
        ship = ships_state[ship_id]
        ship["hits"] += 1
        sunk_now = ship["hits"] >= ship["size"]
        if sunk_now:
            ship["sunk"] = True
        all_sunk = all(s["sunk"] for s in ships_state.values())
        return {
            "result": "hit",
            "ship_id": ship_id,
            "ship_name": ship["name"],
            "sunk": sunk_now,
            "sunk_cells": ship["cells"] if sunk_now else None,
            "all_sunk": all_sunk,
        }
    else:
        shot_status[(r, c)] = "miss"
        return {"result": "miss"}


class MatchState:
    """État en mémoire d'une partie 1v1 en cours (perdu si le serveur redémarre)."""

    def __init__(self, match_id, user1, user2):
        self.match_id = match_id
        self.users = {1: user1, 2: user2}  # {slot: User (db objet detaché, on stocke id/name/mmr)}
        self.sids = {1: None, 2: None}
        self.occupancy = {1: None, 2: None}
        self.ships_state = {1: None, 2: None}
        self.shots_on = {1: {}, 2: {}}  # tirs reçus par le joueur (case -> hit/miss)
        self.shots_fired_count = {1: 0, 2: 0}
        self.ready = {1: False, 2: False}
        self.turn = None  # 1 ou 2
        self.started = False
        self.finished = False
        self.turns_played = 0

    def other(self, slot):
        return 2 if slot == 1 else 1

    def slot_of_user(self, user_id):
        for slot, u in self.users.items():
            if u["id"] == user_id:
                return slot
        return None

    def set_ships(self, slot, ships_payload):
        occupancy, ships_state = validate_and_build_occupancy(ships_payload)
        self.occupancy[slot] = occupancy
        self.ships_state[slot] = ships_state
        self.ready[slot] = True

    def maybe_start(self):
        if self.ready[1] and self.ready[2] and not self.started:
            self.started = True
            self.turn = random.choice([1, 2])
            return True
        return False

    def fire(self, shooter_slot, r, c):
        target_slot = self.other(shooter_slot)
        result = resolve_shot(
            self.occupancy[target_slot],
            self.ships_state[target_slot],
            self.shots_on[target_slot],
            r, c,
        )
        self.shots_fired_count[shooter_slot] += 1
        self.turns_played += 1
        if result["result"] == "miss":
            self.turn = target_slot
        if result.get("all_sunk"):
            self.finished = True
        return result
