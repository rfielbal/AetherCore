import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const DEMO_MODEL_URL = "/models/tasse4-2.stl";
const PARTICLE_COUNT = 70000;
const INTRO_RADIUS = 17;

export class AetherViewer {
  constructor({ container, onStats, onState, onError }) {
    this.container = container;
    this.onStats = onStats;
    this.onState = onState;
    this.onError = onError;
    this.loader = new STLLoader();
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.mode = "hybrid";
    this.modelName = "No model";
    this.targetZoom = 42;
    this.currentZoom = 42;
    this.rotVelX = 0;
    this.rotVelY = 0;
    this.morphProgress = 1;
    this.triangleCount = 0;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x070808, 0.021);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
    this.camera.position.set(0, 1.4, this.currentZoom);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.modelGroup = new THREE.Group();
    this.modelGroup.rotation.set(-0.18, 0.34, 0);
    this.scene.add(this.modelGroup);

    this.surfaceMesh = null;
    this.edgeLines = null;
    this.particles = this.createParticleSystem();
    this.modelGroup.add(this.particles);

    this.addLighting();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  addLighting() {
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(8, 12, 10);
    const rim = new THREE.DirectionalLight(0x46e0d2, 1.5);
    rim.position.set(-12, 4, -8);
    const fill = new THREE.HemisphereLight(0xdff8f4, 0x151717, 1.25);
    this.scene.add(key, rim, fill);
  }

