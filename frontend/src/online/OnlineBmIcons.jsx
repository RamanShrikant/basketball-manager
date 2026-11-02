import React from "react";
import styles from "../components/TeamHubSidebar.module.css";

export function SidebarIcon({ type = "dot" }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  switch (type) {
    case "home":
      return <svg {...common}><path d="M3.5 10.8 12 3.8l8.5 7" /><path d="M5.5 9.7V20h13V9.7" /><path d="M9.3 20v-6.2h5.4V20" /></svg>;
    case "users":
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-3.1 2.4-5 5.5-5s5 1.9 5.5 5" /><path d="M15.5 6.2a2.7 2.7 0 0 1 0 5.2" /><path d="M16.5 14.1c2.3.5 3.7 2.1 4 4.4" /></svg>;
    case "clipboard":
      return <svg {...common}><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3h6v1.5" /><path d="M8.5 10h7M8.5 14h7M8.5 18h4.5" /></svg>;
    case "swap":
      return <svg {...common}><path d="M4 7h13" /><path d="m14 4 3 3-3 3" /><path d="M20 17H7" /><path d="m10 14-3 3 3 3" /></svg>;
    case "userSearch":
      return <svg {...common}><circle cx="9" cy="8" r="3.2" /><path d="M3.8 18.5c.5-3.1 2.2-4.8 5.2-4.8 1.8 0 3.2.6 4.1 1.7" /><circle cx="16.8" cy="16.8" r="3.1" /><path d="m19.1 19.1 2 2" /></svg>;
    case "ticket":
      return <svg {...common}><path d="M4 7.2h16v3a2 2 0 0 0 0 3.6v3H4v-3a2 2 0 0 0 0-3.6z" /><path d="M12 8.8v6.4" /></svg>;
    case "wallet":
      return <svg {...common}><path d="M4 6.5h14.5A1.5 1.5 0 0 1 20 8v9.5H5.5A1.5 1.5 0 0 1 4 16z" /><path d="M4 8.5V6a2 2 0 0 1 2-2h10" /><path d="M15.5 11h4.5v3.5h-4.5a1.75 1.75 0 1 1 0-3.5Z" /></svg>;
    case "file":
      return <svg {...common}><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4" /><path d="M9 12h6M9 15.5h6" /></svg>;
    case "calendar":
      return <svg {...common}><rect x="3.5" y="5.2" width="17" height="15" rx="2" /><path d="M7.5 3v4.2M16.5 3v4.2M3.5 9h17" /><path d="M7.5 12.5h2M12 12.5h2M16.5 12.5h.1M7.5 16.5h2M12 16.5h2" /></svg>;
    case "standings":
      return <svg {...common}><path d="M4 20V12h4v8M10 20V7h4v13M16 20V4h4v16" /><path d="M3 20.5h18" /></svg>;
    case "bracket":
      return <svg {...common}><path d="M5 4v5h5M5 20v-5h5M19 7v10M10 9v6h5M15 12h4" /></svg>;
    case "trend":
      return <svg {...common}><path d="M4 18 9 13l3.5 3.5L20 8" /><path d="M15.5 8H20v4.5" /></svg>;
    case "chart":
      return <svg {...common}><path d="M5 20V11M10 20V6M15 20v-7M20 20V4" /><path d="M3 20.5h19" /></svg>;
    case "eye":
      return <svg {...common}><path d="M2.8 12s3.3-5.5 9.2-5.5S21.2 12 21.2 12 17.9 17.5 12 17.5 2.8 12 2.8 12Z" /><circle cx="12" cy="12" r="2.8" /></svg>;
    case "search":
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></svg>;
    case "award":
      return <svg {...common}><circle cx="12" cy="9" r="5" /><path d="m9 13-1.5 7 4.5-2 4.5 2-1.5-7" /></svg>;
    case "star":
      return <svg {...common}><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" /></svg>;
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></svg>;
    case "trophy":
      return <svg {...common}><path d="M8 4h8v4.5a4 4 0 0 1-8 0Z" /><path d="M8 6H4v1.5A4.5 4.5 0 0 0 8.5 12M16 6h4v1.5a4.5 4.5 0 0 1-4.5 4.5" /><path d="M12 12.5V17M8.5 20h7M10 17h4" /></svg>;
    case "crown":
      return <svg {...common}><path d="m4 8 4 4 4-7 4 7 4-4-2 10H6Z" /><path d="M6 18h12" /></svg>;
    case "edit":
      return <svg {...common}><path d="M5 19h4l10-10-4-4L5 15z" /><path d="m13.8 6.2 4 4M5 19l-.5-4" /></svg>;
    case "gear":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" /><circle cx="12" cy="12" r="7" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
  }
}

export function GroupChevron({ collapsed }) {
  return (
    <svg className={styles.groupChevron} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d={collapsed ? "M5.5 7.5 10 12l4.5-4.5" : "M5.5 12.5 10 8l4.5 4.5"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

