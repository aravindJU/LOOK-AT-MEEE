import { FaceLandmarker, FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const body = document.body;
const video = document.getElementById("webcam");
const memeImg = document.getElementById("meme");
const memeVideo = document.getElementById("memeVideo");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const startBtn = document.getElementById("startBtn");
const uploadForm = document.getElementById("uploadForm");
const imageUpload = document.getElementById("imageUpload");
const clearImageBtn = document.getElementById("clearImageBtn");
const turnOffCameraBtn = document.getElementById("turnOffCameraBtn");
const uploadStatus = document.getElementById("uploadStatus");
const recordBtn = document.getElementById("recordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const recordingDownload = document.getElementById("recordingDownload");
const recordStatus = document.getElementById("recordStatus");
const commentForm = document.getElementById("commentForm");
const commentInput = document.getElementById("commentInput");
const comments = document.getElementById("comments");
const authBtn = document.getElementById("authBtn");
const signedInPanel = document.getElementById("signedInPanel");
const signedInAs = document.getElementById("signedInAs");
const signInHint = document.getElementById("signInHint");
const signOutBtn = document.getElementById("signOutBtn");
const commentStatus = document.getElementById("commentStatus");
const recordCanvas = document.createElement("canvas");
const recordContext = recordCanvas.getContext("2d");
const errorPanel = document.getElementById("errorPanel");
const errorText = document.getElementById("errorText");
const statusSubject = document.getElementById("statusSubject");
const statusCount = document.getElementById("statusCount");
const statusUptime = document.getElementById("statusUptime");
const DEFAULT_VIDEO_MEMES = [
  "./static/memes/family-guy.mp4",
  "./static/memes/meme-1.mp4",
  "./static/memes/meme-2.mp4",
  "./static/memes/meme-3.mp4",
  "./static/memes/meme-4.mp4",
];

// 478-point Face Mesh eye landmarks: corners, lids, and the five iris points.
// Taking the iris centroid avoids the jitter of sampling a single point.
const LEFT_EYE = { outer: 33, inner: 133, top: 159, bottom: 145, iris: [468, 469, 470, 471, 472], ring: [33, 160, 158, 133, 153, 144] };
const RIGHT_EYE = { outer: 263, inner: 362, top: 386, bottom: 374, iris: [473, 474, 475, 476, 477], ring: [263, 387, 385, 362, 380, 373] };
const CALIBRATION_MS = 1400;
const SMOOTHING = 0.22;
const HORIZONTAL_TOLERANCE = 0.10;
const VERTICAL_TOLERANCE = 0.16;
const HEAD_TURN_TOLERANCE = 0.07;
const AWAY_DEBOUNCE_MS = 220;
const RETURN_DEBOUNCE_MS = 0;
const CLOSED_EYE_AWAY_MS = 400;
// Lid opening divided by eye width. A normal open eye is roughly 0.25–0.4;
// this deliberately leaves room for different eye shapes while catching blinks.
const BLINK_OPENNESS_THRESHOLD = 0.16;

let landmarker, handLandmarker, stream, animationFrame, uptimeTimer;
let memeCount = 0;
let sessionStart = null;
let lastVideoTime = -1;
let looking = true;
let centredSince = null;
let awaySince = null;
let smoothedGaze = null;
let calibrationSamples = [];
let gazeBaseline = null;
let blinkSince = null;
let fallbackMemeIndex = 0;
let fallbackVideos = DEFAULT_VIDEO_MEMES.map((url) => ({ url, type: "video" }));
let uploadedImageUrl = null;
let imageMemeActive = false;
let imageDetectionReady = false;
let mediaRecorder = null;
let recordingChunks = [];
let recordingUrl = null;
let recordingStream = null;
let recordingFrame = null;
let recordingAudioContext = null;
let recordingAudioDestination = null;
let recordingAudioSource = null;
let commentsLoadToken = 0;
let currentUsername = null;

startBtn.addEventListener("click", start);
imageUpload.addEventListener("change", uploadImage);
uploadForm.addEventListener("submit", uploadImage);
clearImageBtn.addEventListener("click", useCamera);
turnOffCameraBtn.addEventListener("click", turnOffCamera);
recordBtn.addEventListener("click", startRecording);
stopRecordBtn.addEventListener("click", stopRecording);
commentForm.addEventListener("submit", addComment);
signOutBtn.addEventListener("click", signOut);
authBtn.addEventListener("click", () => {
  if (window.location.protocol !== "file:") {
    window.location.href = "/login.html";
    return;
  }
  window.location.href = window.location.pathname.endsWith("/templates/index.html")
    ? "login.html"
    : "templates/login.html";
});
memeVideo.addEventListener("ended", playNextMeme);
loadSession().finally(loadComments);
window.addEventListener("beforeunload", stop);
window.addEventListener("pagehide", stopCamera);
new ResizeObserver(sizeOverlay).observe(overlay);

async function start() {
  startBtn.disabled = true;
  startBtn.textContent = "STARTING…";
  errorPanel.classList.add("hidden");
  primeMemeAudio();
  try {
    if (body.dataset.cameraReplaced !== "true") {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    }
    landmarker = await createLandmarker();
    handLandmarker = await createHandLandmarker();
    if (body.dataset.cameraReplaced === "true") await enableImageDetection();
    resetTracking();
    body.dataset.state = "locked";
    statusSubject.textContent = "CALIBRATING… LOOK AT THE LENS";
    sessionStart = Date.now();
    uptimeTimer = setInterval(updateUptime, 1000);
    sizeOverlay();
    // Start downloading video media before the user looks away. The supplied
    // 1080p MP4 is large enough that loading it only at transition time is noticeable.
    preloadMeme();
    preloadMemeItem(fallbackVideos[0]);
    detectFrame();
  } catch (error) {
    stop();
    showError(describeError(error));
  }
}

async function enableImageDetection() {
  if (imageDetectionReady || !landmarker) return;
  await landmarker.setOptions({ runningMode: "IMAGE" });
  imageDetectionReady = true;
}

async function createLandmarker() {
  const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  const options = {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 4,
  };
  try {
    return await FaceLandmarker.createFromOptions(vision, options);
  } catch {
    // WebGL can be present but unable to initialise MediaPipe's GPU delegate.
    options.baseOptions.delegate = "CPU";
    return FaceLandmarker.createFromOptions(vision, options);
  }
}

async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

function resetTracking() {
  looking = true;
  centredSince = awaySince = null;
  smoothedGaze = gazeBaseline = null;
  calibrationSamples = [];
  blinkSince = null;
  lastVideoTime = -1;
}

function detectFrame() {
  if (!landmarker) return;
  if (body.dataset.cameraReplaced === "true") {
    if (imageDetectionReady && memeImg.complete && memeImg.naturalWidth) {
      evaluateGaze(landmarker.detect(memeImg));
    }
  } else if (stream && !video.ended
    && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const timestamp = performance.now();
    const faceResult = landmarker.detectForVideo(video, timestamp);
    evaluateGaze(faceResult, handLandmarker?.detectForVideo(video, timestamp));
  }
  animationFrame = requestAnimationFrame(detectFrame);
}

function evaluateGaze(result, hands = null) {
  const imageReplaced = body.dataset.cameraReplaced === "true";
  const faces = result.faceLandmarks ?? [];
  if (!faces.length) {
    clearOverlay();
    statusSubject.textContent = imageReplaced && imageMemeActive
      ? "FACE NOT DETECTED — MEME PLAYING"
      : "FACE NOT DETECTED";
    if (imageReplaced && !imageMemeActive) playImageMeme();
    if (!imageReplaced) updateState(false);
    return;
  }
  const primaryFace = largestFace(faces);

  if (imageReplaced) {
    const eyesClosed = faces.every(isBlinking);
    clearOverlay();
    faces.forEach((face) => drawEyes(face, smoothedGaze ?? { x: 0, y: 0 }, face === primaryFace && !eyesClosed));
    statusSubject.textContent = eyesClosed
      ? (imageMemeActive ? "EYES CLOSED — MEME PLAYING" : "EYES CLOSED")
      : "EYES OPEN";
    if (eyesClosed) {
      playImageMeme();
    } else {
      if (imageMemeActive) {
        imageMemeActive = false;
        stopMemeVideo();
        memeVideo.classList.remove("active");
        memeImg.classList.add("active");
        body.dataset.memeReady = "true";
        body.dataset.state = "locked";
      }
    }
    return;
  }

  if (!hasVisibleEyes(primaryFace) || isEyeOccluded(primaryFace, hands)) {
    clearOverlay();
    statusSubject.textContent = "EYES OBSTRUCTED";
    updateState(false);
    return;
  }

  if (faces.every(isBlinking)) {
    // Iris landmarks move or become unreliable under closed lids. A blink is
    // intentionally neither "looking away" nor "looking back", and it resets
    // a partial debounce so an almost-complete transition cannot fire after it.
    const now = performance.now();
    blinkSince ??= now;
    clearOverlay();
    faces.forEach((face) => drawEyes(face, smoothedGaze ?? { x: 0, y: 0 }, face === primaryFace));
    if (now - blinkSince >= CLOSED_EYE_AWAY_MS) {
      statusSubject.textContent = "EYES CLOSED — LOOKING AWAY";
      if (!imageReplaced) triggerAway();
    } else {
      // A normal blink must not inherit a partial gaze-transition timer.
      centredSince = awaySince = null;
      statusSubject.textContent = "BLINK DETECTED — HOLDING STATE";
    }
    return;
  }
  blinkSince = null;

  const rawGaze = averageEyeGaze(primaryFace);
  smoothedGaze = smoothedGaze
    ? {
        x: lerp(smoothedGaze.x, rawGaze.x, SMOOTHING),
        y: lerp(smoothedGaze.y, rawGaze.y, SMOOTHING),
        headX: lerp(smoothedGaze.headX, rawGaze.headX, SMOOTHING),
        time: rawGaze.time,
      }
    : rawGaze;

  if (!gazeBaseline) {
    calibrationSamples.push(smoothedGaze);
    clearOverlay();
    faces.forEach((face) => drawEyes(face, smoothedGaze, face === primaryFace));
    if (rawGaze.time - calibrationSamples[0].time < CALIBRATION_MS) return;
    gazeBaseline = meanGaze(calibrationSamples);
  }

  const primaryCentred = Math.abs(smoothedGaze.x - gazeBaseline.x) <= HORIZONTAL_TOLERANCE
    && Math.abs(smoothedGaze.y - gazeBaseline.y) <= VERTICAL_TOLERANCE;
  const centred = faces.length > 1
    ? faces.every((face) => !isBlinking(face))
    : primaryCentred;
  clearOverlay();
  faces.forEach((face) => drawEyes(face, smoothedGaze, face === primaryFace && centred));
  statusSubject.textContent = centred ? "EYES ON CAMERA" : "LOOKING AWAY";
  if (faces.length > 1) {
    const allEyesOpen = faces.every((face) => !isBlinking(face));
    const allEyesClosed = faces.every(isBlinking);
    if (!allEyesOpen && !allEyesClosed) {
      statusSubject.textContent = "WAITING FOR ALL EYES";
      return;
    }
  }
  if (imageReplaced) return;
  updateState(centred);
}

function playImageMeme() {
  if (imageMemeActive) return;
  imageMemeActive = true;
  showMeme(nextFallbackMeme());
  memeCount += 1;
  statusCount.textContent = String(memeCount);
}

function playNextMeme() {
  if (!memeVideo.classList.contains("active") || body.dataset.state !== "away") return;
  showMeme(nextFallbackMeme());
  memeCount += 1;
  statusCount.textContent = String(memeCount);
}

function averageEyeGaze(landmarks) {
  const left = eyeGaze(landmarks, LEFT_EYE);
  const right = eyeGaze(landmarks, RIGHT_EYE);
  // The nose shifts within the face bounds when the viewer turns their head,
  // covering the common case where pupils remain centred while looking aside.
  const headX = ratio(landmarks[1].x, landmarks[234].x, landmarks[454].x);
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, headX, time: performance.now() };
}

function eyeGaze(landmarks, eye) {
  const iris = centroid(eye.iris.map((index) => landmarks[index]));
  // Per-eye ratios are resistant to camera distance and modest head movement.
  return {
    x: ratio(iris.x, landmarks[eye.inner].x, landmarks[eye.outer].x),
    y: ratio(iris.y, landmarks[eye.top].y, landmarks[eye.bottom].y),
  };
}

function isBlinking(landmarks) {
  return eyeOpenness(landmarks, LEFT_EYE) < BLINK_OPENNESS_THRESHOLD
    && eyeOpenness(landmarks, RIGHT_EYE) < BLINK_OPENNESS_THRESHOLD;
}

function hasVisibleEyes(landmarks) {
  return [LEFT_EYE, RIGHT_EYE].every((eye) => {
    const iris = centroid(eye.iris.map((index) => landmarks[index]));
    const horizontal = ratio(iris.x, landmarks[eye.inner].x, landmarks[eye.outer].x);
    const vertical = ratio(iris.y, landmarks[eye.top].y, landmarks[eye.bottom].y);
    const width = distance(landmarks[eye.inner], landmarks[eye.outer]);
    return width > 0.015
      && horizontal >= -0.15 && horizontal <= 1.15
      && vertical >= -0.5 && vertical <= 1.5;
  });
}

function isEyeOccluded(landmarks, hands) {
  if (!hands?.landmarks?.length) return false;
  return hands.landmarks.some((hand) => hand.some((point) => (
    [LEFT_EYE, RIGHT_EYE].some((eye) => {
      const xs = eye.ring.map((index) => landmarks[index].x);
      const ys = eye.ring.map((index) => landmarks[index].y);
      return point.x >= Math.min(...xs) - 0.12
        && point.x <= Math.max(...xs) + 0.12
        && point.y >= Math.min(...ys) - 0.12
        && point.y <= Math.max(...ys) + 0.12;
    })
  )));
}

function eyeOpenness(landmarks, eye) {
  return distance(landmarks[eye.top], landmarks[eye.bottom])
    / Math.max(distance(landmarks[eye.inner], landmarks[eye.outer]), 0.00001);
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function ratio(value, start, end) {
  const span = end - start;
  return Math.abs(span) < 0.00001 ? 0.5 : (value - start) / span;
}

function centroid(points) {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

function meanGaze(samples) {
  const total = samples.reduce(
    (sum, sample) => ({ x: sum.x + sample.x, y: sum.y + sample.y, headX: sum.headX + sample.headX }),
    { x: 0, y: 0, headX: 0 }
  );
  return { x: total.x / samples.length, y: total.y / samples.length, headX: total.headX / samples.length };
}

function largestFace(faces) {
  return faces.reduce((largest, face) => (
    faceArea(face) > faceArea(largest) ? face : largest
  ));
}

function faceArea(landmarks) {
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

function lerp(from, to, amount) { return from + (to - from) * amount; }

function updateState(centred) {
  const now = performance.now();
  if (centred) {
    awaySince = null;
    centredSince ??= now;
    if (!looking && now - centredSince >= RETURN_DEBOUNCE_MS) {
      looking = true;
      stopMemeVideo();
      body.dataset.state = "locked";
    }
  } else {
    centredSince = null;
    awaySince ??= now;
    if (looking && now - awaySince >= AWAY_DEBOUNCE_MS) {
      triggerAway();
    }
  }
}

function stopMemeVideo() {
  memeVideo.pause();
  memeVideo.muted = true;
  memeVideo.loop = false;
  memeVideo.classList.remove("active");
  try {
    memeVideo.currentTime = 0;
  } catch {
    // The source can be resetting after a failed network request.
  }
}

function triggerAway() {
  if (!looking) return;
  looking = false;
  centredSince = awaySince = null;
  // Advance through the folder playlist in order, wrapping after the last meme.
  showMeme(nextFallbackMeme());
  memeCount += 1;
  statusCount.textContent = String(memeCount);
  statusCount.title = `${fallbackVideos.length} memes in the folder`;
}

function showMeme(item) {
  body.dataset.memeReady = "false";
  body.dataset.state = "away";
  memeImg.classList.remove("active");
  memeVideo.classList.remove("active");
  if (item.type === "video") {
    memeVideo.loop = true;
    memeVideo.classList.add("active");
    if (memeVideo.dataset.source !== item.url) {
      memeVideo.pause();
      memeVideo.dataset.source = item.url;
      memeVideo.src = item.url;
      memeVideo.load();
    }
    playMemeVideoWhenReady();
    return;
  }

  memeVideo.pause();
  memeVideo.loop = false;
  memeVideo.removeAttribute("src");
  memeVideo.dataset.source = "";
  memeImg.addEventListener("load", () => {
    memeImg.classList.add("active");
    body.dataset.memeReady = "true";
  }, { once: true });
  memeImg.src = item.url;
}

function playMemeVideoWhenReady() {
  const play = () => {
    memeVideo.muted = true;
    memeVideo.volume = 1;
    const playback = memeVideo.play();
    if (playback) {
      playback.then(() => {
        memeVideo.muted = false;
        body.dataset.memeReady = "true";
      }).catch(() => {});
    }
  };

  if (memeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    play();
  } else {
    memeVideo.addEventListener("canplay", play, { once: true });
  }
}

function nextFallbackMeme() {
  const item = fallbackVideos[fallbackMemeIndex];
  fallbackMemeIndex = (fallbackMemeIndex + 1) % fallbackVideos.length;
  return item;
}

function setFallbackPlaylist(playlist) {
  if (!Array.isArray(playlist)) return;
  const media = playlist
    .filter((meme) => meme?.type === "video" || meme?.type === "image")
    .map((meme) => ({ url: meme.url, type: meme.type }));
  if (media.length) {
    fallbackVideos = media;
    fallbackMemeIndex %= fallbackVideos.length;
  }
}

async function uploadImage(event) {
  event.preventDefault();
  const image = imageUpload.files[0];
  if (!image) return;

  if (uploadedImageUrl) URL.revokeObjectURL(uploadedImageUrl);
  uploadedImageUrl = URL.createObjectURL(image);
  imageMemeActive = false;
  stopCamera();
  await enableImageDetection();
  memeVideo.pause();
  memeVideo.classList.remove("active");
  memeImg.src = uploadedImageUrl;
  memeImg.classList.add("active");
  body.dataset.cameraReplaced = "true";
  body.dataset.memeReady = "true";
  if (!landmarker) await start();
  uploadStatus.textContent = "CAMERA FEED REPLACED";
  uploadForm.reset();
}

async function useCamera() {
  if (uploadedImageUrl) URL.revokeObjectURL(uploadedImageUrl);
  uploadedImageUrl = null;
  imageMemeActive = false;
  stopCamera();
  cancelAnimationFrame(animationFrame);
  memeVideo.pause();
  memeVideo.classList.remove("active");
  memeImg.classList.remove("active");
  memeImg.removeAttribute("src");
  body.dataset.cameraReplaced = "false";
  body.dataset.memeReady = "false";
  body.dataset.state = "idle";
  landmarker?.close();
  handLandmarker?.close();
  landmarker = handLandmarker = null;
  imageDetectionReady = false;
  uploadStatus.textContent = "";
  await start();
}

function turnOffCamera() {
  if (mediaRecorder?.state === "recording") stopRecording();
  cancelAnimationFrame(animationFrame);
  stopMemeVideo();
  memeVideo.classList.remove("active");
  memeImg.classList.remove("active");
  stopCamera();
  landmarker?.close();
  handLandmarker?.close();
  landmarker = handLandmarker = null;
  imageDetectionReady = false;
  body.dataset.cameraReplaced = "false";
  body.dataset.memeReady = "false";
  body.dataset.state = "idle";
  statusSubject.textContent = "CAMERA OFF";
  startBtn.disabled = false;
  startBtn.textContent = "POWER ON";
}

async function startRecording() {
  if (!stream?.active && body.dataset.cameraReplaced !== "true") {
    recordStatus.textContent = "START THE CAMERA OR SELECT AN IMAGE FIRST";
    return;
  }
  if (!window.MediaRecorder) {
    recordStatus.textContent = "RECORDING IS NOT SUPPORTED IN THIS BROWSER";
    return;
  }
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
    ? "video/webm;codecs=vp8,opus"
    : "video/webm";
  recordCanvas.width = 1280;
  recordCanvas.height = 720;
  recordingStream = recordCanvas.captureStream(30);
  await setupRecordingAudio();
  recordingAudioDestination?.stream.getAudioTracks().forEach((track) => recordingStream.addTrack(track));
  recordingChunks = [];
  mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) recordingChunks.push(event.data);
  });
  mediaRecorder.addEventListener("stop", () => { void finishRecording(); }, { once: true });
  mediaRecorder.start();
  drawRecordingFrame();
  recordBtn.disabled = true;
  stopRecordBtn.disabled = false;
  recordStatus.textContent = "RECORDING";
}

async function setupRecordingAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  recordingAudioContext ??= new AudioContextClass();
  recordingAudioDestination ??= recordingAudioContext.createMediaStreamDestination();
  recordingAudioSource ??= recordingAudioContext.createMediaElementSource(memeVideo);
  recordingAudioSource.connect(recordingAudioContext.destination);
  recordingAudioSource.connect(recordingAudioDestination);
  await recordingAudioContext.resume();
}

