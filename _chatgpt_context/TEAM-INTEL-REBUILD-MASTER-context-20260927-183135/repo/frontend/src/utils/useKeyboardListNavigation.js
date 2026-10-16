import { useEffect } from "react";

function shouldIgnoreKeyboardNavigation(event) {
  const tag = String(event?.target?.tagName || "").toLowerCase();
  if (["input", "select", "textarea", "button"].includes(tag)) return true;
  if (event?.target?.isContentEditable) return true;
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  return false;
}

export default function useKeyboardListNavigation({
  items = [],
  selectedItem = null,
  onSelect,
  enabled = true,
  getKey = (item) => item?.id ?? item?.name,
  rowSelector = "[data-bm-nav-row-index]",
}) {
  useEffect(() => {
    if (!enabled || typeof onSelect !== "function" || !Array.isArray(items) || !items.length) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (shouldIgnoreKeyboardNavigation(event)) return;

      const down = event.key === "ArrowDown" || event.key === "s" || event.key === "S";
      const up = event.key === "ArrowUp" || event.key === "w" || event.key === "W";
      if (!down && !up) return;

      event.preventDefault();

      const selectedKey = getKey(selectedItem);
      let currentIndex = items.findIndex((item) => getKey(item) === selectedKey);
      if (currentIndex < 0) currentIndex = 0;

      const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + (down ? 1 : -1)));
      const nextItem = items[nextIndex];
      if (!nextItem) return;

      onSelect(nextItem, nextIndex);

      requestAnimationFrame(() => {
        const rows = document.querySelectorAll(rowSelector);
        const row = Array.from(rows).find(
          (node) => Number(node.getAttribute("data-bm-nav-row-index")) === nextIndex
        );
        row?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, getKey, items, onSelect, rowSelector, selectedItem]);
}
