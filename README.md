# AetherCore

AetherCore est un visualiseur STL 3D pour inspecter une pièce directement dans le navigateur avec un rendu WebGL et un contrôle sans contact par suivi de main.

Le projet sert de base à une expérience d'inspection stérile, de démonstration produit ou de prototype industriel. L'application reste utilisable sans caméra grâce aux contrôles souris, tactile, import fichier et glisser-déposer.

## Fonctionnalités

- Rendu 3D temps réel avec Three.js.
- Chargement du modèle de démonstration `public/models/tasse4-2.stl`.
- Import de fichiers `.stl` locaux et glisser-déposer.
- Modes de rendu hybride, points et surface.
- Dimensions, surface et volume estimés pour le modèle chargé.
- Échantillonnage de surface uniforme pour obtenir un nuage de points stable.
- Contrôle souris/tactile par rotation et zoom.
- Contrôle sans contact optionnel via MediaPipe Hands.
- État caméra explicite et fallback propre si la caméra est bloquée.
- Build Vite reproductible.

## Installation

```bash
npm install
```

## Développement

```bash
npm run dev
```

Puis ouvrez [http://localhost:5173](http://localhost:5173).

N'ouvrez pas `index.html` directement depuis le Finder ou avec une URL `file://`.
Le projet utilise Vite, Three.js et des modules ES : il doit être servi par `npm run dev`
ou par `npm run preview` après un build.

## Production

```bash
npm run build
```

Le build génère les fichiers statiques dans `dist/`.

Pour tester ce build localement :

```bash
npm run preview
```

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

Le suivi de main est chargé à la demande pour garder le bundle initial raisonnable. MediaPipe utilise son modèle officiel distant au moment de l'activation caméra ; l'application reste fonctionnelle sans ce chargement.

La détection de gestes normalise les distances par largeur de paume, ce qui est plus stable que des seuils fixes en pixels lorsque la main se rapproche ou s'éloigne de la caméra.