function stopRecording() {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    stopRecordBtn.disabled = true;
    recordStatus.textContent = "PROCESSING RECORDING…";
  }
}

async function finishRecording() {
  cancelAnimationFrame(recordingFrame);
  recordingStream = null;
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  try {
    recordingUrl = URL.createObjectURL(new Blob(recordingChunks, { type: "video/webm" }));
    recordingDownload.href = recordingUrl;
    recordingDownload.download = "look-at-me-recording.webm";
    recordingDownload.classList.remove("hidden");
    recordStatus.textContent = "WEBM RECORDING READY";
  } catch (error) {
    recordStatus.textContent = error.message || "WEBM RECORDING FAILED";
  } finally {
    recordBtn.disabled = false;
    mediaRecorder = null;
  }
}

function drawRecordingFrame() {
  if (!recordingStream) return;
  const width = recordCanvas.width;
  const height = recordCanvas.height;
  recordContext.fillStyle = "#05060a";
  recordContext.fillRect(0, 0, width, height);

  const showingMeme = memeVideo.classList.contains("active");
  const cameraSource = body.dataset.cameraReplaced === "true" ? memeImg : video;
  if (showingMeme) {
    drawRecordingSource(cameraSource, 0, 0, width / 2, height, true, !body.dataset.cameraReplaced);
    drawRecordingSource(memeVideo, width / 2, 0, width / 2, height, true, false);
    recordContext.drawImage(overlay, 0, 0, width / 2, height);
  } else {
    drawRecordingSource(
      cameraSource,
      0,
      0,
      width,
      height,
      body.dataset.cameraReplaced === "true",
      body.dataset.cameraReplaced !== "true"
    );
    recordContext.drawImage(overlay, 0, 0, width, height);
  }
  recordingFrame = requestAnimationFrame(drawRecordingFrame);
}

