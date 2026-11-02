import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const original=read("src/components/TeamSelector.jsx");
const selector=read("src/online/OnlineTeamCarousel.jsx");
const lobby=read("src/online/OnlineLobby.jsx");
const sounds=read("src/online/useOnlineGameSounds.js");
const home=read("src/online/OnlineHome.jsx");
const app=read("src/online/OnlineApp.jsx");
const css=read("src/online/online.css");
assert(selector.includes('import styles from "../components/TeamSelector.module.css"'));
assert(selector.includes('import { playSound, SOUND_KEYS } from "../audio/soundManager.js"'));
for (const exact of [
 'className={styles.wrapper}', 'className={styles.title}', 'className={styles.carouselShell}',
 'className={styles.carouselTrack}', 'className={styles.controlsBar}',
 'styles.navArrowLeft', 'styles.navArrowRight','styles.centerCard','styles.sideCard',
 'styles.placeholderCard', 'styles.selected', 'styles.nbaLogo', 'styles.logo',
 'styles.advanceBtn','styles.active','data-offset={item.offset}',
 'R-CLICK: RESET','Select Your Team', 'visibleCards',
]) assert(selector.includes(exact),`Missing exact TeamSelector markup: ${exact}`);
for (const key of ["TEAM_SELECTOR_CYCLE","TEAM_SELECTION_ADVANCE"]) assert(selector.includes(`SOUND_KEYS.${key}`),`Missing original sound key ${key}`);
assert(lobby.includes('bm_set_online_team'), 'team choices must be sent to Supabase');
assert(lobby.includes('bm_set_online_ready'), 'ready status must be sent to Supabase');
assert(lobby.includes('bm_cancel_online_lobby_invite'),'host invites must be cancellable');
assert(lobby.includes('bm_leave_online_lobby'),'lobby exit must stay functional');
assert(lobby.includes('className="on-real-lobby-code"'), 'lobby code moved into the sidebar');
assert(lobby.includes('aria-label={lobbyVisible?"Hide lobby":"Show lobby"}'),'lobby panel can be hidden/shown');
assert(lobby.includes('aria-expanded={lobbyVisible}'),'toggle is accessible');
assert(lobby.includes('inert={!lobbyVisible}'),'hidden lobby cannot receive keyboard focus');
assert(lobby.includes('launchSharedFranchise(lobby)')&&lobby.includes('!isHost||!allReady'),'launch is guarded and shared gameplay remains read-only');
assert(css.includes('Exact TeamSelector.module.css UI'), 'online-only layout CSS exists');
assert(sounds.includes('from "../audio/soundManager.js"'),'Online controls use real sound manager');
assert(sounds.includes('SOUND_KEYS.UI_BACK_CANCEL'),'back/cancel uses game sound');
assert(sounds.includes('SOUND_KEYS.SIDEBAR_NAVIGATION'),'general navigation uses game sound');
assert(!sounds.includes('AudioContext')&&!sounds.includes('createOscillator'),'no invented oscillator sounds');
assert(app.includes('useOnlineGameSounds();'),'game sounds initialized once at Online app level');
assert(!home.includes('useOnlineUiSfx')&&!lobby.includes('useOnlineUiSfx'),'old beeps no longer used by pages');
assert(!/from\s+["'].*GameContext/.test(selector)&&!/from\s+["'].*GameContext/.test(lobby),'Online cannot import single-player GameContext');
assert(!/navigate\(["']\/team-hub/.test(selector),'Online selection must not navigate to a singleplayer franchise');
assert(!existsSync(new URL('../src/online/useOnlineUiSfx.js',import.meta.url)),'old synthesized SFX hook should be removed');
assert(original.includes('export default function TeamSelector()'),'original single-player selector remains intact');
console.log('PASS: original TeamSelector visual classes and controls, togglable lobby, authentic game SFX, and isolated Supabase mutations');
