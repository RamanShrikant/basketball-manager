import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext.jsx";
import {
  DEFAULT_TRADE_RULE_SETTINGS,
  TRADE_RULE_DEFINITIONS,
  ensureTradeRuleSettings,
  normalizeTradeRuleSettings,
} from "../utils/tradeRuleSettings.js";
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

  const enabledCount = countEnabled(tradeRules);

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
            Year-round league options. These rules control Propose Trade and Trade Finder for the user;
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
          <div className={styles.summaryActions}>
            <button type="button" onClick={() => setAll(true)}>Turn All On</button>
            <button type="button" onClick={() => setAll(false)}>Turn All Off</button>
          </div>
        </div>

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
