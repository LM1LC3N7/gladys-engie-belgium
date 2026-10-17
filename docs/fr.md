# ENGIE Belgique pour Gladys Assistant

Intégration **non officielle**, sans lien avec ENGIE. Elle utilise l'API non
officielle de l'application ENGIE Smart (la même que la bibliothèque
aioengiebelgium et l'intégration Home Assistant `hass-engie-be`). **Elle n'a
jamais été testée avec un vrai compte** : les réponses d'ENGIE ont été
reconstituées à partir de ces projets. Signalez tout problème sur GitHub.

## Ce qu'elle fait

Lecture seule, toutes les 6 heures (ENGIE met ses données à jour au plus une
fois par jour) :

- **Prix de l'électricité de votre contrat** (€/kWh, TVA comprise) : prix
  simple, prix jour et prix nuit avec un compteur bi-horaire, prix de
  l'injection si vous en avez un.
- **Prix du gaz** (€/kWh, TVA comprise).
- **Consommation électrique par jour**, envoyée datée au **suivi énergétique**
  de Gladys (Gladys 5.2 ou plus récent), avec le retard d'ENGIE (en général
  deux jours ou plus). La consommation et l'injection du dernier jour publié
  sont aussi affichées en capteurs simples.
- **Consommation de gaz** du dernier jour publié, en **capteur simple** : le gaz
  n'entre jamais dans le suivi énergétique (Gladys le facturerait au tarif de
  l'électricité).
- **Compte** : montant ouvert à payer et prochaine échéance, montant et date de
  la prochaine facture d'acompte.

Rien n'est jamais modifié sur votre compte ENGIE.

## Avant de commencer

- Gladys 5.2.0 ou plus récent.
- Un compte ENGIE Belgique de particulier, avec la double authentification
  (ENGIE envoie un code par SMS ou e-mail à chaque connexion).
- **Fortement conseillé : un utilisateur ENGIE dédié à Gladys.** Sinon, chaque
  connexion avec le même utilisateur sur engie.be ou dans l'application ENGIE
  Smart peut mettre fin à la session de Gladys et demander un nouveau code
  (constaté par l'intégration Home Assistant). Vous
  pouvez créer un utilisateur supplémentaire depuis votre espace ENGIE
  (gestion des accès) et lui donner accès à votre numéro de client.
- La consommation par jour demande un compteur numérique.

## Installation

1. Installez l'intégration depuis le store de Gladys.
2. Dans sa configuration, saisissez l'**e-mail** et le **mot de passe** ENGIE,
   choisissez où va la consommation électrique (voir plus bas), puis
   **enregistrez**.
3. Appuyez sur **Envoyer le code de vérification** et choisissez SMS ou
   e-mail : l'intégration se connecte et ENGIE vous envoie un code.
4. Dans les 10 minutes, saisissez ce code dans **Vérifier le code**.
5. La première lecture se fait aussitôt. Ajoutez les appareils depuis l'onglet
   **Découverte** : un par compteur (électricité, gaz) et un par contrat.

La session est ensuite gardée : pas de code aux redémarrages. Si ENGIE y met
fin, l'état de l'intégration le dit : recommencez les étapes 3 et 4.

**Tester la connexion** lit une fois le compte avec la session gardée, sans
code.

## Fluvius et la consommation électrique

Si l'intégration **Fluvius** (ou une autre intégration de compteur) envoie déjà
votre consommation électrique au suivi énergétique, **n'utilisez pas les deux
pour la même consommation** : elle serait comptée deux fois. Choisissez alors
**Capteur seulement** dans « Consommation électrique par jour » **avant** de
créer l'appareil électricité ENGIE : il n'aura pas de fonctionnalité de
consommation pour le suivi énergétique, seulement le capteur du dernier jour
publié. Changer ce choix ensuite demande de supprimer l'appareil et de le
recréer.

## Les appareils

| Appareil                 | Fonctionnalités                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ENGIE electricity (EAN…) | Prix, prix jour, prix nuit, prix de l'injection (€/kWh) ; consommation par jour (suivi énergétique) ; consommation et injection du dernier jour publié (kWh) |
| ENGIE gas (EAN…)         | Prix du gaz (€/kWh) ; consommation du dernier jour publié (kWh)                                                                                              |
| ENGIE account (…)        | Montant ouvert (€), prochaine échéance, montant de l'acompte (€), prochaine facture d'acompte                                                                |

Les prix présents dépendent de votre contrat au moment de créer l'appareil (un
contrat dynamique n'a pas de prix fixe : pas de fonctionnalité de prix). Les
prix sont des capteurs : l'intégration ne déclare pas de contrat d'énergie
dans Gladys ; saisissez votre contrat dans le suivi énergétique si vous voulez
le coût.

## Vie privée et sécurité

- Le mot de passe est gardé par Gladys dans sa base (**non chiffré**), jamais
  réaffiché, et envoyé seulement à ENGIE (account.engie.be), quand vous
  appuyez sur « Envoyer le code de vérification ».
- Le **jeton de session** (refresh token) est gardé dans `/data` du conteneur
  (fichier lisible par le seul utilisateur du conteneur), avec une empreinte
  de l'e-mail, jamais l'e-mail ni le mot de passe. Il change à chaque
  renouvellement.
- Aucun e-mail, mot de passe, code, jeton ni texte renvoyé par ENGIE n'est
  écrit dans les journaux.

## Rythme et erreurs

- Une lecture toutes les 6 heures ; un renouvellement de la session (sans
  lecture de données) toutes les heures pour la garder en vie.
- ENGIE demande de ralentir (429) : tous les appels (lectures, boutons) sont
  suspendus le temps demandé, entre 1 minute et 6 heures, même après un
  redémarrage.
- Une donnée secondaire (consommation, solde, acompte, contrats) qui échoue
  garde sa valeur précédente ; les autres données sont lues quand même.
- Une erreur passagère (réseau, ENGIE indisponible) : nouvel essai dans
  15 min, puis 30 min, 1 h, 2 h, 4 h (jamais au-delà de 6 h).
- Une autre erreur : nouvel essai à la lecture suivante (6 heures au plus), ou
  avec **Tester la connexion**.
- Un jeton tout neuf refusé : nouvel essai dans 6 h, puis 12 h, puis toutes les
  24 h.

## Limites

- API non officielle : ENGIE peut la changer à tout moment.
- Jamais testé avec un vrai compte.
- La consommation arrive avec le retard d'ENGIE ; un jour marqué incomplet
  par ENGIE est envoyé plus tard, une fois complet, ou tel quel s'il a plus de
  3 jours (il ne changera plus).
- Plusieurs compteurs d'électricité (ou de gaz) sur un même contrat : la
  consommation, donnée par contrat, n'est pas répartie (seuls les prix sont
  lus).
- Fuseau horaire : Europe/Brussels pour les jours ; réglez Gladys sur la même
  heure (Bruxelles, Paris, Amsterdam).

## Crédits

Logique portée de [aioengiebelgium](https://github.com/DaanVervacke/aioengiebelgium)
et de [hass-engie-be](https://github.com/DaanVervacke/hass-engie-be), par Daan
Vervacke (licence MIT, voir `THIRD_PARTY_NOTICES.md`).