function drawRecordingSource(source, x, y, width, height, contain, mirror) {
  const sourceWidth = source.videoWidth || source.naturalWidth;
  const sourceHeight = source.videoHeight || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) return;
  const scale = contain
    ? Math.min(width / sourceWidth, height / sourceHeight)
    : Math.max(width / sourceWidth, height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = x + (width - renderedWidth) / 2;
  const offsetY = y + (height - renderedHeight) / 2;
  if (mirror) {
    recordContext.save();
    recordContext.translate(x + width, 0);
    recordContext.scale(-1, 1);
    recordContext.drawImage(source, x + width - offsetX - renderedWidth, offsetY, renderedWidth, renderedHeight);
    recordContext.restore();
  } else {
    recordContext.drawImage(source, offsetX, offsetY, renderedWidth, renderedHeight);
  }
}

async function addComment(event) {
  event.preventDefault();
  const text = commentInput.value.trim();
  if (!text) return;
  try {
    await postComment(text);
    commentInput.value = "";
  } catch (error) {
    const message = error.message.toLowerCase();
    commentStatus.textContent = message.includes("401") || message.includes("sign in")
      ? "SIGN IN TO COMMENT"
      : "";
  }
}

async function postComment(text, parentId = null) {
  if (!currentUsername) throw new Error("SIGN IN TO COMMENT");
  const commentsData = JSON.parse(localStorage.getItem("look-at-me-comments") || "[]");
  const comment = { id: Date.now(), text, parent_id: parentId, username: currentUsername };
  commentsData.unshift(comment);
  localStorage.setItem("look-at-me-comments", JSON.stringify(commentsData));
  commentsLoadToken += 1;
  if (parentId === null) comments.prepend(createComment(comment, 0));
  return comment;
}

