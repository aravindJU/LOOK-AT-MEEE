import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// ---- DOM ----------------------------------------------------------------
const body = document.body;
const video = document.getElementById("webcam");
const memeImg = document.getElementById("meme");
const overlay = document.getElementById("overlay");
const startBtn = document.getElementById("startBtn");
const errorPanel = document.getElementById("errorPanel");
const errorText = document.getElementById("errorText");
const recDot = document.getElementById("recDot");

const statusSubject = document.getElementById("statusSubject");
const statusCount = document.getElementById("statusCount");
const statusUptime = document.getElementById("statusUptime");

// ---- Tunables -------------------------------------------------------------
// Iris ratio ~0.5 means the eye is centred. Outside this band counts as
// "looking away" horizontally. Values found by eye, adjust to taste.
const GAZE_LOW = 0.36;
const GAZE_HIGH = 0.64;
// How many consecutive "away" or "locked" frames are needed before we
// actually flip state. Stops single bad frames from causing flicker.
const DEBOUNCE_FRAMES = 8;

let memeCount = 0;
let sessionStart = null;
let uptimeTimer = null;

// ---- Boot -----------------------------------------------------------------
startBtn.addEventListener("click", start);

async function start() {
  startBtn.disabled = true;
  startBtn.textContent = "STARTING…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    const landmarker = await createLandmarker();

    body.dataset.state = "locked";
    sessionStart = Date.now();
    uptimeTimer = setInterval(updateUptime, 1000);

    runDetectionLoop(landmarker);
  } catch (err) {
    showError(describeError(err));
  }
}

async function createLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
    runningMode: "VIDEO",
    numFaces: 1,
  });
}

function describeError(err) {
  if (err && err.name === "NotAllowedError") {
    return "Camera access was denied. Allow camera permissions and reload.";
  }
  if (err && err.name === "NotFoundError") {
    return "No camera was found on this device.";
  }
  return "Could not start the camera or load the tracking model. Check your connection and reload.";
}

function showError(message) {
  body.dataset.state = "error";
  errorText.textContent = message;
  errorPanel.classList.remove("hidden");
  startBtn.disabled = false;
  startBtn.textContent = "POWER ON";
}

// ---- Detection loop ---------------------------------------------------
let awayStreak = 0;
let lockedStreak = 0;
let looking = true; // current committed state

function runDetectionLoop(landmarker) {
  let lastVideoTime = -1;

  function frame() {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      evaluateGaze(result);
    }
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function evaluateGaze(result) {
  const faces = result.faceLandmarks;

  if (!faces || faces.length === 0) {
    registerFrame(false);
    statusSubject.textContent = "NOT DETECTED";
    return;
  }

  const lm = faces[0];
  const ratio = horizontalGazeRatio(lm);
  const centred = ratio >= GAZE_LOW && ratio <= GAZE_HIGH;

  registerFrame(centred);
  statusSubject.textContent = centred ? "ON CAMERA" : "LOOKING AWAY";
}

// Iris position within the eye, averaged across both eyes.
// ~0.5 = centred. Landmark indices come from MediaPipe's 478-point mesh.
function horizontalGazeRatio(lm) {
  const leftOuter = lm[33];
  const leftInner = lm[133];
  const leftIris = lm[468];

  const rightInner = lm[362];
  const rightOuter = lm[263];
  const rightIris = lm[473];

  const leftRatio = safeRatio(leftIris.x, leftOuter.x, leftInner.x);
  const rightRatio = safeRatio(rightIris.x, rightInner.x, rightOuter.x);

  return (leftRatio + rightRatio) / 2;
}

function safeRatio(value, from, to) {
  const span = to - from;
  if (Math.abs(span) < 1e-6) return 0.5;
  return (value - from) / span;
}

function registerFrame(isCentred) {
  if (isCentred) {
    lockedStreak++;
    awayStreak = 0;
  } else {
    awayStreak++;
    lockedStreak = 0;
  }

  if (looking && awayStreak >= DEBOUNCE_FRAMES) {
    looking = false;
    onLookAway();
  } else if (!looking && lockedStreak >= DEBOUNCE_FRAMES) {
    looking = true;
    onLookBack();
  }
}

// ---- State transitions --------------------------------------------------
function onLookAway() {
  body.dataset.state = "away";
  fetchRandomMeme();
}

function onLookBack() {
  body.dataset.state = "locked";
}

async function fetchRandomMeme() {
  try {
    const res = await fetch("/api/random-meme", { cache: "no-store" });
    const data = await res.json();

    if (!res.ok) {
      memeImg.removeAttribute("src");
      statusSubject.textContent = "NO MEMES FOUND";
      return;
    }

    memeImg.src = `${data.url}?t=${Date.now()}`;
    memeCount += 1;
    statusCount.textContent = String(memeCount);
    if (typeof data.count === "number") {
      statusCount.title = `${data.count} memes in the folder`;
    }
  } catch (err) {
    statusSubject.textContent = "MEME FETCH FAILED";
  }
}

// ---- Uptime clock ---------------------------------------------------------
function updateUptime() {
  if (!sessionStart) return;
  const seconds = Math.floor((Date.now() - sessionStart) / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  statusUptime.textContent = `${mm}:${ss}`;
}
