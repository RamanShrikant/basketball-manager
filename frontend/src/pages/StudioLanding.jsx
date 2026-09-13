import React from "react";
import { Link } from "react-router-dom";
import samsaraSymbol from "../assets/samsara-studios-symbol.png";
import styles from "./StudioLanding.module.css";

const FEEDBACK_EMAIL = "samsarastudios.games@gmail.com";
const FEEDBACK_FORM_URL = "https://forms.gle/replace-with-samsara-studios-feedback-form";

function BasketballCardIcon() {
  return (
    <svg className={`${styles.cardIcon} ${styles.basketballIcon}`} viewBox="0 0 240 240" aria-hidden="true" focusable="false">
      <circle className={styles.iconDisc} cx="120" cy="120" r="82" />
      <circle className={styles.iconLine} cx="120" cy="120" r="82" />
      <path className={styles.iconLine} d="M120 38c-27 31-27 133 0 164" />
      <path className={styles.iconLine} d="M120 38c27 31 27 133 0 164" />
      <path className={styles.iconLine} d="M46 96c44 24 104 24 148 0" />
      <path className={styles.iconLine} d="M46 144c44-24 104-24 148 0" />
    </svg>
  );
}

function GloveCardIcon() {
  return (
    <svg
      className={`${styles.cardIcon} ${styles.fightIcon}`}
      viewBox="0 0 270 230"
      aria-hidden="true"
      focusable="false"
    >
      <g className={styles.gloveRear} transform="translate(38 12) rotate(8 135 115)">
        <path className={styles.gloveShell} d="M92 28h50c38 0 69 31 69 69v34c0 36-29 65-65 65H82c-40 0-72-32-72-72v-24c0-40 32-72 72-72h10Z" />
        <path className={styles.gloveThumb} d="M51 109c-24 1-43 21-43 47 0 27 22 49 49 49h47v-38c0-32-26-58-58-58h5Z" />
        <path className={styles.gloveCuff} d="M58 178h129c14 0 25 11 25 25v18H43v-28c0-8 7-15 15-15Z" />
      </g>

      <g className={styles.gloveFront} transform="translate(-4 8) rotate(-6 128 118)">
        <path className={styles.gloveShell} d="M91 25h54c40 0 72 32 72 72v34c0 38-31 69-69 69H81c-41 0-75-34-75-75v-25c0-41 34-75 75-75h10Z" />
        <path className={styles.gloveThumb} d="M49 109c-25 2-44 23-44 49 0 29 23 52 52 52h50v-41c0-33-27-60-60-60h2Z" />
        <path className={styles.gloveCuff} d="M58 181h139c15 0 27 12 27 27v17H42v-29c0-8 7-15 16-15Z" />
        <path className={styles.gloveCut} d="M85 36v66" />
        <path className={styles.gloveCut} d="M113 28v72" />
        <path className={styles.gloveCut} d="M142 34v66" />
        <path className={styles.gloveCut} d="M61 204h146" />
      </g>
    </svg>
  );
}

export default function StudioLanding() {
  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-label="Samsara Studios game launcher">
        <section className={styles.mainGrid}>
          <div className={styles.brandBlock}>
            <img className={styles.mark} src={samsaraSymbol} alt="Samsara Studios symbol" />
            <div className={styles.brandCopy}>
              <h1>Samsara Studios</h1>
              <p>
                An independently founded game studio focused on developing strategy and simulation games for
                the sports world.
              </p>
            </div>
          </div>

          <div className={styles.games} aria-label="Select game">
            <Link to="/league-editor" className={`${styles.gameCard} ${styles.availableGame}`}>
              <BasketballCardIcon />
              <span className={styles.statusText}>Available</span>
              <div className={styles.gameCardBody}>
                <div>
                  <h2>Basketball Manager</h2>
                  <p>
                    Take over as the GM of an NBA team, manage the roster, make trades and free-agent decisions,
                    build through the draft, and try to win a championship.
                  </p>
                </div>
                <span className={styles.actionPill}>Open Game</span>
              </div>
            </Link>

            <div className={`${styles.gameCard} ${styles.lockedGame}`} aria-disabled="true">
              <GloveCardIcon />
              <span className={styles.statusText}>Coming Soon</span>
              <div className={styles.gameCardBody}>
                <div>
                  <h2>UFC Manager <span>(Dana White Mode)</span></h2>
                </div>
                <span className={styles.actionPill}>Locked</span>
              </div>
            </div>
          </div>
        </section>

        <footer className={styles.feedbackBar} aria-label="Feedback">
          <div className={styles.feedbackCopy}>
            <span>Feedback</span>
            <p>
              Have feedback while playing? Bugs, roster fixes, balance issues, feature ideas, or anything that
              feels off are all helpful. Send a note by email or use the form.
            </p>
            <strong>{FEEDBACK_EMAIL}</strong>
          </div>
          <div className={styles.feedbackActions}>
            <a href={`mailto:${FEEDBACK_EMAIL}?subject=Samsara%20Studios%20Feedback`}>Email</a>
            <a href={FEEDBACK_FORM_URL} target="_blank" rel="noreferrer">
              Feedback Form
            </a>
          </div>
        </footer>
      </section>
    </main>
  );
}
