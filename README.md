# AetherCore

AetherCore est un visualiseur 3D tactile et sans contact pour inspecter des fichiers STL directement dans le navigateur.

Le projet combine un rendu WebGL, un chargement de fichiers STL et une interface de controle par gestes pour explorer une piece 3D sans toucher la machine. L'objectif est de servir de base propre a une experience d'inspection sterile, de demonstration produit ou de prototype industriel.

## Etat du projet

Le prototype historique a ete replace a la racine du depot pour que GitHub affiche un projet exploitable des l'ouverture. Le modele de demonstration est stocke dans `public/models/tasse4-2.stl`.

La prochaine etape technique consiste a transformer le prototype monolithique en application structuree, avec scripts de lancement, interface robuste, controles de secours et detection gestuelle plus fiable.

## Lancement rapide

Pour l'instant, servez la racine du projet avec un serveur local puis ouvrez `index.html`.

```bash
python3 -m http.server 5173
```

Puis ouvrez [http://localhost:5173](http://localhost:5173).

La camera doit etre autorisee pour utiliser le controle sans contact. Le chargement de fichiers STL reste possible via import ou glisser-deposer.