function createComment(commentData, depth) {
  const comment = document.createElement("div");
  comment.className = "comment";
  comment.dataset.depth = String(depth);
  comment.style.marginLeft = `${Math.min(depth, 8) * 32}px`;
  const content = document.createElement("span");
  content.textContent = `${commentData.username}: ${commentData.text}`;
  const actions = document.createElement("span");
  actions.className = "comment-actions";
  const replyButton = document.createElement("button");
  replyButton.type = "button";
  replyButton.className = "reply-comment";
  replyButton.textContent = "REPLY";
  replyButton.addEventListener("click", async () => {
    const text = window.prompt(`Reply to ${commentData.username}:`);
    if (!text?.trim()) return;
    try {
      await postComment(text.trim(), commentData.id);
      await loadComments();
    } catch (error) {
      commentStatus.textContent = "";
    }
  });
  actions.append(replyButton);
  if (currentUsername === commentData.username) {
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-comment";
    deleteButton.textContent = "DELETE";
    deleteButton.addEventListener("click", async () => {
      try {
        const saved = JSON.parse(localStorage.getItem("look-at-me-comments") || "[]")
          .filter((item) => item.id !== commentData.id);
        localStorage.setItem("look-at-me-comments", JSON.stringify(saved));
        comment.remove();
      } catch (error) {
        commentStatus.textContent = "";
      }
    });
    actions.append(deleteButton);
  }
  comment.append(content, actions);
  return comment;
}

