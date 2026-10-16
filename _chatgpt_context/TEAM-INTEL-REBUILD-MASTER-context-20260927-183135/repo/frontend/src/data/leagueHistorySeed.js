// Real-life NBA league-history seed data used by League History pages.
// Seasons are stored by end year: 2024-25 => seasonYear 2025.

export const LEAGUE_HISTORY_SEED_VERSION = "nba_real_history_through_2026_v2";
export const LEAGUE_HISTORY_SEED_THROUGH_SEASON_YEAR = 2026;

export const LEAGUE_HISTORY_AWARD_META = {
  mvp: {
    key: "mvp",
    label: "Most Valuable Player",
    shortLabel: "MVP",
    description: "The league's regular-season Most Valuable Player.",
  },
  dpoy: {
    key: "dpoy",
    label: "Defensive Player of the Year",
    shortLabel: "DPOY",
    description: "The league's top regular-season defensive player.",
  },
  sixth_man: {
    key: "sixth_man",
    label: "Sixth Man of the Year",
    shortLabel: "6MOY",
    description: "The league's best player in a bench role.",
  },
  mip: {
    key: "mip",
    label: "Most Improved Player",
    shortLabel: "MIP",
    description: "The strongest season-to-season breakout.",
  },
  clutch_player: {
    key: "clutch_player",
    label: "Clutch Player of the Year",
    shortLabel: "CPOTY",
    description: "The Jerry West Trophy for clutch regular-season performance.",
  },
  roty: {
    key: "roty",
    label: "Rookie of the Year",
    shortLabel: "ROTY",
    description: "The most outstanding rookie of the regular season.",
  },
};

export const LEAGUE_HISTORY_AWARD_ORDER = ["mvp", "dpoy", "sixth_man", "mip", "clutch_player", "roty"];

const AWARD_SOURCE_LABEL = "Real NBA";

function seasonLabelFromEndYear(endYear) {
  const y = Number(endYear);
  if (!Number.isFinite(y)) return "Season";
  return `${y - 1}-${String(y).slice(-2)}`;
}

function slug(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseAwardLines(key, lines) {
  const meta = LEAGUE_HISTORY_AWARD_META[key];
  return String(lines || "")
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [seasonYearRaw, player, team] = line.split("|").map((part) => part?.trim() || "");
      const seasonYear = Number(seasonYearRaw);
      return {
        id: `seed_${key}_${seasonYear}_${slug(player)}_${slug(team)}`,
        seasonYear,
        seasonLabel: seasonLabelFromEndYear(seasonYear),
        key,
        awardKey: key,
        label: meta.label,
        shortLabel: meta.shortLabel,
        player,
        playerName: player,
        team,
        source: "real_nba_seed",
        sourceLabel: AWARD_SOURCE_LABEL,
      };
    })
    .filter((row) => Number.isFinite(row.seasonYear) && row.player);
}

function parseChampionLines(lines) {
  return String(lines || "")
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [seasonYearRaw, championTeam, runnerUp, series, finalsMvp, finalsMvpTeam] = line.split("|").map((part) => part?.trim() || "");
      const seasonYear = Number(seasonYearRaw);
      return {
        id: `seed_champion_${seasonYear}_${slug(championTeam)}`,
        seasonYear,
        seasonLabel: seasonLabelFromEndYear(seasonYear),
        championTeam,
        runnerUp,
        series,
        finalsMvp: finalsMvp || null,
        finalsMvpTeam: finalsMvpTeam || null,
        source: "real_nba_seed",
        sourceLabel: AWARD_SOURCE_LABEL,
      };
    })
    .filter((row) => Number.isFinite(row.seasonYear) && row.championTeam);
}

