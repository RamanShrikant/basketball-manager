export const DEV_TOOLS_SETTING_KEY = "devToolsEnabled";

// Existing saves predate the league-level setting and historically exposed the
// developer controls. Preserve that behavior for backwards compatibility.
export function areDevToolsEnabled(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return false;

  const setting = leagueData?.settings?.[DEV_TOOLS_SETTING_KEY];
  if (typeof setting === "boolean") return setting;

  // Tolerate an older/top-level experimental field if one ever appears in an
  // imported save, but keep the canonical value under leagueData.settings.
  if (typeof leagueData?.[DEV_TOOLS_SETTING_KEY] === "boolean") {
    return leagueData[DEV_TOOLS_SETTING_KEY];
  }

  return true;
}

export function withDevToolsEnabled(leagueData, enabled) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;
  return {
    ...leagueData,
    settings: {
      ...(leagueData.settings || {}),
      [DEV_TOOLS_SETTING_KEY]: Boolean(enabled),
    },
  };
}