async function loadComments() {
  const data = JSON.parse(localStorage.getItem("look-at-me-comments") || "[]");
  comments.replaceChildren();
  const byParent = new Map();
  data.forEach((comment) => {
    const key = comment.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(comment);
  });
  const render = (parentId, depth) => {
    (byParent.get(parentId) || []).forEach((comment) => {
      comments.append(createComment(comment, depth));
      render(comment.id, depth + 1);
    });
  };
  render(null, 0);
}

async function loadSession() {
  const username = localStorage.getItem("look-at-me-user");
  if (username) updateAuthUi(username);
  else commentStatus.textContent = "SIGN IN TO COMMENT";
}

function updateAuthUi(username) {
  currentUsername = username;
  authBtn.classList.add("hidden");
  signedInPanel.classList.remove("hidden");
  signInHint.classList.add("hidden");
  signedInAs.textContent = `SIGNED IN AS ${username}`;
  commentStatus.textContent = "";
}

async function signOut() {
  localStorage.removeItem("look-at-me-user");
  currentUsername = null;
  authBtn.classList.remove("hidden");
  signedInPanel.classList.add("hidden");
  signInHint.classList.remove("hidden");
  signedInAs.textContent = "";
  commentStatus.textContent = "SIGN IN TO COMMENT";
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}

