# STEP → Données d'entrée Simcenter Flowmaster

Outil HTML **autonome et 100 % local** qui lit une maquette de tuyauterie au format STEP (AP203 / AP214 / AP242), reconstruit le réseau (nœuds, tubes, coudes, tés, variations de section, équipements) et génère un **dossier de données Excel** listant toutes les entrées nécessaires à un calcul Simcenter Flowmaster, avec l'origine de chaque valeur.

> L'Excel est un *data book* à saisir ou à importer par script. Ce n'est pas un fichier réseau natif Flowmaster.

## Utilisation

Ouvrir `dist/STEP_vers_Flowmaster.html` dans un navigateur (Chrome, Edge, Firefox), puis charger ou glisser-déposer un fichier STEP. Aucune installation n'est nécessaire, et rien n'est envoyé sur le réseau : l'analyse tourne dans un Web Worker, et dans le fil principal si le navigateur le refuse.

Le mode d'emploi et la liste des limites connues se trouvent dans l'onglet « Aide & limites » de l'outil.

## Ce que fait l'outil

- **Lecture STEP en JavaScript pur :** résolution des références, unités de longueur et d'angle lues par contexte de représentation, arbre produit (`NEXT_ASSEMBLY_USAGE_OCCURRENCE`), transformations d'assemblage (`ITEM_DEFINED_TRANSFORMATION`, `MAPPED_ITEM`).
- **Cotes issues des surfaces analytiques uniquement :**
  - cylindres → Di, De, épaisseur et longueur ;
  - tores → rayon de cintrage, R/D et angle ;
  - cônes → D1, D2, angle et longueur ;
  - intersections d'axes → tés, piquages et coudes à onglet.
- **Construction du réseau :** coïncidence des extrémités (tolérance réglable), extrémités libres, boucles, sous-réseaux, numérotation stable (`N001`, `P001`, `B001`, `T001`, `R001`, `EQ001`).
- **Équipements :** repérés par mots-clés FR/EN dans le nom CAO et insérés comme boîtes noires. Leurs performances ne sont jamais inventées.
- **Cas dégradés signalés :** géométrie maillée, B-splines, tube modélisé par son seul De (épaisseur proposée selon ASME B36.10 / EN 10255 / EN 1057), pièces non nommées, perçages de bride, colliers.
- **Export Excel sans dépendance :** ZIP + SpreadsheetML. Chaque valeur porte une colonne « Origine » (Extrait STEP #n, Calculé, Par défaut + source, Saisi, À compléter). L'export comprend un onglet « À compléter » trié par criticité et un contrôle de vraisemblance (Colebrook + K Crane TP-410, vitesse d'onde).

## Structure

```
src/        sources (core.js = moteur STEP, data.js = référentiel et tables, xlsx.js, app.js, shell.html)
build.py    assemble src/ en un seul fichier → dist/STEP_vers_Flowmaster.html
dist/       outil livrable (fichier unique)
tests/      tests du moteur, tests navigateur, générateurs des STEP de référence
```

## Développement

```bash
python3 build.py      # régénère dist/ après modification de src/
npm test              # tests du moteur (Node ≥ 18, aucune dépendance)
```

Ne modifiez pas `dist/` à la main. L'intégration continue vérifie que `dist/` correspond à `src/`.

## Tests

`tests/engine.test.js` compare les cotes extraites aux cotes connues de cinq STEP de référence, avec un écart toléré de 0,1 % :

| Fichier | Contenu |
|---|---|
| `ref1_tube_droit.stp` | tube droit DN50 |
| `ref2_circuit_coudes_te.stp` | coudes 90° et 45°, réduction conique, té ; fichier en **mètres** |
| `ref3_assemblage_pompe_vanne.stp` | pompe et vanne nommées, sous-ensemble transformé, pièce instanciée deux fois |
| `ref4_cas_avances.stp` | tube cintré monobloc, piquage soudé, onglet, élargissement brusque, bride percée, tube plein, collier, réservoir, sous-ensemble tourné de 30° |
| `ref5_serpentin_199.stp` | 100 tubes + 99 coudes à 180° (test de charge) |

Les cotes attendues sont dans `tests/fixtures/verite.json`. Les fichiers ont été générés avec OpenCascade (`pip install cadquery-ocp`) :

```bash
python3 tests/gen_steps.py    # réf. 1 à 3
python3 tests/gen_ref4.py     # réf. 4
python3 tests/gen_big.py      # réf. 5
```

Tests de bout en bout dans un vrai navigateur (Playwright) :

```bash
CHROME_PATH=/chemin/vers/chrome python3 tests/e2e.py tests/fixtures/ref2_circuit_coudes_te.stp tests/out/t2
CHROME_PATH=/chemin/vers/chrome python3 tests/e2e2.py
```

## Limites principales

- **Validation :** uniquement sur des STEP produits par OpenCascade. Les exports CATIA, SolidWorks, Creo et NX restent à valider sur des maquettes réelles.
- **Amont / aval :** ils suivent la numérotation, pas le sens réel d'écoulement.
- **Tés :** le congé de raccordement (r/D) n'est pas extrait.
- **Flexibles :** les flexibles et cintrages libres en B-spline ne sont pas reconnus (ils sont signalés).
- **Propriétés des fluides et des matériaux :** valeurs usuelles sourcées, à confirmer selon la nuance et la fiche produit.
