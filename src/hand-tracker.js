const TASKS_VERSION = "0.10.35";
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandTracker extends EventTarget {
  constructor({ video }) {
    super();
    this.video = video;
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.smoothedCursor = { x: 0.5, y: 0.5 };
  }

  async start() {
    if (this.running) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is not available in this browser.");
    }

    this.emitStatus("loading", "Camera loading");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960 },
        height: { ideal: 540 },
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
  }

  stop() {
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
    this.emitStatus("idle", "Camera idle");
    this.emitTracking({ active: false, gesture: "idle" });
  }

  loop() {
    if (!this.running || !this.landmarker) {
      return;
    }

    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const result = this.landmarker.detectForVideo(this.video, performance.now());
      this.emitTracking(classifyResult(result, this.smoothedCursor));
    }

    requestAnimationFrame(() => this.loop());
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
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.62,
      minHandPresenceConfidence: 0.62,
      minTrackingConfidence: 0.58
    });
  } catch (error) {
    return HandLandmarker.createFromOptions(vision, {
      baseOptions: { ...baseOptions, delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.62,
      minHandPresenceConfidence: 0.62,
      minTrackingConfidence: 0.58
    });
  }
}

function classifyResult(result, smoothedCursor) {
  const hand = result.landmarks?.[0];

  if (!hand) {
    return { active: false, gesture: "idle", confidence: 0, cursor: smoothedCursor };
  }

  const palm = midpoint(hand[0], hand[9]);
  const targetCursor = {
    x: 1 - palm.x,
    y: palm.y
  };

  smoothedCursor.x = lerp(smoothedCursor.x, targetCursor.x, 0.28);
  smoothedCursor.y = lerp(smoothedCursor.y, targetCursor.y, 0.28);

  const wrist = hand[0];
  const palmWidth = Math.max(distance(hand[5], hand[17]), 0.001);
  const pinchRatio = distance(hand[4], hand[8]) / palmWidth;
  const extendedFingers = countExtendedFingers(hand, wrist);
  const thumbOpen = distance(hand[4], hand[9]) > palmWidth * 0.82;
  let gesture = "rotate";

  if (pinchRatio < 0.38) {
    gesture = "pinch";
  } else if (extendedFingers <= 1 && !thumbOpen) {
    gesture = "fist";
  } else if (extendedFingers >= 3 && thumbOpen) {
    gesture = "open";
  }

  return {
    active: true,
    gesture,
    confidence: Math.max(0, Math.min(1, 1 - Math.abs(pinchRatio - 0.38))),
    cursor: {
      x: clamp(smoothedCursor.x, 0, 1),
      y: clamp(smoothedCursor.y, 0, 1)
    }
  };
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
