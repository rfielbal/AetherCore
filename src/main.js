import "./styles.css";
import { AetherViewer } from "./viewer.js";
import { HandTracker } from "./hand-tracker.js";

const elements = {
  viewport: document.querySelector("#viewport"),
  fileInput: document.querySelector("#fileInput"),
  importButton: document.querySelector("#importButton"),
  demoButton: document.querySelector("#demoButton"),
  resetButton: document.querySelector("#resetButton"),
  renderState: document.querySelector("#renderState"),
  cameraState: document.querySelector("#cameraState"),
  modelName: document.querySelector("#modelName"),
  triangleCount: document.querySelector("#triangleCount"),
  pointCount: document.querySelector("#pointCount"),
  zoomValue: document.querySelector("#zoomValue"),
  controlMode: document.querySelector("#controlMode"),
  gestureValue: document.querySelector("#gestureValue"),
  sizeValue: document.querySelector("#sizeValue"),
  surfaceValue: document.querySelector("#surfaceValue"),
  volumeValue: document.querySelector("#volumeValue"),
  handToggle: document.querySelector("#handToggle"),
  zoomLock: document.querySelector("#zoomLock"),
  cameraPreview: document.querySelector("#cameraPreview"),
  handCursor: document.querySelector("#handCursor"),
  dragOverlay: document.querySelector("#dragOverlay"),
  toast: document.querySelector("#toast"),
  gestureFist: document.querySelector("#gestureFist"),
  gestureOpen: document.querySelector("#gestureOpen"),
  gesturePinch: document.querySelector("#gesturePinch")
};

let handTracker = null;
let handTrackingEnabled = false;
let handTrackingStarting = false;
let activeHandHover = null;
let clickCooldown = 0;
let pinchFrames = 0;
let zoomLocked = false;
let lastHandPoint = null;
let toastTimer = 0;

const MIN_PINCH_CONFIDENCE = 0.42;
const MIN_ZOOM_CONFIDENCE = 0.56;

const viewer = new AetherViewer({
  container: elements.viewport,
  onStats: updateStats,
  onState: updateRenderState,
  onError: (error) => showToast(error.message || "Model loading failed")
});

if (import.meta.env.DEV) {
  window.__AETHERCORE__ = { viewer };
}

bindModelControls();
bindRenderControls();
bindPointerControls();
bindDragAndDrop();
bindHandControls();

viewer.loadDemoModel().catch((error) => {
  showToast(error.message || "Unable to load demo model");
  updateRenderState({ kind: "error", label: "Demo failed" });
});

function bindModelControls() {
  elements.importButton.addEventListener("click", () => elements.fileInput.click());
  elements.demoButton.addEventListener("click", () => {
    viewer.loadDemoModel().catch((error) => showToast(error.message || "Unable to load demo model"));
  });
  elements.resetButton.addEventListener("click", () => viewer.resetView());
  elements.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;

    if (file) {
      await loadFile(file);
      elements.fileInput.value = "";
    }
  });
}

function bindRenderControls() {
  document.querySelectorAll("[data-render-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.renderMode;
      viewer.setRenderMode(mode);
      document.querySelectorAll("[data-render-mode]").forEach((item) => {
        item.classList.toggle("is-selected", item === button);
      });
    });
  });
}

function bindPointerControls() {
  let dragging = false;
  let lastPointer = null;

  elements.viewport.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    elements.viewport.setPointerCapture(event.pointerId);
    elements.controlMode.textContent = event.pointerType === "touch" ? "Touch" : "Mouse";
  });

  elements.viewport.addEventListener("pointermove", (event) => {
    if (!dragging || !lastPointer) {
      return;
    }

    viewer.rotateBy(event.clientX - lastPointer.x, event.clientY - lastPointer.y);
    lastPointer = { x: event.clientX, y: event.clientY };
  });

  elements.viewport.addEventListener("pointerup", (event) => {
    dragging = false;
    lastPointer = null;

    if (elements.viewport.hasPointerCapture(event.pointerId)) {
      elements.viewport.releasePointerCapture(event.pointerId);
    }
  });

  elements.viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      viewer.zoomBy(event.deltaY * 0.025);
    },
    { passive: false }
  );
}

