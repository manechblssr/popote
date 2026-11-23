# Objectif du projet

Concevoir, développer et déployer sur mon compte GitHub une application web mobile-first de gestion hebdomadaire des courses, des ingrédients du placard et des repas pour ma famille, avec validation des nouveaux utilisateurs via mon bot Telegram.

## Règles d'exécution (prioritaires)

1. **Lecture des skills :** Lis en priorité les fichiers `skills` disponibles dans l'environnement avant de démarrer l'architecture ou le code, et applique leurs conventions.
2. **Optimisation des tokens :** Minimise strictement ta consommation de tokens (pas de blabla, lectures ciblées des fichiers, éditions chirurgicales) sans jamais dégrader la qualité, la robustesse ni la finition du code.
3. **Orientation résultat :** Livre une application complète, fonctionnelle de bout en bout, sans données fictives codées en dur à la place de la vraie logique.
4. **Déploiement GitHub :** Crée le dépôt sur mon compte GitHub, pousse l'intégralité du code proprement et configure le déploiement (ex. : Vercel ou équivalent gratuit compatible avec les webhooks Telegram et la base de données temps réel).

---

## Résultat attendu (Produit fini)

### 1. Connexion familiale sécurisée par bot Telegram
- **Écran d'entrée minimaliste :** L'utilisateur saisit uniquement son prénom pour accéder à l'application.
- **Validation des nouveaux arrivants :** Lorsqu'un prénom est utilisé pour la première fois (ou depuis un nouvel appareil non reconnu), l'application envoie immédiatement un message sur mon bot Telegram contenant le prénom saisi et deux boutons interactifs : **Accepter** et **Refuser**.
- **Basculer en temps réel :** Pendant l'attente, l'utilisateur voit un écran sobre d'attente de validation. Dès que je clique sur **Accepter** dans Telegram, son écran bascule automatiquement sur l'application (sans rafraîchissement manuel) et sa session reste mémorisée pour ses futures visites. Si je clique sur **Refuser**, l'accès lui est refusé.

### 2. Paramétrage de la semaine en amont
- Avant de composer les courses ou les menus, un panneau de configuration rapide permet de définir :
  - Le **nombre de personnes par défaut** pour la semaine.
  - Les **créneaux actifs** de la semaine (choix rapide entre *Midi et Soir*, *Soir uniquement*, ou activation/désactivation libre créneau par créneau du lundi au dimanche).
- Possibilité d'ajuster ponctuellement le nombre de convives sur un repas précis (ex. : invité en plus le vendredi soir).

### 3. Gestion collaborative des courses et « Ingrédients récents »
- **Collaboration en temps réel :** Tous les membres validés voient les mêmes données synchronisées instantanément et peuvent ajouter, modifier, cocher ou supprimer des éléments.
- **Double source d'ingrédients :**
  - Les **courses de la semaine** (avec quantités ajustables selon le nombre de personnes).
  - Les **ajouts / fonds de placard** (ex. : *pâtes, riz, pain à burger, épices, sauces...*).
- **Ingrédients récents :** Une section dédiée mémorise automatiquement les ingrédients utilisés les semaines précédentes et permet de les réinjecter dans la liste de la semaine en un seul clic.

### 4. Concoctage des plats
- Interface fluide permettant de créer les plats de la semaine en piochant dans les courses enregistrées et les produits du placard.
- Chaque plat associe ses ingrédients avec leurs **quantités calculées en fonction du nombre de personnes** défini pour le repas.
- Assignation directe de chaque plat à un créneau du planning (jour + midi ou soir).

### 5. Planning hebdomadaire final
- En fin de parcours (et accessible à tout moment via la navigation), un **planning de la semaine** ultra-lisible présente du lundi au dimanche :
  - Uniquement les créneaux actifs (midi et/ou soir).
  - Le nom du plat prévu.
  - Le nombre de personnes qui mangent à ce repas.
  - La liste complète et claire des ingrédients nécessaires avec leurs quantités exactes.

### 6. Design, UX et architecture
- **Interface :** Épurée, très lisible, contrastée, pensée en priorité pour une utilisation sur smartphone (en rayon au supermarché comme en cuisine).
- **Architecture technique :** Stack moderne gratuite adaptée au temps réel multi-utilisateurs et aux webhooks Telegram (ex. : Next.js + base de données temps réel type Supabase/Firebase + API Telegram Bot).

---

## Livrable final attendu
- Le lien vers le dépôt GitHub créé et l'URL de l'application déployée.
- Un récapitulatif court des variables d'environnement à renseigner (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`, clés BDD) et la commande ou manipulation unique pour activer le webhook Telegram si nécessaire.