# AetherCore

AetherCore est un visualiseur STL 3D pour inspecter une piece directement dans le navigateur avec un rendu WebGL et un controle sans contact par suivi de main.

Le projet sert de base a une experience d'inspection sterile, de demonstration produit ou de prototype industriel. L'application reste utilisable sans camera grace aux controles souris, tactile, import fichier et glisser-deposer.

## Fonctionnalites

- Rendu 3D temps reel avec Three.js.
- Chargement du modele de demonstration `public/models/tasse4-2.stl`.
- Import de fichiers `.stl` locaux et glisser-deposer.
- Modes de rendu hybride, points et surface.
- Echantillonnage de surface uniforme pour obtenir un nuage de points stable.
- Controle souris/tactile par rotation et zoom.
- Controle sans contact optionnel via MediaPipe Hands.
- Etat camera explicite et fallback propre si la camera est bloquee.
- Build Vite reproductible.

## Installation

```bash
npm install
```

## Developpement

```bash
npm run dev
```

Puis ouvrez [http://localhost:5173](http://localhost:5173).

## Production

```bash
npm run build
```

Le build genere les fichiers statiques dans `dist/`.

## Structure

```text
.
├── index.html
├── public/
│   ├── favicon.svg
│   └── models/
│       └── tasse4-2.stl
├── src/
│   ├── hand-tracker.js
│   ├── main.js
│   ├── styles.css
│   └── viewer.js
├── package.json
└── vite.config.js
```

## Notes techniques

Le suivi de main est charge a la demande pour garder le bundle initial raisonnable. MediaPipe utilise son modele officiel distant au moment de l'activation camera ; l'application reste fonctionnelle sans ce chargement.

La detection de gestes normalise les distances par largeur de paume, ce qui est plus stable que des seuils fixes en pixels lorsque la main se rapproche ou s'eloigne de la camera.
