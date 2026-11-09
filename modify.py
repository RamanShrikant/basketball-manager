from pathlib import Path
root=Path('/mnt/data/bm_team_needs_mirror/frontend')
p=root/'src/pages/Intel_v1.jsx'
s=p.read_text()
a='function MiniPlayer({ row, liveTeams, team, onInspect, source = false, panelTitle = "Scouting" }) {\n  const teamName = source ? (row.sourceTeam || row.sourceTeamName || row.teamName) : team.name;\n  return <button type="button" className="bm-il-mini-player" style={leagueIntelTuningVars("scoutingRows")} onClick={onInspect} title="Explain why this item is listed" aria-label={`Explain why ${row.name || "this asset"} is shown under ${panelTitle}`}>\n    {row.assetKind === "pick" ? <span className="bm-il-pick-icon">{Number(row.round) === 2 ? "R2" : "R1"}</span> : <><Portrait row={row} liveTeams={liveTeams} size="mini" sourceTeam={teamName} /><OverallRing rating={row.overall} potential={row.potential} /></>}\n'
b='function MiniPlayer({ row, liveTeams, team, onInspect, source = false, panelTitle = "Scouting", section = "scoutingRows", portraitTeamName = "", needsPlayer = false }) {\n  const teamName = portraitTeamName || (source ? (row.sourceTeam || row.sourceTeamName || row.teamName) : team.name);\n  return <button type="button" className={`bm-il-mini-player${needsPlayer ? " bm-il-need--split bm-il-need-player-mirror" : ""}`} style={leagueIntelTuningVars(section)} onClick={onInspect} title="Explain why this item is listed" aria-label={`Explain why ${row.name || "this asset"} is shown under ${panelTitle}`}>\n    {row.assetKind === "pick" ? <span className="bm-il-pick-icon">{Number(row.round) === 2 ? "R2" : "R1"}</span> : <><Portrait row={row} liveTeams={liveTeams} size="mini" sourceTeam={teamName} /><OverallRing rating={row.overall} potential={row.potential} section={section} /></>}\n'
assert a in s
s=s.replace(a,b,1)
a='''              {playerNeeds.length ? playerNeeds.map((need, index) => (
                <button type="button" className="bm-il-need bm-il-need--player bm-il-need--split"
                  style={leagueIntelTuningVars("teamNeeds")}
                  key={need.id || need.name || index} title="Inspect existing CPU evidence"
                  onClick={() => inspect("Team Needs: Players", "needs", need)}>
                  <span className="bm-il-need-player-visual">
                    <Portrait row={need} liveTeams={liveTeams} size="mini" sourceTeam={userTeamName} />
                    <OverallRing rating={need.overall} potential={need.potential} section="teamNeeds" />
                  </span>
                  <span className="bm-il-need-copy">
                    <strong>{need.name || need.label}</strong>
                    {(need.pos || need.age != null) && <small className="bm-il-need-metadata">
                      {need.pos && <span className="bm-il-player-position">{need.pos}</span>}
                      {need.pos && need.age != null && " · "}
                      {need.age != null && <span className="bm-il-player-age">Age {formatAge(need.age)}</span>}
                    </small>}
                  </span>
                </button>
              )) : <div className="bm-il-empty">No valued players from your roster identified. This does not mean the CPU would reject every player.</div>}
'''
b='''              {playerNeeds.length ? playerNeeds.map((need, index) => (
                <MiniPlayer
                  key={need.id || need.name || index}
                  row={need}
                  liveTeams={liveTeams}
                  team={active}
                  section="teamNeedsPlayers"
                  portraitTeamName={userTeamName}
                  needsPlayer
                  panelTitle="Team Needs: Players"
                  onInspect={() => inspect("Team Needs: Players", "needs", need)}
                />
              )) : <div className="bm-il-empty">No valued players from your roster identified. This does not mean the CPU would reject every player.</div>}
'''
assert a in s
s=s.replace(a,b,1)
p.write_text(s)

