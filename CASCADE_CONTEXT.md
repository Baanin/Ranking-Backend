# Cascade Context Dump — Ranking Platform

> **Pour la prochaine session Cascade.** Ce fichier est un brief complet pour
> reprendre le projet sans perte de contexte. Lis-le en entier avant de toucher
> au code. Il y a un pendant dans le repo `Ranking-Frontend` (`CASCADE_CONTEXT.md`)
> avec les détails côté UI.

---

## 0. TL;DR projet

Plateforme de classement pour l'asso **Versus Fighting** : on importe des
tournois depuis **start.gg**, on les agrège par **jeu × saison**, on calcule
des points pour chaque joueur, on expose un classement public + un panel
d'administration.

- **Backend** : Node 18+ / Express / TypeScript / Prisma (SQLite) / JWT
- **Frontend** : React 18 / Vite / TypeScript / Tailwind / shadcn/ui / React Router 6
- **Repos** :
  - https://github.com/Baanin/Ranking-Backend
  - https://github.com/Baanin/Ranking-Frontend

---

## 1. Décisions de design importantes

Ces choix ont été faits avec l'utilisateur — **ne pas les remettre en cause sans demander**.

### 1.1 Pas de saisie manuelle de tournois
Tous les tournois sont importés depuis start.gg. Pas de formulaire "créer un
tournoi" côté admin. Les routes `tournaments` exposent uniquement
list/get/delete. La création passe par `POST /api/admin/tournaments/import`.

### 1.2 Resync explicite, pas de cron auto
Un tournoi déjà importé peut être re-synchro via `POST /api/admin/tournaments/:id/resync`.
Pas de job background pour l'instant (volontaire — l'admin déclenche manuellement).

### 1.3 Singles only (pour l'instant)
Le service d'import (`upsertPlayerFromStanding`) **skip** les entrants à >1
participant (équipes / doublettes). Si on étend aux teams plus tard, c'est ce
point qu'il faudra revoir.

### 1.4 Système de points size-weighted (cf. §3)
Choisi pour valoriser les gros tournois. Les valeurs sont dans `src/lib/ranking.ts`
et **doivent rester ajustables facilement** — ne pas les disperser dans le code.

### 1.5 Pas de saisie manuelle de joueurs
Les joueurs sont créés automatiquement à l'import. Le panel admin permet
seulement de les éditer/supprimer, pas d'en créer ex nihilo. Les "guests"
(sans compte start.gg lié) sont créés avec `country='XX'` et matché par tag.

### 1.6 Merge de joueurs (préparé, pas implémenté)
Le schéma a un champ `mergedIntoId` self-relation sur `Player` pour permettre
plus tard de fusionner deux entrées (ex: même joueur sous deux tags). Aucune
route ne l'utilise encore — c'est de l'infrastructure future.

### 1.7 SQLite assumé
Pour la simplicité de déploiement. Si on passe à Postgres plus tard, attention
aux index, aux types `DateTime` et au comportement de `onDelete`.

### 1.8 Audit log en append-only
Toutes les actions admin sensibles (login, CRUD games/seasons/tournaments,
import, resync, modif user, etc.) sont loggées dans `AuditLog`. Jamais de
suppression. Les actions sont des constantes dans `src/lib/audit.ts`.

### 1.9 Brute force protection
- `/api/auth/login` : 5 tentatives / 15min, key = IP + email
- `/api/auth/refresh` : 30 tentatives / 15min, key = IP
- `/api/*` : 300 req/min, key = IP
- `app.set('trust proxy', 1)` activé par défaut, désactivable via `TRUST_PROXY=false`

### 1.10 Domaine front mirroring
Les types `src/types/domain.ts` côté frontend miment exactement les modèles
Prisma. Quand on touche au schema, **on met à jour les deux**.

---

## 2. Modèle de données (Prisma)

### Game
- `name` unique (ex: "Street Fighter 6")
- `slug` unique (ex: "sf6")
- `startggId` unique nullable — **clé de mapping** avec start.gg pour résoudre
  automatiquement le jeu lors de l'import
- `iconColor` : classes Tailwind gradient (ex: `"from-red-500 to-orange-500"`)

### Season
- `(gameId, name)` unique
- `startDate` / `endDate` : couvre les tournois dont `event.startAt` tombe dedans
- À l'import, on prend la **première saison active** dont la fenêtre couvre la
  date de l'event (ordre `startDate desc`)

