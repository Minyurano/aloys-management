# ALOYS MANAGEMENT — Registre financier partagé du foyer

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?logo=javascript&logoColor=black)
![Sans dépendance](https://img.shields.io/badge/dépendances-aucune-2ea44f)
![License](https://img.shields.io/badge/License-MIT-blue)

Application web légère, en **un seul fichier HTML**, pour gérer la caisse commune d'un foyer : **dépôts**, **dépenses**, **factures de retrait**, **objectif d'épargne**, statistiques et prévisions. Montants en dirhams (MAD).

**Démo :** https://minyurano.github.io/aloys-management/

---

## Fonctionnalités

| Espace | Contenu |
|---|---|
| **Données** | Saisie des dépôts et des dépenses, base de données des transactions, état de la caisse, factures de retrait (téléchargeables) |
| **Rapports** | Statistiques descriptives (moyenne, médiane, écart-type, quartiles), histogramme et boîte à moustaches, prévision du solde par régression linéaire |
| **Administration** | Solde de la caisse, objectif d'épargne, suppression d'entrées : accès protégé par un code administrateur |
| **Export** | Rapport CSV / JSON, **sauvegarde complète et restauration** |

Autres caractéristiques :
- **Membre actif** sélectionnable, avec avatar et initiales.
- **Annonces vocales** (synthèse vocale du navigateur), activables ou désactivables.
- **Interface responsive**, utilisable sur ordinateur et sur téléphone.

## Utilisation

1. Ouvrir la démo en ligne, ou télécharger `index.html` et l'ouvrir dans un navigateur. Aucune installation n'est nécessaire.
2. Choisir le membre actif dans **« Agir en tant que »**.
3. Enregistrer les dépôts et les dépenses dans **Données**.
4. Consulter les statistiques dans **Rapports**.

## Stockage des données et sauvegarde

Les données sont enregistrées dans le **navigateur** (`localStorage`). Il n'y a pas de serveur, ce qui a deux conséquences :
- chaque appareil et chaque navigateur a **son propre registre** ;
- vider les données du navigateur **efface le registre**.

**Bonne pratique :** dans **Export**, cliquez régulièrement sur **« Sauvegarde complète »**. Un fichier JSON contenant toutes les transactions, les factures et l'objectif est alors téléchargé. Le bouton **« Restaurer une sauvegarde »** recharge ce fichier, sur le même appareil ou sur un autre.

## Sécurité

- Le code administrateur n'est **pas écrit en clair** dans le code source : seule son empreinte **SHA-256** y figure.
- C'est une protection **côté navigateur**, adaptée à un usage familial. Elle ne remplace pas une authentification serveur.

**Changer le code administrateur :** calculez l'empreinte SHA-256 du nouveau code, puis remplacez la valeur de `ADMIN_HASH` dans `index.html`. En PowerShell :

```powershell
$code = Read-Host "Nouveau code"
-join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($code)) | ForEach-Object { $_.ToString("x2") })
```

## Structure

```
.
├── index.html   # Application complète (HTML + CSS + JavaScript)
├── LICENSE
└── README.md
```

## Pistes d'évolution
- **Synchronisation entre les membres**, via une base de données en ligne (Firebase ou Supabase), pour un registre réellement partagé en temps réel.
- **Authentification individuelle** de chaque membre.
- **Export PDF** mensuel du registre.

## Auteur

**Aloys MINYURANO** — [GitHub](https://github.com/Minyurano) · [LinkedIn](https://www.linkedin.com/in/aloys-minyurano-871717402)

Distribué sous licence [MIT](LICENSE).
