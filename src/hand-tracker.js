const TASKS_VERSION = "0.10.35";
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const HAND_OPTIONS = {
  runningMode: "VIDEO",
  numHands: 1,
  minHandDetectionConfidence: 0.68,
  minHandPresenceConfidence: 0.68,
  minTrackingConfidence: 0.64
};

export class HandTracker extends EventTarget {
  constructor({ video }) {
    super();
    this.video = video;
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.starting = false;
    this.lastVideoTime = -1;
    this.state = {
      cursor: { x: 0.5, y: 0.5 },
      lastRawCursor: null,
      stableGesture: "idle",
      candidateGesture: "idle",
      candidateFrames: 0,
      lostFrames: 0
    };
  }

  async start() {
    if (this.running || this.starting) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is not available in this browser.");
    }

    this.starting = true;
    this.emitStatus("loading", "Camera loading");

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        },
        audio: false
      });

      this.video.srcObject = this.stream;
      await this.video.play();
      this.landmarker = await createLandmarker();
      this.running = true;
      this.emitStatus("ready", "Hand tracking on");
      this.loop();
    } catch (error) {
      this.stop({ emitIdle: false });
      this.emitStatus("error", "Camera blocked");
      throw error;
    } finally {
      this.starting = false;
    }
  }

  stop({ emitIdle = true } = {}) {
    this.running = false;
    this.landmarker?.close();
    this.landmarker = null;

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
    }

    this.stream = null;
    this.video.srcObject = null;
    this.lastVideoTime = -1;
    this.resetState();

    if (emitIdle) {
      this.emitStatus("idle", "Camera idle");
    }

    this.emitTracking({ active: false, gesture: "idle" });
  }

  loop() {
    if (!this.running || !this.landmarker) {
      return;
    }

    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;

      try {
        const result = this.landmarker.detectForVideo(this.video, performance.now());
        this.emitTracking(classifyResult(result, this.state));
      } catch (error) {
        this.stop({ emitIdle: false });
        this.emitStatus("error", "Tracking failed");
        this.emitTracking({ active: false, gesture: "idle" });
        return;
      }
    }

    requestAnimationFrame(() => this.loop());
  }

  resetState() {
    this.state.cursor = { x: 0.5, y: 0.5 };
    this.state.lastRawCursor = null;
    this.state.stableGesture = "idle";
    this.state.candidateGesture = "idle";
    this.state.candidateFrames = 0;
    this.state.lostFrames = 0;
  }

  emitStatus(kind, label) {
    this.dispatchEvent(new CustomEvent("status", { detail: { kind, label } }));
  }

  emitTracking(detail) {
    this.dispatchEvent(new CustomEvent("tracking", { detail }));
  }
}

async function createLandmarker() {
  const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
  const baseOptions = {
    modelAssetPath: MODEL_URL,
    delegate: "GPU"
  };

  try {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions,
      ...HAND_OPTIONS
    });
  } catch (error) {
    return HandLandmarker.createFromOptions(vision, {
      baseOptions: { ...baseOptions, delegate: "CPU" },
      ...HAND_OPTIONS
    });
  }
}

function classifyResult(result, state) {
  const hand = result.landmarks?.[0];

  if (!hand) {
    state.lostFrames += 1;

    if (state.lostFrames > 2) {
      state.stableGesture = "idle";
      state.candidateGesture = "idle";
      state.candidateFrames = 0;
    }

    return {
      active: false,
      gesture: state.stableGesture,
      confidence: 0,
      cursor: state.cursor
    };
  }

  state.lostFrames = 0;

  const palm = weightedPalmCenter(hand);
  const targetCursor = {
    x: 1 - palm.x,
    y: palm.y
  };

  smoothCursor(state, targetCursor);

  const wrist = hand[0];
  const palmWidth = Math.max(distance(hand[5], hand[17]), 0.001);
  const pinchRatio = distance(hand[4], hand[8]) / palmWidth;
  const extendedFingers = countExtendedFingers(hand, wrist);
  const thumbOpen = distance(hand[4], hand[9]) > palmWidth * 0.78;
  const gesture = stabilizeGesture(state, classifyGesture({
    extendedFingers,
    pinchRatio,
    thumbOpen
  }));

  const confidence = confidenceForGesture(gesture, {
    extendedFingers,
    pinchRatio,
    thumbOpen
  });

  return {
    active: true,
    gesture,
    confidence,
    cursor: {
      x: clamp(state.cursor.x, 0, 1),
      y: clamp(state.cursor.y, 0, 1)
    }
  };
}

function weightedPalmCenter(hand) {
  return {
    x: hand[0].x * 0.18 + hand[5].x * 0.22 + hand[9].x * 0.26 + hand[13].x * 0.2 + hand[17].x * 0.14,
    y: hand[0].y * 0.18 + hand[5].y * 0.22 + hand[9].y * 0.26 + hand[13].y * 0.2 + hand[17].y * 0.14
  };
}

function smoothCursor(state, targetCursor) {
  const lastRaw = state.lastRawCursor || targetCursor;
  const movement = distance(lastRaw, targetCursor);
  const deadZone = 0.0025;

  if (!state.lastRawCursor) {
    state.cursor.x = targetCursor.x;
    state.cursor.y = targetCursor.y;
  } else if (movement > deadZone) {
    const alpha = clamp(0.12 + movement * 7.5, 0.14, 0.46);
    state.cursor.x = lerp(state.cursor.x, targetCursor.x, alpha);
    state.cursor.y = lerp(state.cursor.y, targetCursor.y, alpha);
  }

  state.lastRawCursor = targetCursor;
}

function classifyGesture({ extendedFingers, pinchRatio, thumbOpen }) {
  if (pinchRatio < 0.34) {
    return "pinch";
  }

  if (extendedFingers <= 1 && !thumbOpen && pinchRatio > 0.5) {
    return "fist";
  }

  if (extendedFingers >= 3 && thumbOpen && pinchRatio > 0.5) {
    return "open";
  }

  return "rotate";
}

function stabilizeGesture(state, gesture) {
  if (gesture === state.stableGesture) {
    state.candidateGesture = gesture;
    state.candidateFrames = 0;
    return state.stableGesture;
  }

  if (gesture !== state.candidateGesture) {
    state.candidateGesture = gesture;
    state.candidateFrames = 1;
  } else {
    state.candidateFrames += 1;
  }

  const requiredFrames = gesture === "pinch" ? 2 : 3;

  if (state.candidateFrames >= requiredFrames) {
    state.stableGesture = gesture;
    state.candidateFrames = 0;
  }

  return state.stableGesture;
}

function confidenceForGesture(gesture, { extendedFingers, pinchRatio, thumbOpen }) {
  if (gesture === "pinch") {
    return clamp((0.42 - pinchRatio) / 0.2, 0, 1);
  }

  if (gesture === "fist") {
    return clamp((2 - extendedFingers) / 2 + (thumbOpen ? -0.35 : 0.35), 0, 1);
  }

  if (gesture === "open") {
    return clamp((extendedFingers - 2) / 2 + (thumbOpen ? 0.3 : -0.3), 0, 1);
  }

  return 0.7;
}

function countExtendedFingers(hand, wrist) {
  const fingers = [
    { tip: 8, pip: 6 },
    { tip: 12, pip: 10 },
    { tip: 16, pip: 14 },
    { tip: 20, pip: 18 }
  ];

  return fingers.reduce((count, finger) => {
    const tipDistance = distance(hand[finger.tip], wrist);
    const pipDistance = distance(hand[finger.pip], wrist);
    return tipDistance > pipDistance * 1.16 ? count + 1 : count;
  }, 0);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
