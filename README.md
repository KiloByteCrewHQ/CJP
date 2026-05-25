# Cockroach Knockout 🪳🥊

A 2D/3D web game — *The Exterminator* (Narendra Modi) vs the cockroach
invasion of the PM's office.

- **Landing page** (`index.html`) — animated character standoff, difficulty
  selector, sound toggle.
- **Game** (`game.html`) — **Office Infestation** (Easy Mode), a real 3D
  office scene with physics, particles and combat.

## Tech stack

| Layer | Library / approach |
| --- | --- |
| Landing page | Plain HTML + CSS + vanilla JS (no build step) |
| 3D rendering | **Three.js** (r0.160, vendored at `js/lib/three.module.js`) |
| Physics | **cannon-es** (vendored at `js/lib/cannon-es.js`) |
| Characters | Billboard PNG sprites (`assets/images/`) on physics bodies |
| Audio | Procedural Web Audio SFX + a celebration MP3 on win |

Everything is static — no build tooling, no node_modules. Three.js and
cannon-es are committed locally so the game also works offline once loaded.

## Run it

```bash
# any static server works
python3 -m http.server 5173        # then open http://localhost:5173
# or
npm start                           # uses `npx serve`
```

> The game uses ES modules, so it **needs an http server** — double-clicking
> `game.html` from the file system will not work.

## Office Infestation — Easy Mode

You play as Modi in the Prime Minister's office. Cockroaches storm the room;
you exterminate them with the Raid spray before they wreck your composure.

### Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / Arrow Keys | Move Modi around the office |
| `Enter` / `Space` | Hold to spray |
| `P` / `Esc` | Pause |

### Rules

- **Goal:** exterminate **12 cockroaches**.
- **Composure** starts at 100. Every roach that touches Modi knocks it down.
  Reach 0 → game over.
- **Spray meter** depletes while spraying and refills when you release.
- **Combos** — chain kills inside ~2 seconds for a score multiplier.

### What's in the scene

- Fixed-angle camera showing the entire office.
- 3D office: floor, walls, windows, national emblem, framed portraits, clock,
  the PM's desk + monitor + nameplate + a small tricolour flag, executive
  chair, bookshelf with random books, sofa, armchair, coffee table, potted
  plants, two standing tricolour flags.
- Real-time directional + hemisphere lighting with soft shadows.
- Physics (cannon-es): every piece of furniture is a collider; roaches jostle
  off walls and each other; when sprayed they tumble through the air via
  ragdoll impulses.
- Particles: continuous spray mist, roach-death squish bursts, spawn puffs.
- HUD: score, roach count, composure bar, spray pressure meter, floating
  `+score` popups, big `COMBO ×N!` callouts, screen shake + red damage
  flash when hit.
- Win/lose overlays with score, accuracy and a star rating.

### Dev mode

Append `?dev=1` to the game URL to skip the intro/countdown and enable an
**autopilot** that drives Modi toward the nearest roach and sprays — handy
for screenshots and demos.

## Project structure

```
CJP/
├── index.html              # landing page
├── game.html               # the 3D game page
├── css/
│   ├── style.css           # landing page styles
│   └── game.css            # game HUD + overlay styles
├── js/
│   ├── main.js             # landing page menu logic
│   ├── audio.js            # landing page procedural sounds
│   ├── modi3d.js           # (landing page hero render helpers)
│   ├── game.js             # the 3D game (ES module)
│   └── lib/
│       ├── three.module.js # Three.js r0.160 (vendored)
│       └── cannon-es.js    # cannon-es 0.20 (vendored)
└── assets/
    ├── images/             # Modi & roach PNG sprites
    └── audio/              # win-celebration clips
```

## Roadmap

- [x] Landing page — characters, menu, settings
- [x] **Easy mode** — 3D office, movement, spray, cockroaches, rules
- [ ] **Medium / Hard** scenes — different rooms, faster/tougher roaches,
      multi-room navigation, boss roach
- [ ] Pickups (spray refill, composure boost)
- [ ] More juice: better death animation, screen-space hit flashes, music
- [ ] Mobile touch controls
