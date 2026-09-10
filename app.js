const VIDEO_ID = "M-2eAiU09qg";
const SUNRISE_VIDEO_ID = "ERlvvvNUeas";
const ALARM_VIDEO_ID = "MQm_1cteY3o";
const DAWN_VOLUME = 18;

const setupEl = document.getElementById("setup");
const nightEl = document.getElementById("night");
const overlayEl = document.getElementById("dawn-overlay");
const dimEl = document.getElementById("dim-overlay");
const skyEl = document.getElementById("fallback-sky");
const clockEl = document.getElementById("clock");
const statusEl = document.getElementById("status-label");
const alarmCaptionEl = document.getElementById("alarm-caption");
const alarmInput = document.getElementById("alarm-time");
const fadeInput = document.getElementById("fade-minutes");
const brightnessInput = document.getElementById("brightness");
const nightBrightnessInput = document.getElementById("night-brightness");
const brightnessLabel = document.getElementById("brightness-label");
const morningNoteInput = document.getElementById("morning-note");
const liveMessageEl = document.getElementById("live-message");

let alarmAt = null;
let fadeMs = 30 * 60 * 1000;
let dawnProgress = 0;
let tickId = 0;
let alarmStarted = false;
let wakeLock = null;
let audioCtx = null;
let alarmTimer = 0;
let alarmNodes = [];
let skyAnim = 0;
let player = null;
let alarmPlayer = null;
let ytReady = false;
let soundOn = false;
let sunriseVideoStarted = false;

