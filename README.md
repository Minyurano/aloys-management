# ALOYS MANAGEMENT — Registre financier partagé du foyer

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Auth%20%2B%20Realtime-3FCF8E?logo=supabase&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

Application web de gestion de la **caisse commune d'un foyer** : **dépôts**, **dépenses**, **factures de retrait**, **objectif d'épargne**, statistiques et prévisions (montants en MAD). Le registre est **partagé en temps réel** entre tous les membres, protégé par des **comptes individuels** et des **rôles**, et chaque opération est tracée dans un **journal d'audit**.

**Application :** https://minyurano.github.io/aloys-management/ (installable sur téléphone)

---

## Fonctionnalités

| Espace | Contenu |
|---|---|
| **Données** | Dépôts, dépenses, factures de retrait (téléchargeables), base de données des transactions, état de la caisse |
| **Rapports** | Statistiques descriptives, histogramme, boîte à moustaches, prévision du solde par régression linéaire |
| **Administration** | Solde de la caisse, objectif d'épargne, **gestion des membres et des rôles**, **journal d'audit** |
| **Export** | Rapport CSV / JSON, sauvegarde complète et restauration |

- **Temps réel :** une opération faite par un membre apparaît immédiatement chez les autres.
- **Application installable (PWA) :** icône sur l'écran d'accueil, ouverture même hors connexion (consultation des dernières données).
- **Annonces vocales** activables, interface responsive (ordinateur et téléphone).

## Comptes et rôles

Chaque personne crée **son propre compte** (nom, e-mail, mot de passe) depuis l'écran de connexion, puis confirme son e-mail. Un nouveau compte est **en attente** : il n'a accès à rien tant que l'administrateur ne l'a pas validé.

| Rôle | Droits |
|---|---|
| **Administrateur** | Tout : saisir au nom de n'importe quel membre, supprimer, fixer l'objectif, gérer les membres, consulter le journal d'audit |
| **Membre** | Saisir des dépôts et des factures **en son propre nom**, tout consulter |
| **Lecture seule** | Consulter |
| **En attente** | Aucun accès |

Ces règles sont appliquées **par le serveur** (PostgreSQL Row Level Security) et pas seulement par l'interface : un membre ne peut ni supprimer une entrée, ni écrire au nom d'un autre, ni s'attribuer un rôle, même en contournant l'application.

## Architecture

```
 Navigateur / téléphone (index.html, PWA)
        │  supabase-js : authentification, requêtes, temps réel
        ▼
 Supabase
   ├── Auth ............ comptes, confirmation d'e-mail, mot de passe oublié
   ├── PostgreSQL ...... profiles · transactions · factures · settings · audit_log
   │     └── RLS ....... droits selon le rôle (admin / membre / lecture / attente)
   ├── Triggers ........ création des profils, journal d'audit automatique
   └── Realtime ........ diffusion des changements à tous les membres connectés
```

## Installation (nouveau déploiement)

1. **Supabase :** créer un projet gratuit, puis exécuter [`supabase_setup.sql`](supabase_setup.sql) dans **SQL Editor**. Remplacez auparavant `__ADMIN_EMAIL__` par l'e-mail de l'administrateur. Le script peut être relancé sans risque.
2. **Authentification :** dans **Authentication → URL Configuration**, renseigner l'adresse publique de l'application comme **Site URL** et comme **Redirect URL**.
3. **Application :** dans `index.html`, renseigner `SUPABASE_URL` et la clé **publishable** (`SUPABASE_KEY`) du projet. Ces deux valeurs sont publiques par conception : la sécurité repose sur les règles RLS.
4. **Hébergement :** GitHub Pages ou tout hébergement statique en HTTPS.

## Structure

```
.
├── index.html            # Application (HTML + CSS + JavaScript)
├── supabase_setup.sql    # Base de données : tables, sécurité RLS, audit, temps réel
├── sw.js                 # Service worker (installation, hors connexion)
├── manifest.json         # Manifeste PWA
├── icons/                # Icônes de l'application
├── LICENSE
└── README.md
```

## Migration depuis la version locale

Les données saisies avec l'ancienne version (stockées dans le navigateur) sont détectées automatiquement à la première connexion de l'administrateur. Un bouton **« Importer dans le registre en ligne »** les transfère vers la base partagée. Il est aussi possible de passer par **Export → Sauvegarde complète**, puis **Restaurer une sauvegarde**.

## Feuille de route

- [x] Registre partagé en ligne, comptes, rôles, journal d'audit, temps réel
- [x] Application installable (PWA), consultation hors connexion
- [ ] Plusieurs foyers par application, invitations par lien
- [ ] Plusieurs devises et plusieurs langues (français, anglais, arabe)
- [ ] Partage des dépenses (« qui doit combien à qui »), budgets par catégorie
- [ ] Notifications, rapports PDF mensuels, justificatifs photo

## Auteur

**Aloys MINYURANO** — [GitHub](https://github.com/Minyurano) · [LinkedIn](https://www.linkedin.com/in/aloys-minyurano-871717402)

Distribué sous licence [MIT](LICENSE).
