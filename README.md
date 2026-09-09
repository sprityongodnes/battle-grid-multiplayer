# Battle Grid — Bataille navale multijoueur

Jeu de bataille navale avec :
- Mode **Entraînement** (1 joueur vs IA locale — algorithme probabiliste, aucune triche)
- Mode **Multijoueur 1v1** en temps réel (Socket.IO), matchmaking par niveau
- **Classement** (MMR façon Elo) avec rangs et badges (Recrue → Légende)
- Connexion **Google**, avec un mode invité de secours pour tester sans configurer Google

---

## 1. Installation

```bash
cd battlegrid
python3 -m venv venv
source venv/bin/activate        # Windows : venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Lancer le serveur (sans Google, pour tester tout de suite)

```bash
python app.py
```

Ouvre `http://localhost:5000`. Comme aucune clé Google n'est configurée, un écran
**"connexion invité"** apparaît automatiquement (juste un pseudo, pas de mot de passe).
Ça suffit pour tester le jeu solo, le multijoueur et le classement en local
(ouvre l'URL dans deux onglets/navigateurs différents avec deux pseudos pour tester le 1v1).

## 3. Configurer la connexion Google (pour la mise en production)

1. Va sur [Google Cloud Console](https://console.cloud.google.com/) → *APIs & Services* → *Credentials*.
2. Crée un **OAuth client ID** de type *Web application*.
3. Ajoute dans **Authorized redirect URIs** :
   - `http://localhost:5000/auth/callback` (pour tester en local)
   - `https://TON-DOMAINE/auth/callback` (pour la prod)
4. Crée un fichier `.env` à la racine du projet (copie `.env.example`) :

```
SECRET_KEY=change-moi-en-une-longue-chaine-aleatoire
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
```

5. Relance `python app.py`. Le bouton "Se connecter avec Google" remplace
   automatiquement l'écran invité dès que ces variables sont détectées.

> Tant que `GOOGLE_CLIENT_ID`/`SECRET` ne sont pas renseignés, la connexion invité
> reste active. Une fois Google configuré, elle se désactive automatiquement
> (sauf si tu ajoutes `DEV_LOGIN=1` dans `.env` pour la garder en plus, utile en dev).

## 4. Déploiement

Ce projet utilise **Flask-SocketIO** avec le mode async `eventlet` : il a besoin
d'un serveur qui tourne en continu (pas d'hébergement "fichier statique").
Options simples : Render, Railway, Fly.io, un VPS avec `systemd` + Nginx en reverse proxy,
ou PythonAnywhere (avec adaptations pour les websockets).

En production, remplace le lancement `debug=True` dans `app.py` par un vrai
serveur WSGI/eventlet, et pense à :
- Servir en HTTPS (obligatoire pour Google OAuth en prod)
- Changer `SECRET_KEY`
- Passer sur PostgreSQL si tu attends plus qu'une poignée de joueurs simultanés
  (`DATABASE_URL=postgresql://...` dans `.env`, SQLAlchemy s'en charge déjà)
- Si tu déploies sur plusieurs workers/process, le matchmaking (actuellement en
  mémoire) doit passer par Redis (`flask-socketio` supporte un `message_queue=`
  Redis pour ça) — en un seul process, tout fonctionne tel quel.

## 5. Structure du projet

```
battlegrid/
  app.py              → routes, auth Google, événements Socket.IO (matchmaking, tirs)
  models.py            → User, MatchHistory, système de rangs/MMR
  game_logic.py         → règles de bataille navale côté serveur (autoritaire)
  requirements.txt
  templates/
    index.html          → page unique (menu, placement, bataille, classement)
  static/
    css/style.css
    js/game.js           → toute la logique client (placement, IA locale, multi, sons)
    img/
      logo.png
      ships/*.png         → tes 5 sprites de navires
      ranks/*.png          → 6 badges de rang générés (Recrue → Légende)
```

## 6. Système de rangs

| MMR mini | Rang       |
|---------:|------------|
| 0        | Recrue     |
| 1000     | Matelot    |
| 1200     | Officier   |
| 1400     | Capitaine  |
| 1600     | Amiral     |
| 1800     | Légende    |

Chaque victoire/défaite en multijoueur ajuste le MMR des deux joueurs selon un
calcul Elo standard (K=32) : battre quelqu'un de mieux classé rapporte plus
de points, et en perdre moins contre plus fort que soi.

## 7. Sécurité du mode multijoueur

Le serveur est **autoritaire** : les flottes adverses ne sont jamais envoyées
au client, seuls les résultats (touché/manqué/coulé) sont transmis. Le serveur
valide aussi chaque placement de flotte (tailles, chevauchements, limites de
grille) avant d'accepter une partie — impossible de tricher depuis le
navigateur.
