import { playSound, SOUND_KEYS } from "./soundManager.js";

const EVENT_MARKER = "__bmSemanticUiSoundPlayed";

function nativeEventOf(event) {
  return event?.nativeEvent || event || null;
}

function markAndPlay(event, soundKey) {
  const nativeEvent = nativeEventOf(event);
  if (nativeEvent?.[EVENT_MARKER]) return false;
  if (nativeEvent) nativeEvent[EVENT_MARKER] = true;
  return playSound(soundKey);
}

function closestElement(target, selector) {
  if (!(target instanceof Element)) return null;
  return target.closest(selector);
}

function actionControlOf(target) {
  return closestElement(
    target,
    'button, a[href], [role="button"], [role="tab"], input[type="button"], input[type="submit"], input[type="radio"], input[type="checkbox"], select, [aria-label], [title]'
  );
}

function isDisabledControl(control) {
  if (!control) return false;
  if (control.matches?.("button:disabled, input:disabled, select:disabled, textarea:disabled")) return true;
  return String(control.getAttribute?.("aria-disabled") || "").toLowerCase() === "true";
}

function normalizedText(control) {
  return String(control?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isCloseControl(control) {
  if (!control) return false;
  const aria = String(control.getAttribute?.("aria-label") || "").trim().toLowerCase();
  const title = String(control.getAttribute?.("title") || "").trim().toLowerCase();
  const text = String(control.textContent || "").trim();
  if (aria.includes("close") || title.includes("close")) return true;
  return ["×", "✕", "✖", "❌"].includes(text);
}

function isBackControl(control) {
  if (!control) return false;
  const aria = String(control.getAttribute?.("aria-label") || "").trim().toLowerCase();
  const title = String(control.getAttribute?.("title") || "").trim().toLowerCase();
  const text = normalizedText(control);
  if (aria === "back" || aria.startsWith("back ") || aria.includes("go back") || aria.includes("return back")) return true;
  if (title === "back" || title.startsWith("back ") || title.includes("go back")) return true;
  if (text === "back" || text.startsWith("back to ") || text === "←" || text === "‹" || text === "◀") return true;
  if (text.startsWith("← back") || text.startsWith("‹ back") || text.startsWith("◀ back")) return true;
  return false;
}

function isSelectedControl(control) {
  if (!control) return false;

  const ariaSelected = String(control.getAttribute?.("aria-selected") || "").toLowerCase();
  const ariaPressed = String(control.getAttribute?.("aria-pressed") || "").toLowerCase();
  const ariaCurrent = String(control.getAttribute?.("aria-current") || "").toLowerCase();
  const dataState = String(control.getAttribute?.("data-state") || "").toLowerCase();
  const dataSelected = String(control.getAttribute?.("data-selected") || "").toLowerCase();

  if (ariaSelected === "true" || ariaPressed === "true") return true;
  if (ariaCurrent && ariaCurrent !== "false") return true;
  if (dataState === "active" || dataState === "selected" || dataSelected === "true") return true;
  if (control.matches?.('input[type="radio"]:checked, input[type="checkbox"]:checked')) return true;

  const selectedClasses = ["active", "is-active", "selected", "is-selected", "current", "is-current"];
  return selectedClasses.some((className) => control.classList?.contains(className));
}

function isPlayerCardOpenControl(control) {
  if (!control) return false;
  const aria = String(control.getAttribute?.("aria-label") || "").trim().toLowerCase();
  const title = String(control.getAttribute?.("title") || "").trim().toLowerCase();
  const text = normalizedText(control);
  return aria.includes("player card") || title.includes("player card") || text === "player card" || text === "open player card";
}

function currentPathname() {
  if (typeof window === "undefined") return "";
  return String(window.location?.pathname || "").replace(/\/+$/, "") || "/";
}

function isTradeSurface(pathname) {
  return pathname === "/trades" || pathname === "/trade-finder";
}

function isDedicatedTradeFinderControl(control, pathname) {
  if (pathname !== "/trade-finder" || !control) return false;
  const text = normalizedText(control);
  // These already have purpose-built Trade Finder sounds. Do not stack the
  // generic trade-surface click on top of them.
  return text === "add" || text === "remove" || text === "search offers";
}

function shouldPlayUiNavigation(event, control) {
  const target = event?.target;
  if (!(target instanceof Element)) return false;

  const explicitTarget = closestElement(target, '[data-bm-sfx-ui-nav="true"]');
  if (explicitTarget && !isDisabledControl(explicitTarget)) return !isSelectedControl(explicitTarget);

  if (!control || isDisabledControl(control) || isSelectedControl(control)) return false;

  const scope = closestElement(control, '[data-bm-sfx-scope]');
  const scopeName = String(scope?.getAttribute?.("data-bm-sfx-scope") || "").toLowerCase();
  if (scopeName === "player-card" || scopeName === "offseason") return true;

  if (isPlayerCardOpenControl(control)) return true;

  const pathname = currentPathname();
  if (isTradeSurface(pathname) && !isDedicatedTradeFinderControl(control, pathname)) return true;

  return false;
}

function handleDocumentClick(event) {
  const target = event?.target;
  if (!(target instanceof Element)) return;

  if (closestElement(target, '[data-bm-sfx-skip-ui-nav="true"]')) return;

  const control = actionControlOf(target);
  if (!control || isDisabledControl(control)) return;

  // Back/close is global and always wins over the generic UI-navigation sound.
  if (isCloseControl(control) || isBackControl(control)) {
    markAndPlay(event, SOUND_KEYS.UI_BACK_CANCEL);
    return;
  }

  // Clicking the already-selected tab/tile/player/package again is a no-op;
  // no generic sound should repeat for a no-op selection.
  if (isSelectedControl(control)) return;

  if (!shouldPlayUiNavigation(event, control)) return;
  markAndPlay(event, SOUND_KEYS.SIDEBAR_NAVIGATION);
}

let installed = false;

export function installUiSoundBindings() {
  if (installed || typeof document === "undefined") return false;
  document.addEventListener("click", handleDocumentClick, true);
  installed = true;
  return true;
}

export function uninstallUiSoundBindings() {
  if (!installed || typeof document === "undefined") return false;
  document.removeEventListener("click", handleDocumentClick, true);
  installed = false;
  return true;
}
