import React from "react";
import { Link } from "react-router-dom";
import samsaraSymbol from "../assets/samsara-studios-symbol.png";
import styles from "./StudioLanding.module.css";

const FEEDBACK_EMAIL = "samsarastudios.feedback@gmail.com";
const FEEDBACK_FORM_URL = "https://forms.gle/replace-with-samsara-studios-feedback-form";


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
              Notice a bug, something that feels off, a roster issue, a balance problem, or an idea that would
              make the game better? Send it by email or use the feedback form.
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
