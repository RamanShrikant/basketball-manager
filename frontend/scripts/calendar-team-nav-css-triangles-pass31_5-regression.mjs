import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "frontend", "src", "pages", "Calendar.jsx");

function check(ok, message) {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

check(fs.existsSync(target), "Calendar.jsx exists.");
const source = fs.readFileSync(target, "utf8");

check(
  source.includes('borderRight: "11px solid currentColor"'),
  "Previous-team control uses a CSS left triangle."
);

check(
  source.includes('borderLeft: "11px solid currentColor"'),
  "Next-team control uses a CSS right triangle."
);

check(
  !source.includes("&#9664;") && !source.includes("&#9654;"),
  "Emoji-prone numeric triangle entities are removed."
);

check(
  (source.match(/<MiniStandingsPanel\b/g) || []).length === 0,
  "Floating mini standings remain removed."
);

check(
  source.includes('handleTeamSwitch("prev")') && source.includes('handleTeamSwitch("next")'),
  "Team navigation handlers remain wired."
);

console.log("PASS: Calendar Team-Nav CSS Triangles Pass 31.5 is installed.");
console.log("PASS: Team arrows use CSS triangles, so Chrome cannot render them as blue emoji buttons.");
console.log("PASS: Team-switch handlers remain intact and mini standings remain removed.");
