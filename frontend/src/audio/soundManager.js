import { SOUND_KEYS, SOUND_REGISTRY } from "./soundRegistry.js";

const SFX_ENABLED_KEY = "bm_sfx_enabled_v1";
const SFX_MASTER_VOLUME_KEY = "bm_sfx_master_volume_v1";
const audioCache = new Map();
const lastPlayAtByKey = new Map();
const DUPLICATE_BURST_WINDOW_MS = 45;

function clamp01(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function readStorage(key) {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    window.localStorage.setItem(key, String(value));
    return true;
  } catch { return false; }
}

export function isSoundEnabled() {
  return readStorage(SFX_ENABLED_KEY) !== "false";
}

export function setSoundEnabled(enabled) {
  writeStorage(SFX_ENABLED_KEY, Boolean(enabled));
}

export function getMasterVolume() {
  const raw = readStorage(SFX_MASTER_VOLUME_KEY);
  return raw === null ? 1 : clamp01(raw, 1);
}

export function setMasterVolume(volume) {
  writeStorage(SFX_MASTER_VOLUME_KEY, clamp01(volume, 1));
}

function getSoundConfig(soundKey) {
  return SOUND_REGISTRY[soundKey] || null;
}

function getSources(soundKey) {
  const config = getSoundConfig(soundKey);
  if (!config) return [];
  if (Array.isArray(config.sources)) return config.sources.filter(Boolean);
  if (config.src) return [config.src];
  return [];
}

function getAudio(soundKey, source) {
  if (typeof Audio === "undefined" || !source) return null;
  const config = getSoundConfig(soundKey);
  if (!config) return null;

  const cacheKey = `${soundKey}::${source}`;
  let audio = audioCache.get(cacheKey);
  if (!audio) {
    audio = new Audio(source);
    audio.preload = "auto";
    audioCache.set(cacheKey, audio);
  }

  audio.volume = clamp01(config.volume, 1) * getMasterVolume();
  return audio;
}

function chooseSource(soundKey) {
  const sources = getSources(soundKey);
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0];
  const index = Math.floor(Math.random() * sources.length);
  return sources[index] || sources[0];
}

function primeAudio(audio) {
  if (!audio) return false;
  try {
    audio.load();
    const previousMuted = audio.muted;
    audio.muted = true;
    audio.currentTime = 0;

    const playResult = audio.play();
    if (playResult && typeof playResult.then === "function") {
      playResult
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = previousMuted;
        })
        .catch(() => {
          audio.muted = previousMuted;
        });
    } else {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = previousMuted;
    }
    return true;
  } catch {
    return false;
  }
}

export function primeSound(soundKey) {
  if (!isSoundEnabled()) return false;
  const sources = getSources(soundKey);
  if (sources.length === 0) return false;

  let primedAny = false;
  for (const source of sources) {
    const audio = getAudio(soundKey, source);
    if (primeAudio(audio)) primedAny = true;
  }
  return primedAny;
}

export function playSound(soundKey) {
  if (!isSoundEnabled()) return false;

  // A document-level semantic click binding can fire before a page's existing
  // React onClick handler. Suppress the second copy of the same semantic sound
  // from the same physical click without affecting normal human-speed clicks.
  const now = typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
  const previous = Number(lastPlayAtByKey.get(soundKey));
  if (Number.isFinite(previous) && now - previous < DUPLICATE_BURST_WINDOW_MS) return false;

  const source = chooseSource(soundKey);
  if (!source) return false;

  const audio = getAudio(soundKey, source);
  if (!audio) return false;

  try {
    const config = getSoundConfig(soundKey);
    audio.pause();
    audio.muted = false;
    audio.currentTime = 0;
    audio.volume = clamp01(config?.volume, 1) * getMasterVolume();
    lastPlayAtByKey.set(soundKey, now);
    const playResult = audio.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

export { SOUND_KEYS };
