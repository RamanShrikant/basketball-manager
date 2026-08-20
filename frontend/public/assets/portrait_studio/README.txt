BASKETBALL MANAGER — ROOKIE PORTRAIT STUDIO ASSET RULES
======================================================

SOURCE OF TRUTH
---------------
Draft-night reference portraits stay here:
  frontend/public/assets/rookie_faces/

Jerseyless reusable base portraits go ONLY here:
  frontend/public/assets/portrait_studio/base/

Team jersey overlays stay here:
  frontend/public/assets/jerseys/v1/

BASE PORTRAIT NAMING
--------------------
For an existing rookie identity, use the SAME ID as the draft portrait and add "_base":

  Draft reference:
    rookie_face_0003.png

  Jerseyless base:
    rookie_face_0003_base.png

Do not rename the draft reference. Do not put the jerseyless image in rookie_faces.

BASE PORTRAIT VISUAL SPEC
-------------------------
Every *_base.png must be:
  - 1040 x 760 pixels
  - PNG with alpha/transparency
  - same identity as the corresponding draft reference
  - head, hair, face, neck, shoulders and upper chest only
  - NO jersey
  - NO shirt/top
  - NO team branding
  - centered/front-facing portrait framing compatible with the 1040 x 760 jersey overlays

The file rookie_face_0001_base.png is the canonical fit-reference sampler.
The 30 current jersey templates were calibrated against this body at the default fit.

ADDING A NEW GENERATED BASE
---------------------------
1. Generate the jerseyless version.
2. Give it the exact target name shown by the League Editor or generation queue.
3. Drop the PNG into:
     frontend/public/assets/portrait_studio/base/
4. From frontend, run:
     npm run portrait:sync
   OR simply restart:
     npm run dev
   (predev automatically runs portrait:sync)
5. Open League Editor -> Player Creator -> Dressing / Portrait Editor.

The manifest and missing-base queue are GENERATED. Do not hand-edit them.

GENERATED FILES
---------------
  portrait_studio_manifest.json
  generation_queue.json
  MISSING_BASES.txt

FITS
----
The editor saves working fit values in localStorage.
Use Export Fits when you want a portable JSON backup.
The source-controlled default fit file is:
  frontend/public/assets/portrait_studio/fits/portrait_fits.json