function bindDragAndDrop() {
  let dragDepth = 0;

  window.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    elements.dragOverlay.hidden = false;
  });

  window.addEventListener("dragover", (event) => {
    event.preventDefault();
  });

  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    elements.dragOverlay.hidden = dragDepth === 0;
  });

  window.addEventListener("drop", async (event) => {
    event.preventDefault();
    dragDepth = 0;
    elements.dragOverlay.hidden = true;
    const [file] = event.dataTransfer.files;

    if (file) {
      await loadFile(file);
    }
  });
}

function bindHandControls() {
  elements.handToggle.addEventListener("click", async () => {
    if (handTrackingEnabled) {
      stopHandTracking();
      return;
    }

    await startHandTracking();
  });

  elements.zoomLock.addEventListener("click", () => setZoomLocked(!zoomLocked));
}

async function startHandTracking() {
  if (handTrackingStarting) {
    return;
  }

  handTrackingStarting = true;
  elements.handToggle.disabled = true;
  elements.handToggle.textContent = "Camera loading";

  try {
    if (!handTracker) {
      handTracker = new HandTracker({ video: elements.cameraPreview });
      handTracker.addEventListener("status", (event) => handleCameraStatus(event.detail));
      handTracker.addEventListener("tracking", (event) => handleHandTracking(event.detail));
    }

    await handTracker.start();
    handTrackingEnabled = true;
    setHandTrackingButton(true);
    elements.controlMode.textContent = "Hand";
  } catch (error) {
    handTrackingEnabled = false;
    setHandTrackingButton(false);
    updateCameraState({ kind: "error", label: "Camera blocked" });
    showToast(error.message || "Camera access failed");
  } finally {
    handTrackingStarting = false;
    elements.handToggle.disabled = false;
  }
}

function stopHandTracking() {
  handTracker?.stop();
  handTrackingEnabled = false;
  setHandTrackingButton(false);
  elements.handCursor.hidden = true;
  elements.controlMode.textContent = "Mouse";
  clearHandHover();
  resetGesturePills();
}

function handleHandTracking(detail) {
  clickCooldown = Math.max(0, clickCooldown - 1);

  if (!detail.active) {
    elements.handCursor.hidden = true;
    clearHandHover();
    resetGesturePills();
    elements.gestureValue.textContent = "Idle";
    lastHandPoint = null;
    return;
  }

  const screenPoint = {
    x: detail.cursor.x * window.innerWidth,
    y: detail.cursor.y * window.innerHeight
  };

  elements.handCursor.hidden = false;
  elements.handCursor.style.transform = `translate3d(${screenPoint.x}px, ${screenPoint.y}px, 0)`;
  elements.handCursor.className = `hand-cursor is-${detail.gesture}`;
  elements.gestureValue.textContent = labelGesture(detail.gesture);
  updateGesturePills(detail.gesture);

  const hovered = findHandTarget(screenPoint.x, screenPoint.y);
  setHandHover(hovered);
  const precisePinch = detail.gesture === "pinch" && detail.confidence >= MIN_PINCH_CONFIDENCE;

  if (hovered && precisePinch && clickCooldown === 0) {
    hovered.click();
    clickCooldown = 38;
    pinchFrames = 0;
    return;
  }

  if (hovered) {
    lastHandPoint = screenPoint;
    return;
  }

  if (precisePinch) {
    pinchFrames += 1;

    if (pinchFrames > 28 && clickCooldown === 0) {
      setZoomLocked(!zoomLocked);
      clickCooldown = 44;
      pinchFrames = 0;
    }
  } else {
    pinchFrames = 0;
  }

  if (lastHandPoint && detail.gesture === "rotate") {
    const deltaX = screenPoint.x - lastHandPoint.x;
    const deltaY = screenPoint.y - lastHandPoint.y;
    viewer.rotateBy(deltaX, deltaY, 0.72);
  }

  if (!zoomLocked) {
    if (detail.gesture === "open" && detail.confidence >= MIN_ZOOM_CONFIDENCE) {
      viewer.zoomBy(-0.38);
    }

    if (detail.gesture === "fist" && detail.confidence >= MIN_ZOOM_CONFIDENCE) {
      viewer.zoomBy(0.38);
    }
  }

  lastHandPoint = screenPoint;
}