const MVP_LINES = `
2026|Shai Gilgeous-Alexander|Oklahoma City Thunder
2025|Shai Gilgeous-Alexander|Oklahoma City Thunder
2024|Nikola Jokic|Denver Nuggets
2023|Joel Embiid|Philadelphia 76ers
2022|Nikola Jokic|Denver Nuggets
2021|Nikola Jokic|Denver Nuggets
2020|Giannis Antetokounmpo|Milwaukee Bucks
2019|Giannis Antetokounmpo|Milwaukee Bucks
2018|James Harden|Houston Rockets
2017|Russell Westbrook|Oklahoma City Thunder
2016|Stephen Curry|Golden State Warriors
2015|Stephen Curry|Golden State Warriors
2014|Kevin Durant|Oklahoma City Thunder
2013|LeBron James|Miami Heat
2012|LeBron James|Miami Heat
2011|Derrick Rose|Chicago Bulls
2010|LeBron James|Cleveland Cavaliers
2009|LeBron James|Cleveland Cavaliers
2008|Kobe Bryant|Los Angeles Lakers
2007|Dirk Nowitzki|Dallas Mavericks
2006|Steve Nash|Phoenix Suns
2005|Steve Nash|Phoenix Suns
2004|Kevin Garnett|Minnesota Timberwolves
2003|Tim Duncan|San Antonio Spurs
2002|Tim Duncan|San Antonio Spurs
2001|Allen Iverson|Philadelphia 76ers
2000|Shaquille O'Neal|Los Angeles Lakers
1999|Karl Malone|Utah Jazz
1998|Michael Jordan|Chicago Bulls
1997|Karl Malone|Utah Jazz
1996|Michael Jordan|Chicago Bulls
1995|David Robinson|San Antonio Spurs
1994|Hakeem Olajuwon|Houston Rockets
1993|Charles Barkley|Phoenix Suns
1992|Michael Jordan|Chicago Bulls
1991|Michael Jordan|Chicago Bulls
1990|Magic Johnson|Los Angeles Lakers
1989|Magic Johnson|Los Angeles Lakers
1988|Michael Jordan|Chicago Bulls
1987|Magic Johnson|Los Angeles Lakers
1986|Larry Bird|Boston Celtics
1985|Larry Bird|Boston Celtics
1984|Larry Bird|Boston Celtics
1983|Moses Malone|Philadelphia 76ers
1982|Moses Malone|Houston Rockets
1981|Julius Erving|Philadelphia 76ers
1980|Kareem Abdul-Jabbar|Los Angeles Lakers
1979|Moses Malone|Houston Rockets
1978|Bill Walton|Portland Trail Blazers
1977|Kareem Abdul-Jabbar|Los Angeles Lakers
1976|Kareem Abdul-Jabbar|Los Angeles Lakers
1975|Bob McAdoo|Buffalo Braves
1974|Kareem Abdul-Jabbar|Milwaukee Bucks
1973|Dave Cowens|Boston Celtics
1972|Kareem Abdul-Jabbar|Milwaukee Bucks
1971|Kareem Abdul-Jabbar|Milwaukee Bucks
1970|Willis Reed|New York Knicks
1969|Wes Unseld|Baltimore Bullets
1968|Wilt Chamberlain|Philadelphia 76ers
1967|Wilt Chamberlain|Philadelphia 76ers
1966|Wilt Chamberlain|Philadelphia 76ers
1965|Bill Russell|Boston Celtics
1964|Oscar Robertson|Cincinnati Royals
1963|Bill Russell|Boston Celtics
1962|Bill Russell|Boston Celtics
1961|Bill Russell|Boston Celtics
1960|Wilt Chamberlain|Philadelphia Warriors
1959|Bob Pettit|St. Louis Hawks
1958|Bill Russell|Boston Celtics
1957|Bob Cousy|Boston Celtics
1956|Bob Pettit|St. Louis Hawks
`;