p=root/'src/config/leagueIntelLayout.js'
s=p.read_text()
s=s.replace('SECTIONS BELOW (independent): starters, scoutingRows, teamNeeds,\n * expiringDeals, fullRoster.', 'SECTIONS BELOW (independent): starters, scoutingRows, teamNeedsPlayers,\n * teamNeeds (draft picks), expiringDeals, fullRoster.\n * Team Needs PLAYERS mirrors the scouting-row component with its own copied\n * controls. The original teamNeeds settings remain for PICKS unchanged.')
a='''  // ============= 3. TEAM NEEDS =============
  teamNeeds: {
    headshot: { x: 0, y: 0, scale: 1, borderWidth: 0 },
    name:     { x: 0, y: 0, scale: 1 },
    ring:     { x: 0, y: 0, scale: 1, strokeWidth: 7 },
'''
b='''  // ============= 3A. TEAM NEEDS: PLAYERS =============
  // Exact visual preset copied from scoutingRows. Changes to these values
  // affect ONLY your two Team Needs player rows, never Protected/Available/Targets.
  teamNeedsPlayers: {
    headshot: { x: 20, y: 10, scale: 1.7, borderWidth: 0 },
    name:     { x: 40, y: 0, scale: 1 },
    ring:     { x: 25, y: -5, scale: 1.1, strokeWidth: 7 },
    ringText: { x: 0, y: 0, scale: 0.8 },
    ringLabel: { x: 0, y: 0, scale: 1 },
    ringValue: { x: 0, y: 0, scale: 1 },
    ringPot: { x: 0, y: 0, scale: 1 },
    card:     { borderWidth: 1 },
    position: { x: 40, y: 0, scale: 1 },
    age:      { x: 40, y: 0, scale: 1 },
  },
  // ============= 3B. TEAM NEEDS: PICKS (original controls kept) =============
  teamNeeds: {
    headshot: { x: 0, y: 0, scale: 1.7, borderWidth: 0 },
    name:     { x: 30, y: 0, scale: 1 },
    ring:     { x: 30, y: 0, scale: 1, strokeWidth: 7 },
'''
assert a in s
s=s.replace(a,b,1)
# update user settings position/age
n=s.index('  // ============= 3B.')
pre=s[:n]; tail=s[n:]
old='    position: { x: 0, y: 0, scale: 1 }, // metadata position only\n    age:      { x: 0, y: 0, scale: 1 }, // metadata age only\n'
new='    position: { x: 30, y: 0, scale: 1 }, // metadata position only\n    age:      { x: 30, y: 0, scale: 1 }, // metadata age only\n'
assert old in tail
s=pre+tail.replace(old,new,1)
s=s.replace('  teamNeeds: 310,\n', '  teamNeedsPlayers: 310,\n  teamNeeds: 310,\n')
p.write_text(s)

p=root/'src/styles/BMLeagueIntel.css'
s=p.read_text()
s+='''

/* ========================================================================
   TEAM NEEDS PLAYERS — USE THE EXACT SAME MINI SCOUTING ROW COMPONENT
   Existing hand-tuned numbers live separately in teamNeedsPlayers; the
   Team Needs: Picks pill and origin-logo controls are not modified.
   ======================================================================== */
.bm-il-bottom-grid .bm-il-need-player-mirror {
  height: 100%;
  min-height: 0;
  width: 100%;
  padding: 4px 6px;
  overflow: hidden;
}
/* Unlike the old 8px metadata slot, the shared scouting text row has enough
   line box height for descending glyphs (e.g., the 'g' in 'Age'). */
.bm-il-bottom-grid .bm-il-need-player-mirror .bm-il-mini-text small {
  line-height: 1.45;
  min-height: 1.45em;
  padding-block: 1px;
}
.bm-il-bottom-grid .bm-il-need-player-mirror .bm-il-mini-text strong {
  line-height: 1.25;
}
'''
p.write_text(s)
print('modified',p)
