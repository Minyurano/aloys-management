# Historique des versions

## 4.0.0 — novembre 2026
- **Plusieurs foyers** : création ou adhésion par code d'invitation, isolation complète des données (RLS), 7 devises.
- **Catégories de dépenses** avec suggestion automatique (classifieur bayésien naïf ré-entraîné sur l'historique du foyer).
- **Reçus photo** stockés dans un dossier privé par foyer (Supabase Storage), compressés côté navigateur.
- **Qui doit combien ?** : parts égales ou au prorata des dépenses, règlement en au plus n − 1 virements.
- **Budgets et alertes** : budget mensuel par catégorie, projection de fin de mois, seuil d'alerte de la caisse.
- **Prévision** : ajout du modèle **Holt-Winters saisonnier** (5 modèles comparés par validation temporelle).
- **Assistant** en langage naturel (analyse locale), **rapport mensuel PDF**, **notifications**.
- **Qualité** : code séparé en modules (`styles.css`, `app.js`, `cloud.js`), 16 tests unitaires, 31 tests de sécurité SQL, intégration continue GitHub Actions.

## 3.0.0
- Tableau de bord **Analyse & modèles** : camemberts, histogramme de Freedman-Diaconis, comparaison de 4 modèles de prévision, test de Kruskal-Wallis, indice de Gini, détection d'anomalies.

## 2.0.0
- Version en ligne : **comptes individuels**, rôles, registre partagé en **temps réel** (Supabase), **journal d'audit**, application installable (**PWA**).

## 1.0.0
- Registre local du foyer : dépôts, dépenses, factures, objectif, statistiques, export.