const saved = JSON.parse(localStorage.getItem("sunrise-alarm") || "{}");
if (saved.alarmTime) alarmInput.value = saved.alarmTime;
else {
  const d = new Date();
  d.setHours(d.getHours() + 8, 0, 0, 0);
  alarmInput.value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
if (saved.fadeMinutes) fadeInput.value = String(saved.fadeMinutes);
if (saved.brightness != null) brightnessInput.value = String(saved.brightness);
if (saved.morningNote) morningNoteInput.value = saved.morningNote;
nightBrightnessInput.value = brightnessInput.value;
updateBrightnessLabel();
applyDim();

function persist() {
  localStorage.setItem(
    "sunrise-alarm",
    JSON.stringify({
      alarmTime: alarmInput.value,
      fadeMinutes: Number(fadeInput.value),
      brightness: Number(brightnessInput.value),
      morningNote: morningNoteInput.value,
    })
  );
}

function brightnessWords(value) {
  if (value <= 0) return "all the way off";
  if (value >= 100) return "full brightness";
  if (value < 25) return "very dim";
  if (value < 60) return "dim";
  return "bright";
}

function updateBrightnessLabel() {
  const value = Number(brightnessInput.value);
  brightnessLabel.textContent = `${value}% — ${brightnessWords(value)}`;
}

function applyDim() {
  const brightness = Number(brightnessInput.value) / 100;
  const dim = (1 - brightness) * (1 - dawnProgress);
  dimEl.style.opacity = String(dim);
}

function nextAlarmDate(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const when = new Date();
  when.setHours(h, m, 0, 0);
  if (when.getTime() <= Date.now() + 1000) when.setDate(when.getDate() + 1);
  return when;
}

function formatClock(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m} min`;
  return `${total}s`;
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function startAlarmSound() {
  const ctx = ensureAudio();
  stopAlarmSound();
  const beep = () => {
    alarmNodes.forEach((node) => {
      try {
        node.stop?.();
        node.disconnect?.();
      } catch {
        /* already stopped */
      }
    });
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.start(t);
    osc.stop(t + 0.38);
    alarmNodes = [osc, gain];
  };
  beep();
  alarmTimer = setInterval(beep, 900);
}

function stopAlarmSound() {
  clearInterval(alarmTimer);
  alarmTimer = 0;
  alarmNodes.forEach((node) => {
    try {
      node.stop?.();
      node.disconnect?.();
    } catch {
      /* already stopped */
    }
  });
  alarmNodes = [];
}

function drawFallbackSky(ts) {
  const ctx = skyEl.getContext("2d");
  const w = (skyEl.width = innerWidth);
  const h = (skyEl.height = innerHeight);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#05061a");
  g.addColorStop(0.55, "#10143a");
  g.addColorStop(1, "#1b1630");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (let i = 0; i < 80; i += 1) {
    const x = ((i * 137.5) % w) + Math.sin(ts / 8000 + i) * 8;
    const y = ((i * 89.3) % (h * 0.7)) + Math.cos(ts / 9000 + i) * 6;
    ctx.globalAlpha = 0.25 + ((i * 13) % 7) / 12;
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
  skyAnim = requestAnimationFrame(drawFallbackSky);
}

function useFallbackSky(on) {
  cancelAnimationFrame(skyAnim);
  skyEl.hidden = !on;
  if (on) drawFallbackSky(performance.now());
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-yt-api]");
    window.onYouTubeIframeAPIReady = () => resolve();
    if (!existing) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.dataset.ytApi = "true";
      tag.onerror = () => reject(new Error("YouTube API failed"));
      document.head.appendChild(tag);
    }
    setTimeout(() => {
      if (window.YT?.Player) resolve();
    }, 4000);
  });
}

function setVideoSilent() {
  soundOn = false;
  if (!player?.mute) return;
  try {
    player.mute();
    player.setVolume(0);
  } catch {
    /* player not ready */
  }
}

function setVideoQuiet() {
  soundOn = true;
  if (!player?.unMute) return;
  try {
    player.unMute();
    player.setVolume(DAWN_VOLUME);
  } catch {
    /* player not ready */
  }
}

function startSunriseVideo() {
  if (!player?.loadVideoById) return false;
  try {
    player.loadVideoById({ videoId: SUNRISE_VIDEO_ID, startSeconds: 0 });
    player.unMute();
    player.setVolume(DAWN_VOLUME);
    player.playVideo();
    sunriseVideoStarted = true;
    soundOn = true;
    return true;
  } catch {
    return false;
  }
}

function setSunriseVolume(progress) {
  if (!sunriseVideoStarted || !player?.setVolume) return;
  try {
    player.unMute();
    player.setVolume(Math.round(DAWN_VOLUME + (100 - DAWN_VOLUME) * progress));
  } catch {
    /* player not ready */
  }
}

function startAlarmTrack() {
  if (!alarmPlayer?.playVideo) return;
  try {
    alarmPlayer.seekTo(0);
    alarmPlayer.unMute();
    alarmPlayer.setVolume(100);
    alarmPlayer.playVideo();
  } catch {
    /* YouTube may still be initializing */
  }
}

function stopAlarmTrack() {
  try {
    alarmPlayer?.stopVideo?.();
    alarmPlayer?.destroy?.();
  } catch {
    /* ignore */
  }
  alarmPlayer = null;
  document.getElementById("alarm-wrap").innerHTML = '<div id="alarm-player"></div>';
}

async function startFireplace() {
  useFallbackSky(false);
  try {
    await loadYouTubeApi();
    if (!alarmPlayer) {
      alarmPlayer = new YT.Player("alarm-player", {
        videoId: ALARM_VIDEO_ID,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady(event) {
            event.target.mute();
            event.target.setVolume(0);
          },
        },
      });
    }
    if (player?.playVideo) {
      setVideoSilent();
      player.playVideo();
      return;
    }
    player = new YT.Player("yt-player", {
      videoId: VIDEO_ID,
      playerVars: {
        autoplay: 1,
        mute: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        iv_load_policy: 3,
        playsinline: 1,
        loop: 1,
        playlist: VIDEO_ID,
        origin: window.location.origin,
      },
      events: {
        onReady(event) {
          ytReady = true;
          event.target.mute();
          event.target.setVolume(0);
          event.target.playVideo();
          if (soundOn) setVideoQuiet();
        },
        onStateChange(event) {
          if (event.data === YT.PlayerState.ENDED) event.target.playVideo();
        },
        onError() {
          useFallbackSky(true);
        },
      },
    });
  } catch {
    useFallbackSky(true);
  }
}

function stopFireplace() {
  setVideoSilent();
  try {
    player?.stopVideo?.();
    player?.destroy?.();
  } catch {
    /* ignore */
  }
  player = null;
  ytReady = false;
  sunriseVideoStarted = false;
  document.getElementById("yt-wrap").innerHTML = '<div id="yt-player"></div>';
}

async function enterFullscreen() {
  const root = document.documentElement;
  if (document.fullscreenElement) return;
  try {
    await root.requestFullscreen();
  } catch {
    /* TV browsers sometimes block this */
  }
}

function setMode(mode) {
  setupEl.classList.toggle("hidden", mode !== "setup");
  nightEl.classList.toggle("hidden", mode !== "night");
  document.body.classList.toggle("alarm-ringing", alarmStarted);
}

function stopNight() {
  clearInterval(tickId);
  tickId = 0;
  alarmStarted = false;
  dawnProgress = 0;
  stopAlarmSound();
  stopAlarmTrack();
  stopFireplace();
  releaseWakeLock();
  useFallbackSky(false);
  overlayEl.style.opacity = "0";
  liveMessageEl.textContent = "";
  liveMessageEl.classList.add("hidden");
  applyDim();
  document.exitFullscreen?.().catch(() => {});
  setMode("setup");
}

function beginAlarm() {
  if (alarmStarted) return;
  alarmStarted = true;
  dawnProgress = 1;
  overlayEl.style.opacity = "1";
  applyDim();
  if (!sunriseVideoStarted) startSunriseVideo();
  setSunriseVolume(1);
  startAlarmTrack();
  const note = morningNoteInput.value.trim();
  liveMessageEl.textContent = note;
  liveMessageEl.classList.toggle("hidden", !note);
  alarmCaptionEl.textContent = "Alarm ringing";
  document.getElementById("dismiss-btn").classList.remove("hidden");
  setMode("night");
}

function tick() {
  const now = Date.now();
  const dawnStart = alarmAt - fadeMs;
  clockEl.textContent = formatClock(new Date(now));

  if (now >= alarmAt) {
    overlayEl.style.opacity = "1";
    beginAlarm();
    return;
  }

  if (now >= dawnStart) {
    dawnProgress = Math.min(1, (now - dawnStart) / fadeMs);
    overlayEl.style.opacity = String(dawnProgress);
    statusEl.textContent = "Sunrise in progress";
    alarmCaptionEl.textContent = `Sunrise sound on · alarm in ${formatRemaining(alarmAt - now)}`;
    if (!sunriseVideoStarted) startSunriseVideo();
    setSunriseVolume(dawnProgress);
    const note = morningNoteInput.value.trim();
    liveMessageEl.textContent = note;
    liveMessageEl.classList.toggle("hidden", !note);
  } else {
    dawnProgress = 0;
    overlayEl.style.opacity = "0";
    liveMessageEl.classList.add("hidden");
    statusEl.textContent = "Until dawn";
    alarmCaptionEl.textContent = `Silent · light begins in ${formatRemaining(dawnStart - now)} · alarm ${formatClock(new Date(alarmAt))}`;
    if (soundOn) setVideoSilent();
  }
  applyDim();
}

async function startNight({ preview = false } = {}) {
  persist();
  alarmStarted = false;
  soundOn = false;
  dawnProgress = 0;
  sunriseVideoStarted = false;
  fadeMs = Number(fadeInput.value) * 60 * 1000;

  if (preview) {
    alarmAt = Date.now() + 32 * 1000;
    fadeMs = 30 * 1000;
  } else {
    alarmAt = nextAlarmDate(alarmInput.value).getTime();
  }

  setMode("night");
  applyDim();
  tick();
  clearInterval(tickId);
  tickId = setInterval(tick, 250);

  enterFullscreen();
  requestWakeLock();
  ensureAudio();
  await startFireplace();
}

function syncBrightness(fromNight) {
  if (fromNight) brightnessInput.value = nightBrightnessInput.value;
  else nightBrightnessInput.value = brightnessInput.value;
  updateBrightnessLabel();
  applyDim();
  persist();
}

document.getElementById("setup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  startNight({ preview: false });
});

document.getElementById("preview-btn").addEventListener("click", () => {
  startNight({ preview: true });
});

document.getElementById("stop-btn").addEventListener("click", () => stopNight());
document.getElementById("dismiss-btn").addEventListener("click", () => stopNight());
document.getElementById("fullscreen-btn").addEventListener("click", enterFullscreen);

brightnessInput.addEventListener("input", () => syncBrightness(false));
nightBrightnessInput.addEventListener("input", () => syncBrightness(true));

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !nightEl.classList.contains("hidden")) {
    requestWakeLock();
    player?.playVideo?.();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && setupEl.classList.contains("hidden")) {
    stopNight();
  }
});
