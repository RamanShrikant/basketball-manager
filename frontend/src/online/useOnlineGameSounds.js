import { useEffect } from "react";
import { playSound, SOUND_KEYS } from "../audio/soundManager.js";

// Online uses the SAME registered audio assets and master-volume/mute settings
// as Basketball Manager. No oscillator sounds or invented Online sound assets.
export default function useOnlineGameSounds() {
  useEffect(() => {
    const handler = event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const root = target.closest(".on-root");
      if (!root) return;
      const control = target.closest('button,a[href],[role="button"]');
      if (!control || control.disabled || control.getAttribute("aria-disabled") === "true") return;
      if (control.closest('[data-on-sfx-manual="true"]')) return;
      const label = `${control.getAttribute("aria-label") || ""} ${control.getAttribute("title") || ""} ${control.textContent || ""}`.toLowerCase();
      if (/\b(back|cancel|close|leave|sign out)\b|←/.test(label) || /[×✕]/.test(label)) {
        playSound(SOUND_KEYS.UI_BACK_CANCEL);
      } else {
        playSound(SOUND_KEYS.SIDEBAR_NAVIGATION);
      }
    };
    document.addEventListener("click",handler,true);
    return () => document.removeEventListener("click",handler,true);
  },[]);
}
