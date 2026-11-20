# ALOYS MANAGEMENT — Registre financier partagé du foyer

[![Tests](https://github.com/Minyurano/aloys-management/actions/workflows/ci.yml/badge.svg)](https://github.com/Minyurano/aloys-management/actions/workflows/ci.yml)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%C2%B7%20Auth%20%C2%B7%20Realtime%20%C2%B7%20Storage-3FCF8E?logo=supabase&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-4-FF6384?logo=chartdotjs&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

Application web de gestion de la **caisse commune d'une colocation** : dépôts, dépenses catégorisées avec **photo du reçu**, objectif d'épargne, **budgets avec alertes**, **qui doit combien à qui**, tableau de bord analytique avec **modèles de prévision comparés**, **assistant en langage naturel** et **rapport mensuel PDF**.
Plusieurs **foyers** indépendants peuvent utiliser la même application, chacun avec sa devise, ses membres et ses données, isolés par la base de données.

**Application :** https://minyurano.github.io/aloys-management/ (installable sur téléphone)

---

## Fonctionnalités

| Espace | Contenu |
|---|---|
| **Données** | Dépôts, factures de retrait avec **catégorie suggérée par IA** et **photo du reçu**, base de données des transactions, état de la caisse |
| **Rapports** | Statistiques descriptives, **Analyse & modèles**, prévision, **Qui doit combien ?**, **Budgets et alertes**, **Assistant du registre** |
| **Administration** | Solde, objectif d'épargne, **foyer** (nom, devise, code d'invitation), membres et rôles, journal d'audit |
| **Export** | **Rapport mensuel PDF**, CSV (avec catégories), JSON, sauvegarde et restauration |

- **Temps réel** et **notifications** : une opération d'un colocataire apparaît immédiatement chez les autres, avec une alerte (et une notification système si l'onglet est en arrière-plan). Alertes de **seuil de caisse** et de **dépassement de budget**.
- **Application installable (PWA)** : consultation hors connexion des dernières données.
- **7 devises** (MAD, EUR, USD, BIF, MRU, XOF, CAD), interface responsive, annonces vocales.

## Foyers, comptes et rôles

À l'inscription, chacun **crée un foyer** (il en devient administrateur et reçoit un **code d'invitation**) ou **rejoint un foyer** avec ce code. Un compte qui rejoint un foyer reste **en attente** jusqu'à sa validation par l'administrateur.

| Rôle | Droits (dans son foyer uniquement) |
|---|---|
| **Administrateur** | Tout : saisir au nom d'un membre, supprimer, objectif, budgets, devise, code d'invitation, membres, journal d'audit |
| **Membre** | Saisir des dépôts et des factures **en son propre nom**, joindre des reçus, tout consulter |
| **Lecture seule** | Consulter |
| **En attente** | Aucun accès |

Ces règles sont appliquées **par le serveur** (PostgreSQL Row Level Security), y compris pour les fichiers des reçus (Storage) : un foyer ne peut jamais lire ni écrire les données d'un autre, et un membre ne peut ni supprimer, ni écrire au nom d'un autre, ni s'attribuer un rôle. Ces garanties sont vérifiées par **31 tests automatiques** à chaque modification du code.

## Intelligence artificielle et science des données

| Module | Ce qu'il fait | Méthode |
|---|---|---|
| **Classement automatique des dépenses** | Propose la catégorie à partir de la description (« Marjane huile riz » → Courses) | Classifieur **bayésien naïf multinomial** (lissage de Laplace), amorcé par un lexique adapté au Maroc puis **ré-entraîné sur l'historique du foyer** |
| **Prévision du solde** | Solde à 30 jours avec intervalle de prévision à 95 % | **5 modèles en compétition** : naïf, dérive, régression linéaire (MCO), lissage de Holt, **Holt-Winters saisonnier** (cycle hebdomadaire) ; sélection par **validation temporelle hold-out** (MAE, RMSE) |
| **Comparaison des membres** | Les montants diffèrent-ils selon le membre ? Les contributions sont-elles équilibrées ? | **Test de Kruskal-Wallis** (H, p, η²), **indice de Gini** |
| **Anomalies** | Signale les montants inhabituels | **z-score robuste** d'Iglewicz-Hoaglin (médiane, MAD, seuil 3,5) |
| **Distribution** | Histogrammes lisibles même avec des valeurs extrêmes | Règle de **Freedman-Diaconis**, classe de débordement au-delà de Q3 + 3·IQR, asymétrie |
| **Budgets** | Dépassement prévu et date estimée | Projection de fin de mois au rythme courant |
| **Équilibre** | Qui doit combien à qui | Positions nettes (parts égales ou au prorata des dépenses), règlement glouton en **au plus n − 1 virements** |
| **Assistant** | Répond en français : « Combien Billy a déposé en octobre ? », « Quel solde à la fin du mois ? » | Analyse d'intentions (membres, périodes, catégories, mesures) **exécutée localement**, sans envoi de données à un service externe |

