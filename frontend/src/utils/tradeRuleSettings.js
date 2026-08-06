export const TRADE_RULE_SETTING_KEY = "tradeRules";

export const TRADE_RULE_DEFINITIONS = [
  {
    key: "tradeDeadline",
    label: "Trade Deadline",
    shortLabel: "Deadline",
    description: "Trades are allowed until the trade deadline; after the deadline date, trades are blocked until the offseason.",
  },
  {
    key: "salaryMatching",
    label: "Salary Matching",
    shortLabel: "Salary",
    description: "A team over the salary cap must send out enough salary to legally match the salary it receives.",
  },
  {
    key: "firstApron",
    label: "1st Apron Rule",
    shortLabel: "1st Apron",
    description: "A team at or above the first apron cannot receive more salary than it sends out.",
  },
  {
    key: "secondApron",
    label: "2nd Apron Rule",
    shortLabel: "2nd Apron",
    description: "A team at or above the second apron cannot receive more salary, cannot aggregate multiple outgoing players into one larger incoming salary, and cannot trade its furthest fully unprotected future 1st.",
  },
  {
    key: "hardCapApronCeiling",
    label: "Hard Cap / Apron Ceiling",
    shortLabel: "Hard Cap",
    description: "A trade is blocked if it pushes a team above the hard cap or apron ceiling.",
  },
  {
    key: "stepienRule",
    label: "Stepien Rule",
    shortLabel: "Stepien",
    description: "A team cannot trade future 1sts if, after the trade, it is not guaranteed to have at least one 1st-round pick in any two back-to-back future drafts.",
  },
  {
    key: "recentlyAcquired",
    label: "Recently Acquired Player Restriction",
    shortLabel: "Acquired",
    description: "A player acquired by trade cannot be traded again until 30 calendar days after the acquisition date.",
  },
  {
    key: "recentlySigned",
    label: "Recently Signed Free Agent Restriction",
    shortLabel: "Signed",
    description: "An offseason free-agent signing cannot be traded until December 15; an in-season free-agent signing cannot be traded until 30 days after signing.",
  },
  {
    key: "newlyDraftedRookie",
    label: "Newly Drafted Rookie Restriction",
    shortLabel: "Rookie",
    description: "A newly drafted rookie signed during Rookie Signings cannot be traded until July 30 of that offseason.",
  },
  {
    key: "recentlyExtended",
    label: "Recently Extended Player Restriction",
    shortLabel: "Extended",
    description: "A player who signs a contract extension cannot be traded until six calendar months after the extension date.",
  },
];

export const DEFAULT_TRADE_RULE_SETTINGS = TRADE_RULE_DEFINITIONS.reduce((acc, rule) => {
  acc[rule.key] = true;
  return acc;
}, {});

export function normalizeTradeRuleSettings(settings = {}) {
  const incoming = settings && typeof settings === "object" ? settings : {};
  const normalized = { ...DEFAULT_TRADE_RULE_SETTINGS };

  for (const rule of TRADE_RULE_DEFINITIONS) {
    if (Object.prototype.hasOwnProperty.call(incoming, rule.key)) {
      normalized[rule.key] = incoming[rule.key] !== false;
    }
  }

  return normalized;
}

export function ensureTradeRuleSettings(leagueData) {
  if (!leagueData || typeof leagueData !== "object") return leagueData;

  const existingSettings = leagueData.settings && typeof leagueData.settings === "object"
    ? leagueData.settings
    : {};

  return {
    ...leagueData,
    settings: {
      ...existingSettings,
      [TRADE_RULE_SETTING_KEY]: normalizeTradeRuleSettings(existingSettings[TRADE_RULE_SETTING_KEY]),
    },
  };
}