  createParticleSystem() {
    const geometry = new THREE.BufferGeometry();
    const positions = createIntroPositions(PARTICLE_COUNT);
    const targets = createIntroPositions(PARTICLE_COUNT);
    const seeds = new Float32Array(PARTICLE_COUNT);

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      seeds[index] = Math.random();
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("target", new THREE.BufferAttribute(targets, 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMix: { value: 1 },
        uColorA: { value: new THREE.Color("#46e0d2") },
        uColorB: { value: new THREE.Color("#f0c45c") }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uMix;
        attribute vec3 target;
        attribute float seed;
        varying float vSeed;

        void main() {
          vec3 mixedPosition = mix(position, target, uMix);
          float pulse = sin(uTime * 1.25 + seed * 9.0 + mixedPosition.y * 0.12) * 0.15;
          vec3 finalPosition = mixedPosition + normalize(mixedPosition + 0.001) * pulse * seed;
          vec4 mvPosition = modelViewMatrix * vec4(finalPosition, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(2.8 * (38.0 / -mvPosition.z), 1.0, 6.0);
          vSeed = seed;
        }
      `,
      fragmentShader: `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        varying float vSeed;

        void main() {
          float radius = distance(gl_PointCoord, vec2(0.5));
          if (radius > 0.5) discard;
          float alpha = smoothstep(0.5, 0.08, radius) * 0.86;
          vec3 color = mix(uColorA, uColorB, smoothstep(0.58, 1.0, vSeed));
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    return new THREE.Points(geometry, material);
  }

  async loadDemoModel() {
    await this.loadStlFromUrl(DEMO_MODEL_URL, "Demo part");
  }

  async loadStlFromUrl(url, name) {
    this.emitState("busy", "Loading model");
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Unable to load ${name}`);
    }

    const buffer = await response.arrayBuffer();
    const geometry = this.loader.parse(buffer);
    this.loadGeometry(geometry, name);
  }

  async loadStlFromFile(file) {
    this.emitState("busy", "Parsing STL");
    const buffer = await file.arrayBuffer();
    const geometry = this.loader.parse(buffer);
    this.loadGeometry(geometry, file.name);
  }

  loadGeometry(inputGeometry, name) {
    try {
      const geometry = normalizeGeometry(inputGeometry);
      const positions = sampleSurface(geometry, PARTICLE_COUNT);
      const target = this.particles.geometry.getAttribute("target");
      target.array.set(positions);
      target.needsUpdate = true;
      this.rebuildSurface(geometry);
      this.morphProgress = 0;
      this.particles.material.uniforms.uMix.value = 0;
      this.modelName = name;
      this.triangleCount = geometry.getAttribute("position").count / 3;
      this.emitStats();
      this.emitState("ready", "Renderer ready");
    } catch (error) {
      this.emitState("error", "Model error");
      this.onError?.(error);
    }
  }

  rebuildSurface(geometry) {
    if (this.surfaceMesh) {
      this.surfaceMesh.geometry.dispose();
      this.surfaceMesh.material.dispose();
      this.modelGroup.remove(this.surfaceMesh);
    }

    if (this.edgeLines) {
      this.edgeLines.geometry.dispose();
      this.edgeLines.material.dispose();
      this.modelGroup.remove(this.edgeLines);
    }

    const meshMaterial = new THREE.MeshStandardMaterial({
      color: 0xbff7ef,
      roughness: 0.58,
      metalness: 0.18,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide
    });

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xf0c45c,
      transparent: true,
      opacity: 0.2
    });

    this.surfaceMesh = new THREE.Mesh(geometry, meshMaterial);
    this.edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 34), edgeMaterial);
    this.modelGroup.add(this.surfaceMesh, this.edgeLines);
    this.setRenderMode(this.mode);
  }

  setRenderMode(mode) {
    this.mode = mode;
    const showParticles = mode === "hybrid" || mode === "particles";
    const showSurface = mode === "hybrid" || mode === "surface";
    this.particles.visible = showParticles;

    if (this.surfaceMesh) {
      this.surfaceMesh.visible = showSurface;
    }

    if (this.edgeLines) {
      this.edgeLines.visible = showSurface;
    }
  }

  rotateBy(deltaX, deltaY, strength = 1) {
    this.rotVelY += deltaX * 0.0048 * strength;
    this.rotVelX += deltaY * 0.0048 * strength;
  }

  zoomBy(delta) {
    this.targetZoom = clamp(this.targetZoom + delta, 9, 110);
    this.emitStats();
  }

  resetView() {
    this.targetZoom = 42;
    this.currentZoom = 42;
    this.rotVelX = 0;
    this.rotVelY = 0;
    this.modelGroup.rotation.set(-0.18, 0.34, 0);
    this.emitStats();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  renderNow() {
    this.renderer.render(this.scene, this.camera);
  }

  animate(timestamp) {
    this.timer.update(timestamp);
    const delta = Math.min(this.timer.getDelta(), 0.033);
    const elapsed = this.timer.getElapsed();
    const damping = Math.pow(0.88, delta * 60);

    this.particles.material.uniforms.uTime.value = elapsed;
    this.rotVelX *= damping;
    this.rotVelY *= damping;

    if (Math.abs(this.rotVelX) < 0.0002 && Math.abs(this.rotVelY) < 0.0002) {
      this.rotVelY += 0.00008;
    }

    this.modelGroup.rotation.x += this.rotVelX;
    this.modelGroup.rotation.y += this.rotVelY;
    this.currentZoom += (this.targetZoom - this.currentZoom) * 0.1;
    this.camera.position.z = this.currentZoom;
    this.camera.lookAt(0, 0, 0);

    if (this.morphProgress < 1) {
      this.morphProgress = Math.min(1, this.morphProgress + delta * 0.9);
      const eased = 1 - Math.pow(1 - this.morphProgress, 3);
      this.particles.material.uniforms.uMix.value = eased;
    }

    this.renderNow();
    requestAnimationFrame((nextTimestamp) => this.animate(nextTimestamp));
  }

  emitStats() {
    this.onStats?.({
      modelName: this.modelName,
      triangles: this.triangleCount,
      points: PARTICLE_COUNT,
      zoom: Math.round((42 / this.targetZoom) * 100)
    });
  }

  emitState(kind, label) {
    this.onState?.({ kind, label });
  }
}

function createIntroPositions(count) {
  const positions = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    const radius = INTRO_RADIUS * (0.8 + Math.random() * 0.34);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const offset = index * 3;
    positions[offset] = radius * Math.sin(phi) * Math.cos(theta);
    positions[offset + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[offset + 2] = radius * Math.cos(phi);
  }

  return positions;
}

function normalizeGeometry(inputGeometry) {
  const geometry = inputGeometry.index ? inputGeometry.toNonIndexed() : inputGeometry.clone();
  geometry.computeBoundingBox();

  const box = geometry.boundingBox;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const scale = 28 / maxDimension;
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(scale, scale, scale);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return geometry;
}

function sampleSurface(geometry, count) {
  const attribute = geometry.getAttribute("position");
  const positions = attribute.array;
  const triangleCount = attribute.count / 3;
  const cumulativeAreas = new Float32Array(triangleCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let totalArea = 0;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    readTriangle(positions, triangle, a, b, c);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    totalArea += ab.cross(ac).length() * 0.5;
    cumulativeAreas[triangle] = totalArea;
  }

  if (totalArea <= 0) {
    return createIntroPositions(count);
  }

  const sampled = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    const triangle = findTriangle(cumulativeAreas, Math.random() * totalArea);
    readTriangle(positions, triangle, a, b, c);
    const r1 = Math.sqrt(Math.random());
    const r2 = Math.random();
    const weightA = 1 - r1;
    const weightB = r1 * (1 - r2);
    const weightC = r1 * r2;
    const offset = index * 3;
    sampled[offset] = a.x * weightA + b.x * weightB + c.x * weightC;
    sampled[offset + 1] = a.y * weightA + b.y * weightB + c.y * weightC;
    sampled[offset + 2] = a.z * weightA + b.z * weightB + c.z * weightC;
  }

  return sampled;
}

function readTriangle(positions, triangle, a, b, c) {
  const offset = triangle * 9;
  a.set(positions[offset], positions[offset + 1], positions[offset + 2]);
  b.set(positions[offset + 3], positions[offset + 4], positions[offset + 5]);
  c.set(positions[offset + 6], positions[offset + 7], positions[offset + 8]);
}

function findTriangle(cumulativeAreas, target) {
  let low = 0;
  let high = cumulativeAreas.length - 1;

  while (low < high) {
    const middle = (low + high) >> 1;
    if (target > cumulativeAreas[middle]) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