function drawEyes(landmarks, gaze, centred) {
  const color = centred ? "#3dff7a" : "#ffb02e";
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ctx.fillStyle = color;
  [LEFT_EYE, RIGHT_EYE].forEach((eye) => {
    ctx.beginPath();
    eye.ring.forEach((index, position) => {
      const point = project(landmarks[index]);
      position ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.stroke();
    const iris = project(centroid(eye.iris.map((index) => landmarks[index])));
    ctx.beginPath();
    ctx.arc(iris.x, iris.y, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillRect(iris.x - 1.5, iris.y - 1.5, 3, 3);
  });
  ctx.font = "11px IBM Plex Mono, monospace";
  ctx.fillText(`GAZE ${gaze.x.toFixed(2)}, ${gaze.y.toFixed(2)}`, 14, 22);
}

// Match object-fit: cover and the webcam's CSS mirror exactly.
function project(point) {
  const width = overlay.clientWidth;
  const height = overlay.clientHeight;
  const imageReplaced = body.dataset.cameraReplaced === "true";
  const sourceWidth = imageReplaced ? memeImg.naturalWidth : video.videoWidth;
  const sourceHeight = imageReplaced ? memeImg.naturalHeight : video.videoHeight;
  const scale = imageReplaced
    ? Math.min(width / sourceWidth, height / sourceHeight)
    : Math.max(width / sourceWidth, height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const x = point.x * renderedWidth + (width - renderedWidth) / 2;
  return {
    x: imageReplaced ? x : width - x,
    y: point.y * renderedHeight + (height - renderedHeight) / 2,
  };
}

function sizeOverlay() {
  const density = devicePixelRatio || 1;
  const width = Math.round(overlay.clientWidth * density);
  const height = Math.round(overlay.clientHeight * density);
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
  ctx.setTransform(density, 0, 0, density, 0, 0);
}

function clearOverlay() { ctx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight); }

async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  await response.text();
  throw new Error(`Server returned an unexpected response (${response.status}). Start the Flask server and reload.`);
}

async function preloadMeme() {
  statusCount.title = `${fallbackVideos.length} bundled memes`;
  preloadMemeItem(fallbackVideos[0]);
}

function preloadMemeItem(item) {
  if (!item || item.type !== "video" || memeVideo.dataset.source === item.url) return;
  memeVideo.preload = "auto";
  memeVideo.dataset.source = item.url;
  memeVideo.src = item.url;
  memeVideo.load();
}

function primeMemeAudio() {
  // This runs synchronously inside the POWER ON click. Starting the element
  // muted and immediately pausing it records the required user interaction;
  // audio can then start later when the gaze transition occurs.
  memeVideo.muted = true;
  const playback = memeVideo.play();
  if (playback) {
    playback.then(() => {
      memeVideo.pause();
      memeVideo.currentTime = 0;
    }).catch(() => {});
  }
}

function describeError(error) {
  if (error?.name === "NotAllowedError") return "Camera access was denied. Allow camera permissions and reload.";
  if (error?.name === "NotFoundError") return "No camera was found on this device.";
  return "Could not start the camera or load the tracking model. Check your connection and reload.";
}

function showError(message) {
  body.dataset.state = "error";
  errorText.textContent = message;
  errorPanel.classList.remove("hidden");
  startBtn.disabled = false;
  startBtn.textContent = "POWER ON";
}

function updateUptime() {
  const seconds = Math.floor((Date.now() - sessionStart) / 1000);
  statusUptime.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function stopCamera() {
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  const activeStreams = [stream, video.srcObject].filter(Boolean);
  activeStreams.forEach((activeStream) => {
    activeStream.getTracks().forEach((track) => track.stop());
  });
  stream = null;
  video.pause();
  video.srcObject = null;
}

function stop() {
  cancelAnimationFrame(animationFrame);
  clearInterval(uptimeTimer);
  stopCamera();
  landmarker?.close();
  stream = landmarker = null;
  handLandmarker?.close();
  handLandmarker = null;
}
