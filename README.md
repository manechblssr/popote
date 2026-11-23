# Popote

Courses, placard et repas de la semaine, en famille. Application web mobile-first, synchronisée en temps réel, avec validation des nouveaux membres par bot Telegram.

- **Site** : export statique Next.js publié sur GitHub Pages (`https://<compte>.github.io/popote/`).
- **API** : un Worker Cloudflare gratuit (`worker/`) avec un Durable Object qui contient la base SQLite, les WebSockets temps réel et le webhook Telegram. Le token du bot ne quitte jamais le Worker.

## Fonctionnement

- **Entrée par prénom.** Chaque appareil génère un jeton secret. Un appareil inconnu déclenche un message Telegram avec *Accepter* / *Refuser* ; l'écran d'attente bascule tout seul dès la décision (WebSocket, vérification de secours toutes les 5 s).
- **Semaine** : nombre de personnes par défaut, créneaux (*Midi et soir*, *Soir uniquement* ou au cas par cas), convives ajustables par repas.
- **Courses** : *Courses* + *Placard*, quantités fixes ou par personne, cochage en rayon, **ingrédients récents** réinjectables en un toucher.
- **Plats** : ingrédients piochés dans les courses et le placard, quantité par personne, total calculé selon les convives du créneau.
- **Planning** : lundi → dimanche, créneaux actifs, plat, convives, quantités exactes.

## Mise en place

```bash
npx wrangler login                                  # compte Cloudflare gratuit
npm run worker:deploy                               # affiche l'URL https://popote-api.<vous>.workers.dev
npx wrangler secret put TELEGRAM_BOT_TOKEN --config worker/wrangler.toml
```

1. Ouvrez une fois `https://popote-api.<vous>.workers.dev/telegram/setup` pour brancher le bot.
2. Envoyez `/id` au bot, puis : `npx wrangler secret put TELEGRAM_ADMIN_CHAT_ID --config worker/wrangler.toml` avec le nombre reçu.
3. Sur GitHub : *Settings → Secrets and variables → Actions → Variables* : `API_URL` = l'URL du Worker. *Settings → Pages* : source **GitHub Actions**.

| Variable | Où | Rôle |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | secret Worker | Token donné par @BotFather |
| `TELEGRAM_ADMIN_CHAT_ID` | secret Worker | Votre identifiant Telegram (réponse à `/id`) |
| `ALLOWED_ORIGINS` | `worker/wrangler.toml` | Sites autorisés à appeler l'API |
| `API_URL` | variable GitHub Actions | URL du Worker, injectée dans le site |

## Développement local

```bash
npm install
printf 'TELEGRAM_BOT_TOKEN=...\nTELEGRAM_ADMIN_CHAT_ID=...\n' > worker/.dev.vars
npm run worker:dev    # API sur http://localhost:8787
npm run dev           # site sur http://localhost:3000
```
