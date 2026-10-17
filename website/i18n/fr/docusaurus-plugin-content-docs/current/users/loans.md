---
title: Prêts
sidebar_position: 6
---

# Prêts

Suivez chaque prêt que vous remboursez — immobilier, auto, crédit à la
consommation — et voyez à tout moment **le capital restant dû**, **la date
de fin** et **ce qu'il coûte vraiment** : intérêts + assurance + frais +
indemnités de remboursement anticipé.

Les prêts ont leur propre page (**Prêts** dans le menu). Ils ne modifient
ni vos comptes ni vos transactions.

## Créer un prêt

**Nouveau prêt** demande :

- le **montant emprunté**, la date de **première échéance**, le **taux
  d'intérêt** (% par an, nominal — celui de votre offre de prêt) ;
- le **taux d'assurance** (% par an ; `0` pour la plupart des crédits à la
  consommation) et s'il s'applique au **capital initial** (même montant
  chaque mois) ou au **capital restant dû** (dégressif) ;
- les **frais** : dossier, garantie, courtage.

Puis l'**échéancier** :

- **Périodes avant la dernière** — facultatives. Chacune a un nombre de
  mois et un type :
  - *Échéance* : vous payez une mensualité fixe (ex. un palier réduit) ;
  - *Différé partiel* : vous ne payez que les intérêts (et l'assurance) ;
    le capital ne bouge pas — typique pendant une construction ;
  - *Différé total* : vous ne payez que l'assurance ; les intérêts
    s'ajoutent au capital restant dû ;
  - chaque période peut avoir son propre taux (taux variable,
    renégociation).
- **Dernière période** — Ledger calcule ce que vous ne connaissez pas :
  - *Je connais la date de fin* → elle calcule la mensualité ;
  - *Je connais la mensualité* → elle calcule la date de fin.
- **Remboursements anticipés** — une somme versée un mois donné, qui
  **baisse la mensualité** (date de fin conservée) ou **raccourcit le
  prêt** (mensualité conservée), avec les indemnités facturées par la
  banque.

L'aperçu se met à jour pendant la saisie. Les montants acceptent
`245 000` comme `3,85`.

## Consulter un prêt

Ouvrez une carte : capital restant dû, part déjà remboursée, intérêts
payés, mois restants, coût total détaillé, courbe du capital restant dû,
liste des périodes et tableau d'amortissement par année. Une échéance
compte comme payée dès que sa date est passée.

**Changer la mensualité à partir de…** gère « à partir de mars je passe à
1 400 € » : les échéances précédentes restent telles quelles et la date de
fin est recalculée.

## « Et si… » et simulations

**Et si…** permet de tester un remboursement anticipé, une nouvelle
mensualité ou un nouveau taux, et compare le résultat au prêt actuel
(date de fin, mensualité, coût total, économie). Ensuite **Abandonner**,
**Appliquer au prêt** ou **Enregistrer comme simulation**.

Les simulations sont dans l'onglet **Simulations**. Une simulation issue
d'un prêt garde la comparaison avec ce prêt ; si vous supprimez le prêt,
la simulation reste. **Nouvelle simulation** fonctionne aussi pour un prêt
que vous n'avez pas encore.

## Comment les chiffres sont calculés

- Taux mensuel = taux annuel ÷ 12 ; intérêts et assurance sont arrondis au
  centime chaque mois ; la dernière échéance absorbe les centimes restants,
  le capital restant dû finit donc toujours à 0 exactement.
- Échéances mensuelles uniquement ; 50 ans maximum.
- Le TAEG n'est pas calculé.
