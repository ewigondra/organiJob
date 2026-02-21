# Deploiement backend (Render + PostgreSQL)

## Prerequis
- Un compte Render
- Un repository Git contenant ce projet

## Etapes
1. Pousser le projet sur GitHub.
2. Dans Render: New + Blueprint.
3. Selectionner le repository.
4. Render lit `render.yaml` et cree:
   - 1 base PostgreSQL (`organijob-db`)
   - 1 Web Service Docker (`organijob-backend`)
5. Lancer le deploy.

## Variables d'environnement
- `DATABASE_URL` est branchee automatiquement depuis la base Render.
- `PGSSLMODE=require` est deja defini dans `render.yaml`.

## URL de production
- Apres deploy, recuperer l'URL du Web Service.
- Ouvrir l'application via cette URL pour synchroniser entre appareils.

## Verification rapide
1. Creer un compte (email + mot de passe).
2. Ajouter un contact.
3. Ouvrir la meme URL sur un autre appareil.
4. Se connecter avec le meme compte.
5. Verifier que le contact est present.
