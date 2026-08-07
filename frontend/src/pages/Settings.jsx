import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext.jsx";
import {
  DEFAULT_TRADE_RULE_SETTINGS,
  TRADE_RULE_DEFINITIONS,
  ensureTradeRuleSettings,
  normalizeTradeRuleSettings,
} from "../utils/tradeRuleSettings.js";
import {
  clearAllInjuries,
  normalizeInjurySettings,
} from "../utils/injurySystem.js";
import { readLeagueClock } from "../utils/leagueClock.js";
import styles from "./Settings.module.css";

function countEnabled(settings = {}) {
  return TRADE_RULE_DEFINITIONS.reduce((total, rule) => total + (settings?.[rule.key] !== false ? 1 : 0), 0);
}

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`${styles.switch} ${checked ? styles.switchOn : styles.switchOff}`}
      onClick={onChange}
    >
      <span className={styles.switchKnob} />
      <span className={styles.switchText}>{checked ? "ON" : "OFF"}</span>
    </button>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const location = useLocation();
  const { leagueData, setLeagueData, selectedTeam } = useGame();
  const [activeHelpRule, setActiveHelpRule] = useState(null);
  const [activeHelpOption, setActiveHelpOption] = useState(null);

  useEffect(() => {
    if (!leagueData) return;
    const normalized = ensureTradeRuleSettings(leagueData);
    const before = JSON.stringify(leagueData?.settings?.tradeRules || null);
    const after = JSON.stringify(normalized?.settings?.tradeRules || null);
    if (before !== after) setLeagueData(normalized);
  }, [leagueData, setLeagueData]);

  const tradeRules = useMemo(() => {
    return normalizeTradeRuleSettings(leagueData?.settings?.tradeRules || DEFAULT_TRADE_RULE_SETTINGS);
  }, [leagueData?.settings?.tradeRules]);

  const injurySettings = useMemo(() => {
    return normalizeInjurySettings(leagueData?.settings?.injuries);
  }, [leagueData?.settings?.injuries]);

  const enabledCount = countEnabled(tradeRules);

  const updateInjuryOption = (key, value) => {
    if (!leagueData) return;
    const normalizedSettings = normalizeInjurySettings(leagueData?.settings?.injuries);
    const nextLeague = structuredClone(leagueData);
    nextLeague.settings = { ...(nextLeague.settings || {}) };

    if (key === "enabled" && value === false) {
      const clockDate = readLeagueClock()?.date || null;
      const cleared = clearAllInjuries(nextLeague, clockDate);
      nextLeague.settings.injuries = {
        ...normalizeInjurySettings(cleared.leagueData?.settings?.injuries),
        enabled: false,
      };
      setLeagueData(nextLeague);
      return;
    }

    nextLeague.settings.injuries = {
      ...normalizedSettings,
      [key]: Boolean(value),
    };
    setLeagueData(nextLeague);
  };

  const updateRule = (key, value) => {
    if (!leagueData) return;
    const normalized = ensureTradeRuleSettings(leagueData);
    const nextRules = normalizeTradeRuleSettings(normalized?.settings?.tradeRules);
    nextRules[key] = Boolean(value);

    setLeagueData({
      ...normalized,
      settings: {
        ...(normalized.settings || {}),
        tradeRules: nextRules,
      },
    });
  };

  const setAll = (value) => {
    if (!leagueData) return;
    const normalized = ensureTradeRuleSettings(leagueData);
    const nextRules = { ...DEFAULT_TRADE_RULE_SETTINGS };
    for (const rule of TRADE_RULE_DEFINITIONS) nextRules[rule.key] = Boolean(value);

    setLeagueData({
      ...normalized,
      settings: {
        ...(normalized.settings || {}),
        tradeRules: nextRules,
      },
    });
  };

  const returnToHub = () => {
    navigate("/team-hub", {
      state: location.state && typeof location.state === "object" ? location.state : undefined,
    });
  };

  return (
    <div className={`${styles.page} bmCourtPage`}>
      <div className={styles.shell}>
        <div className={styles.headerBlock}>
          <div className={styles.kicker}>Basketball Manager</div>
          <h1>Settings</h1>
          <p>
            Year-round league options for trades, injuries, alerts, and user-facing league rules.
            CPU-to-CPU trades and mega trades keep their existing logic.
          </p>
        </div>

        <div className={styles.summaryRow}>
          <div className={styles.summaryCard}>
            <span>Controlled Team</span>
            <strong>{selectedTeam?.name || "No team selected"}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span>Trade Rules</span>
            <strong>{enabledCount}/{TRADE_RULE_DEFINITIONS.length} ON</strong>
          </div>
          <div className={styles.summaryCard}>
            <span>Injuries</span>
            <strong>{injurySettings.enabled ? "ON" : "OFF"}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span>Alerts</span>
            <strong>{injurySettings.userAlerts ? "ON" : "OFF"}</strong>
          </div>
          <div className={styles.summaryActions}>
            <button type="button" onClick={() => setAll(true)}>Trade Rules On</button>
            <button type="button" onClick={() => setAll(false)}>Trade Rules Off</button>
          </div>
        </div>

        <section className={`${styles.panel} ${styles.optionsPanel}`}>
          <div className={styles.panelHeader}>
            <div>
              <div className={styles.panelKicker}>League Options</div>
              <h2>Injuries and Alerts</h2>
            </div>
            <div className={styles.panelNote}>Saved in this league file</div>
          </div>

          <div className={styles.optionList}>
            <article className={`${styles.ruleRow} ${injurySettings.enabled ? styles.ruleOn : styles.ruleOff}`}>
              <div className={styles.ruleTextBlock}>
                <div className={styles.ruleLabel}>Injuries</div>
                <div className={styles.ruleStatus}>
                  {injurySettings.enabled
                    ? "Enabled • minute-based odds • max 4 active per team"
                    : "Disabled • all active injuries cleared"}
                </div>
              </div>
              <div className={styles.ruleControls}>
                <button
                  type="button"
                  className={styles.helpButton}
                  title="Read injury setting description"
                  aria-label="Read injury setting description"
                  onClick={() => setActiveHelpOption({
                    title: "Injuries",
                    kicker: "League Option",
                    description: "When enabled, players can get injured after games using their actual box-score minutes. A team can never have more than 4 active injuries. Turning this OFF immediately clears every player injury in the league and rebuilds affected rotations.",
                  })}
                >
                  ?
                </button>
                <ToggleSwitch
                  checked={injurySettings.enabled}
                  label="Toggle Injuries"
                  onChange={() => updateInjuryOption("enabled", !injurySettings.enabled)}
                />
              </div>
            </article>

            <article className={`${styles.ruleRow} ${injurySettings.userAlerts ? styles.ruleOn : styles.ruleOff}`}>
              <div className={styles.ruleTextBlock}>
                <div className={styles.ruleLabel}>User Injury Alerts</div>
                <div className={styles.ruleStatus}>
                  {injurySettings.userAlerts
                    ? "Enabled • pause when your team is injured or returns"
                    : "Disabled • rotations auto-rebuild silently"}
                </div>
              </div>
              <div className={styles.ruleControls}>
                <button
                  type="button"
                  className={styles.helpButton}
                  title="Read injury alert description"
                  aria-label="Read injury alert description"
                  onClick={() => setActiveHelpOption({
                    title: "User Injury Alerts",
                    kicker: "League Option",
                    description: "When enabled, regular-season simulation pauses if your controlled team has an injury or a player returns. You can open Coach Gameplan to adjust manually or keep the CPU auto-rebuilt rotation.",
                  })}
                >
                  ?
                </button>
                <ToggleSwitch
                  checked={injurySettings.userAlerts}
                  label="Toggle User Injury Alerts"
                  onChange={() => updateInjuryOption("userAlerts", !injurySettings.userAlerts)}
                />
              </div>
            </article>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <div className={styles.panelKicker}>User Trade Rules</div>
              <h2>Trade Rules</h2>
            </div>
            <div className={styles.panelNote}>Saved in this league file</div>
          </div>

          <div className={styles.ruleList}>
            {TRADE_RULE_DEFINITIONS.map((rule) => {
              const enabled = tradeRules?.[rule.key] !== false;

              return (
                <article key={rule.key} className={`${styles.ruleRow} ${enabled ? styles.ruleOn : styles.ruleOff}`}>
                  <div className={styles.ruleTextBlock}>
                    <div className={styles.ruleLabel}>{rule.label}</div>
                    <div className={styles.ruleStatus}>{enabled ? "Enabled" : "Disabled"}</div>
                  </div>

                  <div className={styles.ruleControls}>
                    <button
                      type="button"
                      className={styles.helpButton}
                      title={`Read ${rule.label} description`}
                      aria-label={`Read ${rule.label} description`}
                      onClick={() => setActiveHelpRule(rule)}
                    >
                      ?
                    </button>
                    <ToggleSwitch
                      checked={enabled}
                      label={`Toggle ${rule.label}`}
                      onChange={() => updateRule(rule.key, !enabled)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {activeHelpOption && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActiveHelpOption(null);
          }}
        >
          <div className={styles.helpModal} role="dialog" aria-modal="true" aria-labelledby="settings-option-help-title">
            <button
              type="button"
              className={styles.modalClose}
              aria-label="Close option description"
              onClick={() => setActiveHelpOption(null)}
            >
              ×
            </button>
            <div className={styles.modalKicker}>{activeHelpOption.kicker || "League Option"}</div>
            <h2 id="settings-option-help-title">{activeHelpOption.title}</h2>
            <p>{activeHelpOption.description}</p>
            <button type="button" className={styles.modalDone} onClick={() => setActiveHelpOption(null)}>
              Got it
            </button>
          </div>
        </div>
      )}

      {activeHelpRule && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActiveHelpRule(null);
          }}
        >
          <div className={styles.helpModal} role="dialog" aria-modal="true" aria-labelledby="settings-rule-help-title">
            <button
              type="button"
              className={styles.modalClose}
              aria-label="Close rule description"
              onClick={() => setActiveHelpRule(null)}
            >
              ×
            </button>
            <div className={styles.modalKicker}>Trade Rule</div>
            <h2 id="settings-rule-help-title">{activeHelpRule.label}</h2>
            <p>{activeHelpRule.description}</p>
            <button type="button" className={styles.modalDone} onClick={() => setActiveHelpRule(null)}>
              Got it
            </button>
          </div>
        </div>
      )}

      <button type="button" className={styles.backButton} onClick={returnToHub}>
        <span aria-hidden="true">←</span>
        <span>Team Hub</span>
      </button>
    </div>
  );
}