async function loadFile(file) {
  if (!file.name.toLowerCase().endsWith(".stl")) {
    showToast("Only STL files are supported.");
    return;
  }

  try {
    await viewer.loadStlFromFile(file);
  } catch (error) {
    showToast(error.message || "Unable to import this STL file.");
  }
}

function updateStats(stats) {
  elements.modelName.textContent = stats.modelName;
  elements.triangleCount.textContent = `${formatNumber(stats.triangles)} triangles`;
  elements.pointCount.textContent = formatNumber(stats.points);
  elements.zoomValue.textContent = `${stats.zoom}%`;
  elements.sizeValue.textContent = formatSize(stats.dimensions);
  elements.surfaceValue.textContent = `${formatMeasure(stats.surfaceArea)} u2`;
  elements.volumeValue.textContent = `${formatMeasure(stats.volume)} u3`;
}

function updateRenderState({ kind, label }) {
  elements.renderState.textContent = label;
  elements.renderState.className = `status-chip is-${kind}`;
}

function updateCameraState({ kind, label }) {
  elements.cameraState.textContent = label;
  elements.cameraState.className = `status-chip is-${kind}`;
}

function handleCameraStatus(detail) {
  updateCameraState(detail);

  if (detail.kind === "error") {
    handTrackingEnabled = false;
    setHandTrackingButton(false);
    elements.handCursor.hidden = true;
    elements.controlMode.textContent = "Mouse";
    clearHandHover();
    resetGesturePills();
  }
}

function setHandTrackingButton(enabled) {
  elements.handToggle.classList.toggle("is-active", enabled);
  elements.handToggle.textContent = enabled ? "Tracking on" : "Hand tracking";
}

function setZoomLocked(value) {
  zoomLocked = value;
  elements.zoomLock.classList.toggle("is-active", value);
  elements.zoomLock.setAttribute("aria-pressed", String(value));
  elements.zoomLock.textContent = value ? "Zoom locked" : "Zoom lock";
}

function findHandTarget(x, y) {
  elements.handCursor.hidden = true;
  const target = document.elementFromPoint(x, y)?.closest("button");
  elements.handCursor.hidden = false;
  return target;
}

function setHandHover(target) {
  if (activeHandHover === target) {
    elements.handCursor.classList.toggle("is-hover", Boolean(target));
    return;
  }

  clearHandHover();
  activeHandHover = target;

  if (activeHandHover) {
    activeHandHover.classList.add("is-hand-hover");
    elements.handCursor.classList.add("is-hover");
  }
}

function clearHandHover() {
  if (activeHandHover) {
    activeHandHover.classList.remove("is-hand-hover");
    activeHandHover = null;
  }

  elements.handCursor.classList.remove("is-hover");
}

function updateGesturePills(gesture) {
  elements.gestureFist.classList.toggle("is-active", gesture === "fist");
  elements.gestureOpen.classList.toggle("is-active", gesture === "open");
  elements.gesturePinch.classList.toggle("is-active", gesture === "pinch");
}

function resetGesturePills() {
  updateGesturePills("idle");
}

function labelGesture(gesture) {
  const labels = {
    fist: "Fist",
    open: "Open",
    pinch: "Pinch",
    rotate: "Rotate",
    idle: "Idle"
  };

  return labels[gesture] || "Rotate";
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 4200);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatMeasure(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100 ? 0 : 1
  }).format(value);
}

function formatSize(dimensions) {
  if (!dimensions) {
    return "n/a";
  }

  return [dimensions.x, dimensions.y, dimensions.z]
    .map((value) => formatMeasure(value))
    .join(" x ");
}
