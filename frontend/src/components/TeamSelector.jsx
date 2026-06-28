import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../context/GameContext";
import styles from "./TeamSelector.module.css";

const NBA_LOGO_SRC = "/nba_PNG20.png";

function getTeamsFromLeague(leagueData) {
  if (!leagueData) return [];

  const teams = Array.isArray(leagueData.teams)
    ? leagueData.teams
    : [
        ...(leagueData.conferences?.East || []),
        ...(leagueData.conferences?.West || []),
      ];

  return teams
    .filter((team) => team?.name)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export default function TeamSelector() {
  const { leagueData, setSelectedTeam } = useGame();
  const navigate = useNavigate();
  const [activeSlot, setActiveSlot] = useState(0);

  const allTeams = useMemo(() => getTeamsFromLeague(leagueData), [leagueData]);
  const cycleSize = allTeams.length + 1;

  const normalizeSlot = useCallback(
    (slot) => {
      if (cycleSize <= 1) return 0;
      return ((slot % cycleSize) + cycleSize) % cycleSize;
    },
    [cycleSize]
  );

  const moveCarousel = useCallback(
    (dir) => {
      if (cycleSize <= 1) return;
      setActiveSlot((prev) => normalizeSlot(prev + dir));
    },
    [cycleSize, normalizeSlot]
  );

  const activeTeam = activeSlot > 0 ? allTeams[activeSlot - 1] || null : null;

  const handleAdvance = useCallback(() => {
    if (!activeTeam) return;
    setSelectedTeam(activeTeam);
    navigate("/team-hub");
  }, [activeTeam, navigate, setSelectedTeam]);

  useEffect(() => {
    const handleKey = (e) => {
      const key = String(e.key || "").toLowerCase();

      if (key === "arrowright" || key === "d") {
        e.preventDefault();
        moveCarousel(1);
        return;
      }

      if (key === "arrowleft" || key === "a") {
        e.preventDefault();
        moveCarousel(-1);
        return;
      }

      if (key === "enter") {
        e.preventDefault();
        handleAdvance();
      }
    };

    const handleRightClick = (e) => {
      e.preventDefault();
      setActiveSlot(0);
    };

    window.addEventListener("keydown", handleKey);
    window.addEventListener("contextmenu", handleRightClick);
    document.body.classList.add("ts-no-scroll");

    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("contextmenu", handleRightClick);
      document.body.classList.remove("ts-no-scroll");
    };
  }, [handleAdvance, moveCarousel]);

  if (!leagueData) {
    return (
      <div className={styles.wrapper}>
        <p>No league loaded.</p>
        <button onClick={() => navigate("/play")}>Go Back</button>
      </div>
    );
  }

  const getSlotItem = (slot) => {
    const normalized = normalizeSlot(slot);

    if (normalized === 0) {
      return {
        key: "select-placeholder",
        isPlaceholder: true,
        name: "Select Your Team",
        logo: NBA_LOGO_SRC,
        slot: normalized,
      };
    }

    const team = allTeams[normalized - 1];
    return {
      key: team?.name || `team-${normalized}`,
      isPlaceholder: false,
      name: team?.name || "Team",
      logo: team?.logo || "",
      team,
      slot: normalized,
    };
  };

  const visibleCards = [-2, -1, 0, 1, 2].map((offset) => ({
    ...getSlotItem(activeSlot + offset),
    offset,
  }));

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.title}>Select Your Team</h1>

      <div className={styles.carouselShell} aria-label="Team carousel">
        <button
          type="button"
          onClick={() => moveCarousel(-1)}
          disabled={cycleSize <= 1}
          className={`${styles.navArrow} ${styles.navArrowLeft}`}
          title="Previous team"
          aria-label="Previous team"
        >
          ◄
        </button>

        <div className={styles.carouselTrack}>
          {visibleCards.map((item, index) => (
            <button
              type="button"
              key={`${item.key}-${item.offset}-${index}`}
              onClick={() => {
                if (item.offset !== 0) setActiveSlot(item.slot);
              }}
              disabled={item.offset === 0 && item.isPlaceholder}
              className={`${styles.card} ${
                item.offset === 0 ? styles.centerCard : styles.sideCard
              } ${item.isPlaceholder ? styles.placeholderCard : ""} ${
                activeTeam?.name === item.name && item.offset === 0 ? styles.selected : ""
              }`}
              data-offset={item.offset}
              title={item.isPlaceholder ? "Pick a team with the arrows" : item.name}
            >
              <img
                src={item.logo}
                alt={item.isPlaceholder ? "NBA logo" : item.name}
                className={item.isPlaceholder ? styles.nbaLogo : styles.logo}
              />
              <h2 className={item.isPlaceholder ? styles.placeholderName : styles.name}>
                {item.name}
              </h2>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => moveCarousel(1)}
          disabled={cycleSize <= 1}
          className={`${styles.navArrow} ${styles.navArrowRight}`}
          title="Next team"
          aria-label="Next team"
        >
          ►
        </button>
      </div>

      <div className={styles.controlsBar}>
        <div>← / A: PREV &nbsp;&nbsp; → / D: NEXT &nbsp;&nbsp; ENTER: ADVANCE &nbsp;&nbsp; R-CLICK: RESET</div>
        <button
          onClick={handleAdvance}
          disabled={!activeTeam}
          className={`${styles.advanceBtn} ${activeTeam ? styles.active : ""}`}
        >
          Advance
        </button>
      </div>
    </div>
  );
}