### Tournament
- `startggSlug` unique nullable (ex: `"tournament/genesis-9/event/ultimate-singles"`)
- `startggEventId` unique nullable
- `lastSyncedAt` mis à jour à chaque import/resync
- `winnerId` : FK Player, set automatiquement au placement #1
- `status` : `upcoming | ongoing | completed`

### Player
- `(tag, country)` unique — permet plusieurs joueurs avec le même tag dans des pays différents
- `startggUserId` / `startggSlug` uniques nullables
- `mergedIntoId` self-relation (préparation merge, cf. 1.6)
- `country` : ISO 3166-1 alpha-2, fallback `'XX'` pour les guests

### Participation
- `(tournamentId, playerId)` unique
- `placement` : 1, 2, 3, 4, 5, 7, 9, 13, 17… (placements start.gg)
- `pointsEarned` : calculé via `computePoints(placement, numEntrants)`

### AdminUser / RefreshToken / AuditLog
Inchangés depuis les premières itérations. Les permissions sont stockées en
CSV dans `AdminUser.permissions` (cf. `src/lib/permissions.ts`).

---

## 3. Système de points

Implémenté dans `src/lib/ranking.ts`.

### Base points (par placement)
| Placement | Points |
|-----------|--------|
| 1         | 100    |
| 2         | 70     |
| 3         | 50     |
| 4         | 40     |
| 5–6       | 30     |
| 7–8       | 20     |
| 9–12      | 10     |
| 13–16     | 5      |
| 17+       | 0      |

### Multiplicateur de taille
`max(1, 1 + log2(entrants / 8))`

| Entrants | Multiplier |
|----------|------------|
| ≤ 8      | 1.0        |
| 16       | 2.0        |
| 32       | 3.0        |
| 64       | 4.0        |
| 128      | 5.0        |
| 256      | 6.0        |

### Formule finale
`points = round(base × multiplier)`

Ex: gagnant d'un tournoi à 32 = 100 × 3 = **300 pts**.

⚠️ Les points sont stockés sur `Participation` au moment de l'import. Si on
change le barème, il faut **resync les anciens tournois** pour propager — il
n'y a pas de migration auto.

---

## 4. Flux d'import start.gg

```
URL start.gg
  └─> parseEventSlug()        → "tournament/<slug>/event/<event-slug>"
  └─> fetchEventWithStandings() → GraphQL start.gg
        ├─> resolveGame()      → match par startggId, sinon erreur 400
        ├─> resolveSeason()    → première saison active couvrant event.startAt
        ├─> upsertPlayer×N     → matché par startggUserId, sinon par tag, sinon créé
        └─> $transaction
              ├─> create/update Tournament
              ├─> deleteMany Participation (tournamentId)
              ├─> createMany Participation (avec points calculés)
              └─> update winnerId
```

**Erreurs typiques côté utilisateur** (à connaître pour debugger) :
- `400 Invalid start.gg URL or slug` → URL passée n'a pas `/event/<slug>`
- `400 No local Game mapped to start.gg videogame "X"` → faut créer le `Game`
  avec le bon `startggId` dans l'admin
- `400 No active season for this game covers <date>` → faut créer une saison
  active dont la fenêtre couvre la date du tournoi
- `409 Tournament already imported` → utiliser le bouton **resync** à la place

---

## 5. Permissions / RBAC

```
PERMISSIONS = {
  MANAGE_TOURNAMENTS, MANAGE_PLAYERS, MANAGE_RESULTS, MANAGE_USERS,
  VIEW_ADMIN_PANEL, VIEW_AUDIT_LOGS,
}

ROLE_DEFAULTS = {
  ADMIN: [tout],
  MODERATOR: [VIEW_ADMIN_PANEL, MANAGE_TOURNAMENTS, MANAGE_PLAYERS, MANAGE_RESULTS],
  AUDITOR: [VIEW_ADMIN_PANEL, VIEW_AUDIT_LOGS],
}
```

Stocké en CSV dans `AdminUser.permissions`. `parsePermissions` filtre les
valeurs invalides — sans risque d'injection.

---

## 6. Routes backend

