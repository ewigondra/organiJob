# Deploiement backend (Render)

## Prerequis
- Un compte Render
- Un repository Git contenant ce projet

## Etapes
1. Pousser le projet sur GitHub.
2. Dans Render: New + Web Service.
3. Connecter le repository.
4. Render detecte `render.yaml` et le `Dockerfile`.
5. Lancer le deploy.

## URL de production
- Apres deploy, recuperer l'URL Render.
- Ouvrir l'application depuis cette URL pour utiliser la meme base entre appareils.

## Notes importantes
- Stockage actuel: `data/db.json` (fichier local au conteneur).
- En production robuste, il faut une vraie base distante (PostgreSQL) pour persistance durable.