const DPOY_LINES = `
2026|Victor Wembanyama|San Antonio Spurs
2025|Evan Mobley|Cleveland Cavaliers
2024|Rudy Gobert|Minnesota Timberwolves
2023|Jaren Jackson Jr.|Memphis Grizzlies
2022|Marcus Smart|Boston Celtics
2021|Rudy Gobert|Utah Jazz
2020|Giannis Antetokounmpo|Milwaukee Bucks
2019|Rudy Gobert|Utah Jazz
2018|Rudy Gobert|Utah Jazz
2017|Draymond Green|Golden State Warriors
2016|Kawhi Leonard|San Antonio Spurs
2015|Kawhi Leonard|San Antonio Spurs
2014|Joakim Noah|Chicago Bulls
2013|Marc Gasol|Memphis Grizzlies
2012|Tyson Chandler|New York Knicks
2011|Dwight Howard|Orlando Magic
2010|Dwight Howard|Orlando Magic
2009|Dwight Howard|Orlando Magic
2008|Kevin Garnett|Boston Celtics
2007|Marcus Camby|Denver Nuggets
2006|Ben Wallace|Detroit Pistons
2005|Ben Wallace|Detroit Pistons
2004|Ron Artest|Indiana Pacers
2003|Ben Wallace|Detroit Pistons
2002|Ben Wallace|Detroit Pistons
2001|Dikembe Mutombo|Philadelphia 76ers
2000|Alonzo Mourning|Miami Heat
1999|Alonzo Mourning|Miami Heat
1998|Dikembe Mutombo|Atlanta Hawks
1997|Dikembe Mutombo|Atlanta Hawks
1996|Gary Payton|Seattle SuperSonics
1995|Dikembe Mutombo|Denver Nuggets
1994|Hakeem Olajuwon|Houston Rockets
1993|Hakeem Olajuwon|Houston Rockets
1992|David Robinson|San Antonio Spurs
1991|Dennis Rodman|Detroit Pistons
1990|Dennis Rodman|Detroit Pistons
1989|Mark Eaton|Utah Jazz
1988|Michael Jordan|Chicago Bulls
1987|Michael Cooper|Los Angeles Lakers
1986|Alvin Robertson|San Antonio Spurs
1985|Mark Eaton|Utah Jazz
1984|Sidney Moncrief|Milwaukee Bucks
1983|Sidney Moncrief|Milwaukee Bucks
`;

const SIXTH_MAN_LINES = `
2026|Keldon Johnson|San Antonio Spurs
2025|Payton Pritchard|Boston Celtics
2024|Naz Reid|Minnesota Timberwolves
2023|Malcolm Brogdon|Boston Celtics
2022|Tyler Herro|Miami Heat
2021|Jordan Clarkson|Utah Jazz
2020|Montrezl Harrell|LA Clippers
2019|Lou Williams|LA Clippers
2018|Lou Williams|LA Clippers
2017|Eric Gordon|Houston Rockets
2016|Jamal Crawford|LA Clippers
2015|Lou Williams|Toronto Raptors
2014|Jamal Crawford|LA Clippers
2013|J.R. Smith|New York Knicks
2012|James Harden|Oklahoma City Thunder
2011|Lamar Odom|Los Angeles Lakers
2010|Jamal Crawford|Atlanta Hawks
2009|Jason Terry|Dallas Mavericks
2008|Manu Ginobili|San Antonio Spurs
2007|Leandro Barbosa|Phoenix Suns
2006|Mike Miller|Memphis Grizzlies
2005|Ben Gordon|Chicago Bulls
2004|Antawn Jamison|Dallas Mavericks
2003|Bobby Jackson|Sacramento Kings
2002|Corliss Williamson|Detroit Pistons
2001|Aaron McKie|Philadelphia 76ers
2000|Rodney Rogers|Phoenix Suns
1999|Darrell Armstrong|Orlando Magic
1998|Danny Manning|Phoenix Suns
1997|John Starks|New York Knicks
1996|Toni Kukoc|Chicago Bulls
1995|Anthony Mason|New York Knicks
1994|Dell Curry|Charlotte Hornets
1993|Clifford Robinson|Portland Trail Blazers
1992|Detlef Schrempf|Indiana Pacers
1991|Detlef Schrempf|Indiana Pacers
1990|Ricky Pierce|Milwaukee Bucks
1989|Eddie Johnson|Phoenix Suns
1988|Roy Tarpley|Dallas Mavericks
1987|Ricky Pierce|Milwaukee Bucks
1986|Bill Walton|Boston Celtics
1985|Kevin McHale|Boston Celtics
1984|Kevin McHale|Boston Celtics
1983|Bobby Jones|Philadelphia 76ers
`;

