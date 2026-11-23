# Popote

Courses, placard et repas de la semaine, en famille. Application web mobile-first, synchronisée en temps réel, avec validation des nouveaux membres par bot Telegram.

**Stack :** Next.js 16 (App Router) · Supabase (Postgres + Realtime Broadcast) · API Telegram Bot · déploiement Vercel.

## Fonctionnement

- **Entrée par prénom.** Un appareil inconnu déclenche un message Telegram avec *Accepter* / *Refuser*. L'écran d'attente bascule tout seul (Supabase Realtime, avec vérification de secours toutes les 5 s). La session est gardée 400 jours par cookie signé, et révocable en passant le statut de l'appareil à `rejected` dans la table `devices`.
- **Semaine** : nombre de personnes par défaut, créneaux (*Midi et soir*, *Soir uniquement* ou au cas par cas), convives ajustables par repas.
- **Courses** : liste partagée *Courses* + *Placard*, quantités fixes ou « par personne », cochage en rayon, **ingrédients récents** réinjectables en un toucher.
- **Plats** : chaque plat pioche ses ingrédients dans les courses et le placard, avec une quantité par personne ; le total est calculé selon les convives du créneau.
- **Planning** : lundi → dimanche, créneaux actifs seulement, plat, convives et quantités exactes.

Sécurité : toutes les données passent par les routes serveur (clé `service_role`), RLS est activé sans policy, la clé publique ne sert qu'à recevoir des signaux de rafraîchissement sans contenu.

## Mise en place

1. **Supabase** : créez un projet gratuit, puis *SQL Editor* → collez [`supabase/schema.sql`](supabase/schema.sql) → *Run*.
2. **Telegram** : créez un bot avec [@BotFather](https://t.me/BotFather) (`/newbot`) pour obtenir le token.
3. **Vercel** : *Add New Project* → importez ce dépôt → renseignez les variables ci-dessous → *Deploy*.
4. **Activer le webhook** (une seule fois, après le déploiement) : ouvrez
   `https://VOTRE-APP.vercel.app/api/telegram/setup?secret=VOTRE_TELEGRAM_WEBHOOK_SECRET`
5. Envoyez `/id` à votre bot : il répond avec votre identifiant de conversation, à mettre dans `TELEGRAM_ADMIN_CHAT_ID` (puis *Redeploy* sur Vercel).

## Variables d'environnement

| Variable | Où la trouver |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API Keys → `anon` / publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API Keys → `service_role` / secret (ne jamais exposer) |
| `TELEGRAM_BOT_TOKEN` | Message de @BotFather |
| `TELEGRAM_ADMIN_CHAT_ID` | Réponse du bot à `/id` |
| `TELEGRAM_WEBHOOK_SECRET` | Chaîne aléatoire (lettres, chiffres, `_`, `-`) |
| `SESSION_SECRET` | Chaîne aléatoire longue (32+ caractères) |

## Développement local

```bash
cp .env.example .env.local   # puis remplir
npm install
npm run dev
```
