BASKETBALL MANAGER — PORTRAIT STUDIO FOUNDATION PATCH
Built from: basketball-manager-PORTRAIT-context-20260819-035053.zip

WHAT THIS DOES
==============
- Keeps the existing 44 baked-jersey rookie portraits as draft-night references.
- Adds a dedicated jerseyless base portrait system.
- Installs the user's 1040x760 jerseyless sampler as rookie_face_0001_base.png.
- Keeps all 30 current team jersey overlays.
- Makes the League Editor Dressing / Portrait Editor use ONLY jerseyless base portraits under jerseys.
- Shows the 44 current draft identities as a generation queue until their matching base PNG exists.
- Auto-generates the Portrait Studio manifest and exact missing-base filenames.
- Validates every added base PNG as 1040x760 and alpha-capable.
- Does not wire this system into normal post-Play gameplay.

INSTALL
=======
From repository root in PowerShell:

Expand-Archive `
  -Path "$env:USERPROFILE\Downloads\basketball-manager-PORTRAIT-STUDIO-foundation-20260819.zip" `
  -DestinationPath . `
  -Force

cd frontend
npm run portrait:sync
npm run check:portrait-dressing
npm run check:portrait-studio
npm run build
npm run dev

FUTURE GENERATED FACE WORKFLOW
==============================
For current rookie_face_0003.png:
  Generate jerseyless version -> rookie_face_0003_base.png

Put it here:
  frontend/public/assets/portrait_studio/base/rookie_face_0003_base.png

Then:
  npm run portrait:sync

Or simply restart npm run dev; predev automatically syncs.

Exact base spec:
- 1040x760
- transparent/alpha PNG
- same identity as draft reference
- head/hair/face/neck/shoulders/upper chest
- no jersey
- no shirt/top
- no team branding

The editor displays the exact filename required for every missing base.