const MIP_LINES = `
2026|Nickeil Alexander-Walker|Atlanta Hawks
2025|Dyson Daniels|Atlanta Hawks
2024|Tyrese Maxey|Philadelphia 76ers
2023|Lauri Markkanen|Utah Jazz
2022|Ja Morant|Memphis Grizzlies
2021|Julius Randle|New York Knicks
2020|Brandon Ingram|New Orleans Pelicans
2019|Pascal Siakam|Toronto Raptors
2018|Victor Oladipo|Indiana Pacers
2017|Giannis Antetokounmpo|Milwaukee Bucks
2016|C.J. McCollum|Portland Trail Blazers
2015|Jimmy Butler|Chicago Bulls
2014|Goran Dragic|Phoenix Suns
2013|Paul George|Indiana Pacers
2012|Ryan Anderson|Orlando Magic
2011|Kevin Love|Minnesota Timberwolves
2010|Aaron Brooks|Houston Rockets
2009|Danny Granger|Indiana Pacers
2008|Hedo Turkoglu|Orlando Magic
2007|Monta Ellis|Golden State Warriors
2006|Boris Diaw|Phoenix Suns
2005|Bobby Simmons|LA Clippers
2004|Zach Randolph|Portland Trail Blazers
2003|Gilbert Arenas|Golden State Warriors
2002|Jermaine O'Neal|Indiana Pacers
2001|Tracy McGrady|Orlando Magic
2000|Jalen Rose|Indiana Pacers
1999|Darrell Armstrong|Orlando Magic
1998|Alan Henderson|Atlanta Hawks
1997|Isaac Austin|Miami Heat
1996|Gheorghe Muresan|Washington Bullets
1995|Dana Barros|Philadelphia 76ers
1994|Don MacLean|Washington Bullets
1993|Mahmoud Abdul-Rauf|Denver Nuggets
1992|Pervis Ellison|Washington Bullets
1991|Scott Skiles|Orlando Magic
1990|Rony Seikaly|Miami Heat
1989|Kevin Johnson|Phoenix Suns
1988|Kevin Duckworth|Portland Trail Blazers
1987|Dale Ellis|Seattle SuperSonics
1986|Alvin Robertson|San Antonio Spurs
`;

const CLUTCH_LINES = `
2026|Shai Gilgeous-Alexander|Oklahoma City Thunder
2025|Jalen Brunson|New York Knicks
2024|Stephen Curry|Golden State Warriors
2023|De'Aaron Fox|Sacramento Kings
`;

