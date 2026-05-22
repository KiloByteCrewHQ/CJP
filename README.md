# Cockroach Knockout 🪳🥊

A 2D web game — *The Exterminator* vs *Boxer Roach*.

**Milestone 1 (current): Landing page.** Animated characters, difficulty
selector, sound toggle and a Start button. Gameplay arrives in the next
milestone.

## Tech stack

Deliberately lightweight so it loads instantly and runs lag-free:

- **HTML + CSS + vanilla JS** — no framework, no build step.
- **Inline SVG characters** + **GPU-friendly CSS animations** (`transform` /
  `opacity` only).
- **Web Audio API** — UI sounds are synthesized at runtime, so there are no
  audio files to download.
- Planned for the gameplay milestone: **Phaser 3 via CDN** for the game scene.

## Run it

It's a static site. Any of these work:

```bash
# Option A — npm (uses `serve`)
npm start

# Option B — Python
python3 -m http.server 5173
```

Then open <http://localhost:5173>.

You can also just double-click `index.html` to open it directly in a browser.

## Project structure

```
CJP/
├── index.html        # page structure + SVG characters
├── css/style.css     # theme, layout, animations
├── js/audio.js       # procedural Web Audio sound effects
└── js/main.js        # menu logic (difficulty, sound, start)
```

## Roadmap

- [x] Landing page — characters, menu, settings
- [ ] Gameplay scene (Phaser 3) — game rules & mechanics
- [ ] Combat animations & scoring
- [ ] Polish: music, particles, win/lose screens