| Route | Méthodes | Permission | Notes |
|-------|----------|------------|-------|
| `/api/auth/login` | POST | public (rate-limited) | brute force protection |
| `/api/auth/refresh` | POST | cookie | rotation refresh token |
| `/api/auth/logout` | POST | auth | révoque le refresh |
| `/api/admin/users` | CRUD | MANAGE_USERS | |
| `/api/admin/tournaments/import` | POST | MANAGE_TOURNAMENTS | body: `{ urlOrSlug, gameId?, seasonId? }` |
| `/api/admin/tournaments/:id/resync` | POST | MANAGE_TOURNAMENTS | |
| `/api/admin/audit-logs` | GET | VIEW_AUDIT_LOGS | paginé |
| `/api/games` | CRUD | MANAGE_TOURNAMENTS (write), public (read) | |
| `/api/seasons` | CRUD | idem | |
| `/api/tournaments` | GET/DELETE | DELETE = MANAGE_TOURNAMENTS | filtres `gameId`, `seasonId`, `status` |
| `/api/players` | GET/PATCH/DELETE | write = MANAGE_PLAYERS | filtre `q` (search par tag) |
| `/api/rankings` | GET | public | filtres `gameId`, `seasonId` ; agrège points/wins par joueur |

---

## 7. Pages frontend

### Public
- `/` → `HomePage` : tournois featured, top players, stats globales
- `/rankings` → `RankingsPage` : filtres game + season
- `/tournaments` → `TournamentsPage` : filtres status + game
- `/tournaments/:id` → `TournamentDetailPage` : standings complets
- `/players` → `PlayersPage` : recherche par tag

### Admin (sous `<AdminLayout>`)
- `/admin` → `AdminDashboard` : cards de raccourcis
- `/admin/games` → `AdminGamesPage` : CRUD jeux
- `/admin/seasons` → `AdminSeasonsPage` : CRUD saisons (bouton "Nouvelle" grisé si 0 game)
- `/admin/tournaments` → `AdminTournamentsPage` : import / resync / delete
- `/admin/audit-logs` → `AdminAuditLogPage` : consultation paginée
- `/admin/users` → CRUD admins (existant pré-refonte)

---

## 8. État au handoff (mai 2026)

### Fait ✅
- Audit log (back + UI + helper)
- Brute force protection complète
- Refonte schéma Prisma (Game, Season, Tournament, Player, Participation)
- Client start.gg + import + resync
- Toutes les pages admin
- Pages publiques branchées sur les vraies APIs
- Calcul de points size-weighted

### Pas encore fait / à valider 🟡
- **Test E2E réel** d'un import de bout en bout sur prod (l'utilisateur testait
  quand on a stoppé)
- **Tuning du barème de points** — dépend du retour de la commu
- **Merge de joueurs** (champ DB présent, pas de route/UI)
- **Cron resync** automatique (non prévu volontairement, mais à reconsidérer)
- **Tests automatisés** : aucun. Stack de test à choisir (Vitest probable)

### Bugs résolus pendant le dev
| Bug | Fix |
|-----|-----|
| `ipKeyGenerator is not a function` | retiré l'import, on utilise `req.ip` |
| `The table main.Game does not exist` | les anciennes migrations étaient incompatibles ; reset DB + nouvelle migration `init` |
| Bouton "Nouvelle" grisé sur `/admin/seasons` | comportement voulu : il faut au moins 1 game |
| `Invalid start.gg URL or slug` | UX : l'utilisateur passait une URL `/tournament/X` au lieu de `/tournament/X/event/Y` |
| `npx` vs `npm run` confusion | ajout de scripts npm wrappers |

---

## 9. Comment l'utilisateur travaille

Quelques préférences observées :

- **Parle français** — réponds en français.
- **Style direct** — pas d'intro inutile, pas de "great idea!".
- **Va à l'essentiel** — phrases courtes, listes, code.
- **Veut comprendre les root causes** — pas juste les workarounds.
- **Tourne sous Linux pour la prod** (un VPS, IP `51.83.43.248`).
- **Dev sous Windows / Windsurf** côté local.
- **Préfère les commandes copy-pastables** quand on guide un setup.

---

## 10. Comment reprendre la conversation

Premier message recommandé sur le nouveau PC :

> "Je viens de cloner le projet sur un nouveau PC. Lis
> `Ranking-Backend/CASCADE_CONTEXT.md` pour te remettre en contexte, puis on
> continue sur [tâche]."

Après ça, vérifie :
1. Que les `.env` sont bien créés (cf. `PROJECT_HANDOFF.md` à la racine)
2. Que `npm install` est passé sur les deux repos
3. Que la DB SQLite est migrée (`prisma:migrate`) et seed (`db:seed`)
4. Qu'un compte admin existe (`create-admin`)

Si l'utilisateur demande à continuer le test E2E import → il faut surtout
vérifier qu'il a son `STARTGG_API_TOKEN` valide dans le `.env` backend.
