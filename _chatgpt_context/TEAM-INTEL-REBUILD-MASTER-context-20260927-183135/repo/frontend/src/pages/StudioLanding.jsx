import React from "react";
import { Link } from "react-router-dom";
import samsaraSymbol from "../assets/samsara-studios-symbol.png";
import basketballCardIcon from "../assets/game-card-basketball-reference.webp";
import gloveCardIcon from "../assets/game-card-mma-gloves-reference.webp";
import styles from "./StudioLanding.module.css";

const FEEDBACK_EMAIL = "samsarastudios.games@gmail.com";
const FEEDBACK_FORM_URL = "https://forms.gle/replace-with-samsara-studios-feedback-form";

function GameCardArtwork({ src, className, alt = "" }) {
  return (
    <span className={`${styles.cardArtwork} ${className}`} aria-hidden="true">
      <img src={src} alt={alt} draggable="false" />
    </span>
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
              <GameCardArtwork
                src={basketballCardIcon}
                className={styles.basketballArtwork}
              />
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
              <GameCardArtwork
                src={gloveCardIcon}
                className={styles.fightArtwork}
              />
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