Les résultats statistiques sont **vérifiés contre SciPy** dans les tests (Kruskal-Wallis, loi du khi-deux).

## Architecture

```
 Navigateur / téléphone (PWA)
   index.html ..... interface, synchronisation, comptes
   analytics.js ... tableau de bord, statistiques, modèles de prévision
   categories.js .. catégories, classifieur bayésien naïf
   features.js .... équilibre, budgets, assistant, rapport PDF, notifications
        │  supabase-js : authentification, requêtes, temps réel, fichiers
        ▼
 Supabase
   ├── Auth ........ comptes, confirmation d'e-mail, mot de passe oublié
   ├── PostgreSQL .. foyers · profiles · transactions · factures · settings · audit_log
   │     └── RLS ... isolation par foyer + droits selon le rôle
   ├── Storage ..... reçus (dossier privé par foyer)
   ├── Triggers .... inscription (créer / rejoindre un foyer), journal d'audit
   └── Realtime .... diffusion des changements aux membres connectés
```

## Tests et intégration continue

```bash
npm test          # 16 tests : statistiques, modèles, classifieur, équilibre, budgets, assistant
```

GitHub Actions ([`ci.yml`](.github/workflows/ci.yml)) exécute à chaque modification :
1. les tests JavaScript (Node 22) ;
2. l'installation de la base sur PostgreSQL 16, **deux fois** (idempotence) ;
3. les **31 tests de sécurité** ([`tests/sql/rls.test.sql`](tests/sql/rls.test.sql)) : isolation des foyers, rôles, codes d'invitation, reçus ;
4. la **migration** depuis la version précédente ([`tests/sql/migration.test.sql`](tests/sql/migration.test.sql)).

## Installation (nouveau déploiement)

1. **Supabase :** créer un projet gratuit, puis exécuter [`supabase_setup.sql`](supabase_setup.sql) dans **SQL Editor** (remplacer `__ADMIN_EMAIL__` par l'e-mail de l'administrateur historique, ou par une adresse quelconque). Le script est idempotent et met à jour une installation existante.
2. **Authentification :** dans **Authentication → URL Configuration**, renseigner l'adresse publique de l'application comme **Site URL** et **Redirect URL**.
3. **Application :** dans `index.html`, renseigner `SUPABASE_URL` et la clé **publishable** (`SUPABASE_KEY`). Ces deux valeurs sont publiques par conception : la sécurité repose sur les règles RLS.
4. **Hébergement :** GitHub Pages ou tout hébergement statique en HTTPS.

## Structure

```
.
├── index.html               # Interface, synchronisation Supabase, comptes et foyers
├── analytics.js             # Tableau de bord analytique, statistiques, modèles de prévision
├── categories.js            # Catégories de dépenses, classifieur bayésien naïf
├── features.js              # Équilibre, budgets, assistant, rapport PDF, notifications
├── supabase_setup.sql       # Base de données : foyers, RLS, audit, temps réel, stockage des reçus
├── sw.js, manifest.json     # Application installable (PWA)
├── icons/
├── tests/                   # Tests unitaires (node:test) et tests SQL de sécurité
├── .github/workflows/ci.yml # Intégration continue
├── package.json
├── LICENSE
└── README.md
```

## Feuille de route

- [x] Registre partagé en ligne, comptes, rôles, journal d'audit, temps réel, PWA
- [x] Plusieurs foyers, codes d'invitation, plusieurs devises
- [x] Catégories avec classement automatique, reçus photo, budgets et alertes
- [x] Qui doit combien à qui, rapport mensuel PDF, notifications
- [x] Comparaison de modèles de prévision (dont Holt-Winters), assistant en langage naturel
- [x] Tests automatiques et intégration continue
- [ ] Notifications push application fermée (Edge Function + Web Push)
- [ ] Modèles SARIMA / Prophet côté serveur quand l'historique dépassera un an
- [ ] Interface en anglais et en arabe

## Auteur

**Aloys MINYURANO** — [GitHub](https://github.com/Minyurano) · [LinkedIn](https://www.linkedin.com/in/aloys-minyurano-871717402)

Distribué sous licence [MIT](LICENSE).
