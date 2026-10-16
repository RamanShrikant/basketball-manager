import { useEffect } from "react";

function shouldIgnoreTeamNavigation(event) {
  const tag = String(event?.target?.tagName || "").toLowerCase();
  if (["input", "select", "textarea", "button"].includes(tag)) return true;
  if (event?.target?.isContentEditable) return true;
  if (event?.ctrlKey || event?.metaKey || event?.altKey) return true;
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  return false;
}

export default function useKeyboardTeamNavigation({
  onPrevious,
  onNext,
  enabled = true,
}) {
  useEffect(() => {
    if (!enabled || typeof onPrevious !== "function" || typeof onNext !== "function") {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (shouldIgnoreTeamNavigation(event)) return;

      const previous = event.key === "ArrowLeft" || event.key === "a" || event.key === "A";
      const next = event.key === "ArrowRight" || event.key === "d" || event.key === "D";
      if (!previous && !next) return;

      event.preventDefault();
      if (previous) onPrevious();
      else onNext();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onNext, onPrevious]);
}