const ROTY_LINES = `
2026|Cooper Flagg|Dallas Mavericks
2025|Stephon Castle|San Antonio Spurs
2024|Victor Wembanyama|San Antonio Spurs
2023|Paolo Banchero|Orlando Magic
2022|Scottie Barnes|Toronto Raptors
2021|LaMelo Ball|Charlotte Hornets
2020|Ja Morant|Memphis Grizzlies
2019|Luka Doncic|Dallas Mavericks
2018|Ben Simmons|Philadelphia 76ers
2017|Malcolm Brogdon|Milwaukee Bucks
2016|Karl-Anthony Towns|Minnesota Timberwolves
2015|Andrew Wiggins|Minnesota Timberwolves
2014|Michael Carter-Williams|Philadelphia 76ers
2013|Damian Lillard|Portland Trail Blazers
2012|Kyrie Irving|Cleveland Cavaliers
2011|Blake Griffin|LA Clippers
2010|Tyreke Evans|Sacramento Kings
2009|Derrick Rose|Chicago Bulls
2008|Kevin Durant|Seattle SuperSonics
2007|Brandon Roy|Portland Trail Blazers
2006|Chris Paul|New Orleans Hornets
2005|Emeka Okafor|Charlotte Bobcats
2004|LeBron James|Cleveland Cavaliers
2003|Amar'e Stoudemire|Phoenix Suns
2002|Pau Gasol|Memphis Grizzlies
2001|Mike Miller|Orlando Magic
2000|Elton Brand|Chicago Bulls
2000|Steve Francis|Houston Rockets
1999|Vince Carter|Toronto Raptors
1998|Tim Duncan|San Antonio Spurs
1997|Allen Iverson|Philadelphia 76ers
1996|Damon Stoudamire|Toronto Raptors
1995|Grant Hill|Detroit Pistons
1995|Jason Kidd|Dallas Mavericks
1994|Chris Webber|Golden State Warriors
1993|Shaquille O'Neal|Orlando Magic
1992|Larry Johnson|Charlotte Hornets
1991|Derrick Coleman|New Jersey Nets
1990|David Robinson|San Antonio Spurs
1989|Mitch Richmond|Golden State Warriors
1988|Mark Jackson|New York Knicks
1987|Chuck Person|Indiana Pacers
1986|Patrick Ewing|New York Knicks
1985|Michael Jordan|Chicago Bulls
1984|Ralph Sampson|Houston Rockets
1983|Terry Cummings|San Diego Clippers
1982|Buck Williams|New Jersey Nets
1981|Darrell Griffith|Utah Jazz
1980|Larry Bird|Boston Celtics
1979|Phil Ford|Kansas City Kings
1978|Walter Davis|Phoenix Suns
1977|Adrian Dantley|Buffalo Braves
1976|Alvan Adams|Phoenix Suns
1975|Jamaal Wilkes|Golden State Warriors
1974|Ernie DiGregorio|Buffalo Braves
1973|Bob McAdoo|Buffalo Braves
1972|Sidney Wicks|Portland Trail Blazers
1971|Dave Cowens|Boston Celtics
1971|Geoff Petrie|Portland Trail Blazers
1970|Kareem Abdul-Jabbar|Milwaukee Bucks
1969|Wes Unseld|Baltimore Bullets
1968|Earl Monroe|Baltimore Bullets
1967|Dave Bing|Detroit Pistons
1966|Rick Barry|San Francisco Warriors
1965|Willis Reed|New York Knicks
1964|Jerry Lucas|Cincinnati Royals
1963|Terry Dischinger|Chicago Zephyrs
1962|Walt Bellamy|Chicago Packers
1961|Oscar Robertson|Cincinnati Royals
1960|Wilt Chamberlain|Philadelphia Warriors
1959|Elgin Baylor|Minneapolis Lakers
1958|Woody Sauldsberry|Philadelphia Warriors
1957|Tom Heinsohn|Boston Celtics
1956|Maurice Stokes|Rochester Royals
1955|Bob Pettit|Milwaukee Hawks
1954|Ray Felix|Baltimore Bullets
1953|Don Meineke|Fort Wayne Pistons
`;

