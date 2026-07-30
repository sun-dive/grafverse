# grafverse — teaser

A single, self-contained, fully-offline playable teaser for **grafverse.com**.

You spawn floating in a black starfield, find a spray can, and paint a dead moon into
existence — while a weary, contract-bound vending machine (Unit 21) natters at you about
paint, WD40, the covenant, and whether the world is flat.

## What's here
- `index.html` — the whole thing (Three.js scene + Canvas paint + spintext NPC dialogue).
- `vendor/three.min.js` — Three.js, vendored locally. **No CDN, no build step, no server** —
  runs from `file://` or any static host. Power- and net-proof; cartless by design.

## Controls
- **Desktop:** click to begin · WASD move · mouse look · hold Click to spray · 1–5 colors · **T** to talk.
- **Mobile:** tap to begin · left-stick move · drag to look · Spray button · Talk button.

## Deploy (cPanel Git → grafverse.com)
`.cpanel.yml` copies `index.html` + `vendor/` to the grafverse.com document root.
In cPanel → Git Version Control: **Update from Remote**, then **Deploy HEAD Commit**.

Owned, not claimed.