const CHAMPION_LINES = `
2026|New York Knicks|San Antonio Spurs|4-1|Jalen Brunson|New York Knicks
2025|Oklahoma City Thunder|Indiana Pacers|4-3|Shai Gilgeous-Alexander|Oklahoma City Thunder
2024|Boston Celtics|Dallas Mavericks|4-1|Jaylen Brown|Boston Celtics
2023|Denver Nuggets|Miami Heat|4-1|Nikola Jokic|Denver Nuggets
2022|Golden State Warriors|Boston Celtics|4-2|Stephen Curry|Golden State Warriors
2021|Milwaukee Bucks|Phoenix Suns|4-2|Giannis Antetokounmpo|Milwaukee Bucks
2020|Los Angeles Lakers|Miami Heat|4-2|LeBron James|Los Angeles Lakers
2019|Toronto Raptors|Golden State Warriors|4-2|Kawhi Leonard|Toronto Raptors
2018|Golden State Warriors|Cleveland Cavaliers|4-0|Kevin Durant|Golden State Warriors
2017|Golden State Warriors|Cleveland Cavaliers|4-1|Kevin Durant|Golden State Warriors
2016|Cleveland Cavaliers|Golden State Warriors|4-3|LeBron James|Cleveland Cavaliers
2015|Golden State Warriors|Cleveland Cavaliers|4-2|Andre Iguodala|Golden State Warriors
2014|San Antonio Spurs|Miami Heat|4-1|Kawhi Leonard|San Antonio Spurs
2013|Miami Heat|San Antonio Spurs|4-3|LeBron James|Miami Heat
2012|Miami Heat|Oklahoma City Thunder|4-1|LeBron James|Miami Heat
2011|Dallas Mavericks|Miami Heat|4-2|Dirk Nowitzki|Dallas Mavericks
2010|Los Angeles Lakers|Boston Celtics|4-3|Kobe Bryant|Los Angeles Lakers
2009|Los Angeles Lakers|Orlando Magic|4-1|Kobe Bryant|Los Angeles Lakers
2008|Boston Celtics|Los Angeles Lakers|4-2|Paul Pierce|Boston Celtics
2007|San Antonio Spurs|Cleveland Cavaliers|4-0|Tony Parker|San Antonio Spurs
2006|Miami Heat|Dallas Mavericks|4-2|Dwyane Wade|Miami Heat
2005|San Antonio Spurs|Detroit Pistons|4-3|Tim Duncan|San Antonio Spurs
2004|Detroit Pistons|Los Angeles Lakers|4-1|Chauncey Billups|Detroit Pistons
2003|San Antonio Spurs|New Jersey Nets|4-2|Tim Duncan|San Antonio Spurs
2002|Los Angeles Lakers|New Jersey Nets|4-0|Shaquille O'Neal|Los Angeles Lakers
2001|Los Angeles Lakers|Philadelphia 76ers|4-1|Shaquille O'Neal|Los Angeles Lakers
2000|Los Angeles Lakers|Indiana Pacers|4-2|Shaquille O'Neal|Los Angeles Lakers
1999|San Antonio Spurs|New York Knicks|4-1|Tim Duncan|San Antonio Spurs
1998|Chicago Bulls|Utah Jazz|4-2|Michael Jordan|Chicago Bulls
1997|Chicago Bulls|Utah Jazz|4-2|Michael Jordan|Chicago Bulls
1996|Chicago Bulls|Seattle SuperSonics|4-2|Michael Jordan|Chicago Bulls
1995|Houston Rockets|Orlando Magic|4-0|Hakeem Olajuwon|Houston Rockets
1994|Houston Rockets|New York Knicks|4-3|Hakeem Olajuwon|Houston Rockets
1993|Chicago Bulls|Phoenix Suns|4-2|Michael Jordan|Chicago Bulls
1992|Chicago Bulls|Portland Trail Blazers|4-2|Michael Jordan|Chicago Bulls
1991|Chicago Bulls|Los Angeles Lakers|4-1|Michael Jordan|Chicago Bulls
1990|Detroit Pistons|Portland Trail Blazers|4-1|Isiah Thomas|Detroit Pistons
1989|Detroit Pistons|Los Angeles Lakers|4-0|Joe Dumars|Detroit Pistons
1988|Los Angeles Lakers|Detroit Pistons|4-3|James Worthy|Los Angeles Lakers
1987|Los Angeles Lakers|Boston Celtics|4-2|Magic Johnson|Los Angeles Lakers
1986|Boston Celtics|Houston Rockets|4-2|Larry Bird|Boston Celtics
1985|Los Angeles Lakers|Boston Celtics|4-2|Kareem Abdul-Jabbar|Los Angeles Lakers
1984|Boston Celtics|Los Angeles Lakers|4-3|Larry Bird|Boston Celtics
1983|Philadelphia 76ers|Los Angeles Lakers|4-0|Moses Malone|Philadelphia 76ers
1982|Los Angeles Lakers|Philadelphia 76ers|4-2|Magic Johnson|Los Angeles Lakers
1981|Boston Celtics|Houston Rockets|4-2|Cedric Maxwell|Boston Celtics
1980|Los Angeles Lakers|Philadelphia 76ers|4-2|Magic Johnson|Los Angeles Lakers
1979|Seattle SuperSonics|Washington Bullets|4-1|Dennis Johnson|Seattle SuperSonics
1978|Washington Bullets|Seattle SuperSonics|4-3|Wes Unseld|Washington Bullets
1977|Portland Trail Blazers|Philadelphia 76ers|4-2|Bill Walton|Portland Trail Blazers
1976|Boston Celtics|Phoenix Suns|4-2|Jo Jo White|Boston Celtics
1975|Golden State Warriors|Washington Bullets|4-0|Rick Barry|Golden State Warriors
1974|Boston Celtics|Milwaukee Bucks|4-3|John Havlicek|Boston Celtics
1973|New York Knicks|Los Angeles Lakers|4-1|Willis Reed|New York Knicks
1972|Los Angeles Lakers|New York Knicks|4-1|Wilt Chamberlain|Los Angeles Lakers
1971|Milwaukee Bucks|Baltimore Bullets|4-0|Kareem Abdul-Jabbar|Milwaukee Bucks
1970|New York Knicks|Los Angeles Lakers|4-3|Willis Reed|New York Knicks
1969|Boston Celtics|Los Angeles Lakers|4-3|Jerry West|Los Angeles Lakers
1968|Boston Celtics|Los Angeles Lakers|4-2||
1967|Philadelphia 76ers|San Francisco Warriors|4-2||
1966|Boston Celtics|Los Angeles Lakers|4-3||
1965|Boston Celtics|Los Angeles Lakers|4-1||
1964|Boston Celtics|San Francisco Warriors|4-1||
1963|Boston Celtics|Los Angeles Lakers|4-2||
1962|Boston Celtics|Los Angeles Lakers|4-3||
1961|Boston Celtics|St. Louis Hawks|4-1||
1960|Boston Celtics|St. Louis Hawks|4-3||
1959|Boston Celtics|Minneapolis Lakers|4-0||
1958|St. Louis Hawks|Boston Celtics|4-2||
1957|Boston Celtics|St. Louis Hawks|4-3||
1956|Philadelphia Warriors|Fort Wayne Pistons|4-1||
1955|Syracuse Nationals|Fort Wayne Pistons|4-3||
1954|Minneapolis Lakers|Syracuse Nationals|4-3||
1953|Minneapolis Lakers|New York Knicks|4-1||
1952|Minneapolis Lakers|New York Knicks|4-1||
1951|Rochester Royals|New York Knicks|4-3||
1950|Minneapolis Lakers|Syracuse Nationals|4-2||
1949|Minneapolis Lakers|Washington Capitols|4-2||
1948|Baltimore Bullets|Philadelphia Warriors|4-2||
1947|Philadelphia Warriors|Chicago Stags|4-1||
`;

export const REAL_NBA_AWARD_HISTORY_SEED = {
  mvp: parseAwardLines("mvp", MVP_LINES),
  dpoy: parseAwardLines("dpoy", DPOY_LINES),
  sixth_man: parseAwardLines("sixth_man", SIXTH_MAN_LINES),
  mip: parseAwardLines("mip", MIP_LINES),
  clutch_player: parseAwardLines("clutch_player", CLUTCH_LINES),
  roty: parseAwardLines("roty", ROTY_LINES),
};

export const REAL_NBA_CHAMPIONS_SEED = parseChampionLines(CHAMPION_LINES);

export const REAL_NBA_LEAGUE_HISTORY_SEED = {
  schemaVersion: 1,
  seedVersion: LEAGUE_HISTORY_SEED_VERSION,
  seedThroughSeasonYear: LEAGUE_HISTORY_SEED_THROUGH_SEASON_YEAR,
  awards: REAL_NBA_AWARD_HISTORY_SEED,
  champions: REAL_NBA_CHAMPIONS_SEED,
};
