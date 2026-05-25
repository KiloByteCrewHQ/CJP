/* ============================================================
   COCKROACH KNOCKOUT — Office Infestation (Easy Mode)
   3D game built with Three.js (rendering) + cannon-es (physics).

   Fixed-camera 3D office. WASD / Arrows move Modi, Enter / Space
   sprays. Exterminate the cockroaches before they wreck his
   composure.
   ============================================================ */

import * as THREE from './lib/three.module.js';
import * as CANNON from './lib/cannon-es.js';

/* ============ CONFIG ============ */
const PARAMS = new URLSearchParams(location.search);
const LEVEL = PARAMS.get('level') || localStorage.getItem('ck_level') || 'easy';
const DEV = PARAMS.get('dev') === '1';

const LEVELS = {
  easy:   { target: 12, touchDmg: 14, roachSpeed: 1.7, roachPanic: 3.1, maxAlive: 5,  spawnEvery: 2.4, roachHP: 1.0, playerSpeed: 6.6 },
  medium: { target: 18, touchDmg: 18, roachSpeed: 2.3, roachPanic: 3.9, maxAlive: 7,  spawnEvery: 1.8, roachHP: 1.5, playerSpeed: 7.0 },
  hard:   { target: 26, touchDmg: 24, roachSpeed: 2.9, roachPanic: 4.7, maxAlive: 10, spawnEvery: 1.3, roachHP: 2.1, playerSpeed: 7.4 },
};
const CFG = LEVELS[LEVEL] || LEVELS.easy;

const ROOM = { halfX: 13, backZ: -10, frontZ: 10, wallH: 8 };
const PLAYER_R = 0.62, ROACH_R = 0.36;
const SPRAY = { range: 5.2, cone: Math.cos(THREE.MathUtils.degToRad(33)), power: 2.5, drain: 23, recharge: 30, muzzleY: 1.95 };

/* ============ STATE ============ */
const S = {
  running: false, paused: false, over: false,
  score: 0, killed: 0, spawned: 0,
  composure: 100, sprayMeter: 100,
  combo: 0, bestCombo: 0, lastKill: -10,
  sprays: 0, hits: 0, time: 0,
  spawnTimer: 1.2, shake: 0,
};

/* ============ THREE / CANNON GLOBALS ============ */
let renderer, scene, camera, clock;
let world;
let player, roaches = [];
let particles, sprayMuzzle = new THREE.Vector3();
const camBase = new THREE.Vector3(0, 15, 20.5);
const camLook = new THREE.Vector3(0, 1.4, 1.5);

/* ============ INPUT ============ */
const keys = {};
const facing = { x: -1, z: 0 };   // default: facing screen-left
let flipSign = 1;

/* ============ DOM ============ */
const $ = (id) => document.getElementById(id);
const hud = $('hud');

/* ============================================================
   AUDIO  — procedural SFX via Web Audio + one celebration clip
   ============================================================ */
const AudioFX = (() => {
  let ctx, noiseBuf, sprayGain, sprayOn = false;
  let enabled = localStorage.getItem('ck_sound') !== 'off';
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      // pre-bake a noise buffer for the spray hiss
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function blip(freq, dur, type, vol, slideTo) {
    if (!enabled) return;
    const c = ac(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    setSpray(on) {
      if (!enabled) return;
      const c = ac();
      if (on && !sprayOn) {
        const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.8;
        sprayGain = c.createGain(); sprayGain.gain.value = 0.0001;
        src.connect(bp).connect(sprayGain).connect(c.destination);
        src.start(); sprayGain.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 0.05);
        sprayOn = true; sprayGain._src = src;
      } else if (!on && sprayOn) {
        sprayGain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.08);
        const s = sprayGain._src; setTimeout(() => { try { s.stop(); } catch (e) {} }, 140);
        sprayOn = false;
      }
    },
    squish() { blip(220, 0.16, 'square', 0.2, 70); blip(120, 0.2, 'sawtooth', 0.12, 50); },
    hurt() { blip(180, 0.25, 'sawtooth', 0.22, 90); },
    spawn() { blip(420, 0.1, 'triangle', 0.08, 300); },
    combo(n) { blip(520 + n * 80, 0.14, 'triangle', 0.16, 880 + n * 90); },
    win() {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.18), i * 130));
      if (enabled) { const a = new Audio('assets/audio/modi-modi-modi-modi-kids.mp3'); a.volume = 0.6; a.play().catch(() => {}); }
    },
    lose() { [400, 330, 250, 170].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sawtooth', 0.18), i * 150)); },
    ui() { blip(660, 0.1, 'triangle', 0.12, 880); },
  };
})();

/* ============================================================
   TEXTURE HELPERS
   ============================================================ */
function softCircleTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function floorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#e9e2d2'; x.fillRect(0, 0, 1024, 1024);
  const tiles = 4, ts = 1024 / tiles;
  for (let i = 0; i < tiles; i++) for (let j = 0; j < tiles; j++) {
    const shade = 224 + Math.floor(Math.random() * 18);
    x.fillStyle = `rgb(${shade},${shade - 8},${shade - 24})`;
    x.fillRect(i * ts + 3, j * ts + 3, ts - 6, ts - 6);
    // marble veins
    x.strokeStyle = 'rgba(170,150,120,0.18)'; x.lineWidth = 2;
    for (let v = 0; v < 3; v++) {
      x.beginPath();
      x.moveTo(i * ts + Math.random() * ts, j * ts);
      x.bezierCurveTo(
        i * ts + Math.random() * ts, j * ts + ts * 0.4,
        i * ts + Math.random() * ts, j * ts + ts * 0.7,
        i * ts + Math.random() * ts, j * ts + ts);
      x.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2.6);
  return t;
}

/* ============================================================
   BOOTSTRAP — load textures, then build everything
   ============================================================ */
const TEX = {};
const loadMgr = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(loadMgr);

['assets/images/modi-final-cut.png', 'assets/images/roach.png'].forEach((src) => {
  TEX[src] = texLoader.load(src);
  TEX[src].colorSpace = THREE.SRGBColorSpace;
});

loadMgr.onLoad = () => { init(); };
loadMgr.onError = () => { init(); };  // build anyway with whatever loaded

/* ============================================================
   INIT
   ============================================================ */
function init() {
  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1330');
  scene.fog = new THREE.Fog('#1a1330', 34, 58);

  camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 200);
  camera.position.copy(camBase);
  camera.lookAt(camLook);

  // physics
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  world.defaultContactMaterial.friction = 0.06;
  world.defaultContactMaterial.restitution = 0.05;
  world.broadphase = new CANNON.SAPBroadphase(world);
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  buildOffice();
  buildLights();
  createPlayer();
  particles = new ParticlePool(150);

  bindInput();
  addEventListener('resize', onResize);

  // UI flow
  $('loading').hidden = true;
  $('intro-target').textContent = CFG.target;
  $('roach-target').textContent = CFG.target;

  if (DEV) { startGame(); }
  else { $('intro').hidden = false; }

  $('intro-go').addEventListener('click', () => { AudioFX.ui(); $('intro').hidden = true; countdown(); });
  $('resume-btn').addEventListener('click', togglePause);
  $('pause-restart').addEventListener('click', () => location.reload());
  $('replay-btn').addEventListener('click', () => location.reload());

  renderer.setAnimationLoop(loop);
}

/* ============================================================
   OFFICE ENVIRONMENT
   ============================================================ */
function mat(color, rough = 0.85, metal = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}
function box(w, h, d, color, rough, metal) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, rough, metal));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
/** add a static cannon box collider (full sizes, sitting on the floor) */
function collider(cx, cz, w, d, h = 4) {
  const b = new CANNON.Body({ mass: 0 });
  b.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
  b.position.set(cx, h / 2, cz);
  world.addBody(b);
}

function buildOffice() {
  const { halfX, backZ, frontZ, wallH } = ROOM;
  const depth = frontZ - backZ;

  // ---- floor ----
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(halfX * 2, depth),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.5, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (backZ + frontZ) / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  // ---- walls ----
  const backWall = box(halfX * 2, wallH, 0.6, '#cdbf9c', 0.95);
  backWall.position.set(0, wallH / 2, backZ - 0.3); scene.add(backWall);
  const sideL = box(0.6, wallH, depth, '#bfb293', 0.95);
  sideL.position.set(-halfX - 0.3, wallH / 2, (backZ + frontZ) / 2); scene.add(sideL);
  const sideR = sideL.clone(); sideR.position.x = halfX + 0.3; scene.add(sideR);
  // skirting boards
  const skirt = box(halfX * 2, 0.5, 0.7, '#8a7a55');
  skirt.position.set(0, 0.25, backZ - 0.25); scene.add(skirt);

  // wall colliders (4 sides, keep characters inside)
  collider(0, backZ - 0.3, halfX * 2 + 2, 0.6, wallH);
  collider(0, frontZ + 0.5, halfX * 2 + 2, 0.6, wallH);
  collider(-halfX - 0.3, (backZ + frontZ) / 2, 0.6, depth + 2, wallH);
  collider(halfX + 0.3, (backZ + frontZ) / 2, 0.6, depth + 2, wallH);

  // ---- windows on back wall (emissive panels) ----
  for (const wx of [-7.6, 7.6]) {
    const frame = box(4.4, 4, 0.3, '#7a6a48');
    frame.position.set(wx, 4.4, backZ - 0.05); scene.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 3.3),
      new THREE.MeshStandardMaterial({ color: '#bfe6ff', emissive: '#cdeaff', emissiveIntensity: 0.85, roughness: 0.3 }));
    glass.position.set(wx, 4.5, backZ + 0.12); scene.add(glass);
    // mullions
    const barV = box(0.16, 3.3, 0.1, '#6a5c3e'); barV.position.set(wx, 4.5, backZ + 0.16); scene.add(barV);
    const barH = box(3.7, 0.16, 0.1, '#6a5c3e'); barH.position.set(wx, 4.5, backZ + 0.16); scene.add(barH);
  }

  // ---- Ashoka-style emblem medallion above the desk ----
  const emblem = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40),
    new THREE.MeshStandardMaterial({ color: '#d9a93a', metalness: 0.7, roughness: 0.35,
      emissive: '#3a2c08', emissiveIntensity: 0.4 }));
  emblem.position.set(0, 5.4, backZ + 0.14); scene.add(emblem);
  const emblemRing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.13, 12, 40), mat('#b58a26', 0.4, 0.6));
  emblemRing.position.copy(emblem.position); scene.add(emblemRing);

  // ---- framed portraits ----
  for (const px of [-11, 11]) {
    const fr = box(2.2, 2.8, 0.18, '#5b4a2c');
    fr.position.set(px, 4.6, backZ + 0.04); scene.add(fr);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.3),
      mat(px < 0 ? '#3f6d4a' : '#4a5a86', 0.9));
    pic.position.set(px, 4.6, backZ + 0.16); scene.add(pic);
  }

  // ---- wall clock ----
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32),
    mat('#f5f2e6', 0.6));
  clockFace.position.set(0, 6.6, backZ + 0.14); scene.add(clockFace);
  const clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.09, 10, 32), mat('#3a3a40', 0.5, 0.3));
  clockRim.position.copy(clockFace.position); scene.add(clockRim);
  officeClock.hour = box(0.07, 0.4, 0.04, '#2a2a30'); officeClock.hour.geometry.translate(0, 0.2, 0);
  officeClock.hour.position.set(0, 6.6, backZ + 0.2); scene.add(officeClock.hour);
  officeClock.min = box(0.05, 0.62, 0.04, '#2a2a30'); officeClock.min.geometry.translate(0, 0.31, 0);
  officeClock.min.position.set(0, 6.6, backZ + 0.22); scene.add(officeClock.min);

  // ---- the PM's desk ----
  const deskZ = backZ + 3.1;
  const deskTop = box(6.4, 0.4, 2.6, '#7a4e2c', 0.6);
  deskTop.position.set(0, 1.5, deskZ); scene.add(deskTop);
  const deskBody = box(6.0, 1.3, 2.3, '#603d22', 0.7);
  deskBody.position.set(0, 0.75, deskZ); scene.add(deskBody);
  collider(0, deskZ, 6.4, 2.6, 3.4);
  // desk items
  const monitor = box(2.0, 1.2, 0.16, '#1c1c22', 0.4, 0.3);
  monitor.position.set(-1.7, 2.5, deskZ - 0.4); scene.add(monitor);
  const monStand = box(0.3, 0.5, 0.3, '#2a2a30'); monStand.position.set(-1.7, 1.9, deskZ - 0.4); scene.add(monStand);
  const nameplate = box(1.5, 0.3, 0.3, '#c9a747', 0.4, 0.5);
  nameplate.position.set(1.4, 1.85, deskZ + 0.9); scene.add(nameplate);
  const papers = box(0.9, 0.1, 1.1, '#f3efe2', 0.9);
  papers.position.set(1.7, 1.75, deskZ - 0.2); scene.add(papers);
  // small tricolour flag on desk
  deskFlag(2.6, 1.7, deskZ + 0.4);

  // ---- executive chair behind desk ----
  const chair = new THREE.Group();
  const seat = box(1.5, 0.3, 1.4, '#26262c', 0.6); seat.position.y = 1.3;
  const backR = box(1.5, 1.9, 0.3, '#26262c', 0.6); backR.position.set(0, 2.2, -0.55);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 12), mat('#3a3a42', 0.4, 0.5));
  pole.position.y = 0.65; pole.castShadow = true;
  chair.add(seat, backR, pole);
  for (let i = 0; i < 5; i++) {
    const leg = box(0.7, 0.16, 0.22, '#3a3a42', 0.4, 0.5);
    leg.rotation.y = i * (Math.PI * 2 / 5); leg.position.y = 0.1;
    leg.geometry.translate(0, 0, 0.35);
    chair.add(leg);
  }
  chair.position.set(0, 0, backZ + 1.0); scene.add(chair);
  collider(0, backZ + 1.0, 1.6, 1.6, 2.6);

  // ---- visitors' sofa against the left wall (keeps the play area open) ----
  const sofa = new THREE.Group();
  const sBase = box(6, 0.8, 2.1, '#33508f', 0.95); sBase.position.y = 0.65;
  const sBack = box(6, 1.5, 0.6, '#2c4680', 0.95); sBack.position.set(0, 1.55, -0.78);
  const armL = box(0.6, 1.1, 2.1, '#2c4680', 0.95); armL.position.set(-2.7, 1.0, 0);
  const armR = armL.clone(); armR.position.x = 2.7;
  sofa.add(sBase, sBack, armL, armR);
  for (const cx of [-1.6, 0, 1.6]) {
    const cush = box(1.7, 0.45, 1.8, '#3f5ea0', 1); cush.position.set(cx, 1.15, 0.05);
    sofa.add(cush);
  }
  sofa.rotation.y = Math.PI / 2;
  sofa.position.set(-halfX + 1.5, 0, 2); scene.add(sofa);
  collider(-halfX + 1.5, 2, 2.1, 6, 2.4);

  // ---- low coffee table in the centre (does not block the view) ----
  const ctTop = box(2.6, 0.22, 1.5, '#6b4526', 0.5);
  ctTop.position.set(0, 0.78, 1.5); scene.add(ctTop);
  for (const sx of [-1.1, 1.1]) for (const sz of [-0.55, 0.55]) {
    const lg = box(0.18, 0.78, 0.18, '#5a3a20'); lg.position.set(sx, 0.39, 1.5 + sz); scene.add(lg);
  }
  collider(0, 1.5, 2.6, 1.5, 1.2);

  // ---- armchair on the right side ----
  const chairR = new THREE.Group();
  chairR.add(box(1.8, 0.7, 1.8, '#7a2f3a', 0.95));
  const cBack = box(1.8, 1.3, 0.5, '#6b2832', 0.95); cBack.position.set(0, 0.6, -0.65);
  const cArmA = box(0.4, 0.7, 1.8, '#6b2832', 0.95); cArmA.position.set(-0.7, 0.5, 0);
  const cArmB = cArmA.clone(); cArmB.position.x = 0.7;
  chairR.add(cBack, cArmA, cArmB);
  chairR.position.set(halfX - 2, 0.4, 2.5); chairR.rotation.y = -Math.PI / 2;
  scene.add(chairR);
  collider(halfX - 2, 2.5, 1.8, 1.8, 1.6);

  // ---- bookshelf on the left wall ----
  const shelf = new THREE.Group();
  shelf.add(box(2.4, 5, 1.2, '#5a3a20', 0.8));
  for (let r = 0; r < 4; r++) {
    let bx = -0.85;
    while (bx < 0.95) {
      const bh = 0.55 + Math.random() * 0.35, bw = 0.16 + Math.random() * 0.16;
      const bk = box(bw, bh, 0.85, new THREE.Color().setHSL(Math.random(), 0.55, 0.5));
      bk.position.set(bx, -1.7 + r * 1.2 + bh / 2, 0.1);
      shelf.add(bk); bx += bw + 0.05;
    }
  }
  shelf.position.set(-halfX + 1.1, 2.5, backZ + 4.5); scene.add(shelf);
  collider(-halfX + 1.1, backZ + 4.5, 2.4, 1.2, 5);

  // ---- potted plants in the corners ----
  for (const [px, pz] of [[-halfX + 1.4, frontZ - 1.6], [halfX - 1.4, frontZ - 1.6], [halfX - 1.4, backZ + 1.6]]) {
    plant(px, pz);
    collider(px, pz, 1.3, 1.3, 2.2);
  }

  // ---- standing tricolour flags flanking the desk ----
  standFlag(-5.4, deskZ - 0.2);
  standFlag(5.4, deskZ - 0.2);

  // ---- decorative rug in the centre of the room ----
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(11, 9),
    new THREE.MeshStandardMaterial({ color: '#7a2f3a', roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.02, 2.5);
  rug.receiveShadow = true; scene.add(rug);
  const rugInner = new THREE.Mesh(new THREE.PlaneGeometry(9, 7),
    new THREE.MeshStandardMaterial({ color: '#9c4651', roughness: 1 }));
  rugInner.rotation.x = -Math.PI / 2; rugInner.position.set(0, 0.03, 2.5);
  scene.add(rugInner);
}

const officeClock = {};

function plant(x, z) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.8, 16), mat('#b5623a', 0.9));
  pot.position.y = 0.4; pot.castShadow = true; g.add(pot);
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.5, 8),
      mat(new THREE.Color().setHSL(0.32, 0.5, 0.32 + Math.random() * 0.12), 0.9));
    leaf.position.set((Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 0.7, (Math.random() - 0.5) * 0.6);
    leaf.rotation.set((Math.random() - 0.5) * 0.7, Math.random() * 6, (Math.random() - 0.5) * 0.7);
    leaf.castShadow = true; g.add(leaf);
  }
  g.position.set(x, 0, z); scene.add(g);
}

const flags = [];
function deskFlag(x, y, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8), mat('#caa64a', 0.4, 0.6));
  pole.position.set(x, y + 0.7, z); scene.add(pole);
  const cloth = tricolour(0.9, 0.6);
  cloth.position.set(x + 0.47, y + 1.05, z); scene.add(cloth);
  flags.push(cloth);
}
function standFlag(x, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.4, 10), mat('#caa64a', 0.4, 0.6));
  pole.position.set(x, 2.7, z); pole.castShadow = true; scene.add(pole);
  const cloth = tricolour(1.7, 1.1);
  cloth.position.set(x + 0.88, 4.4, z); scene.add(cloth);
  flags.push(cloth);
}
function tricolour(w, h) {
  const g = new THREE.Group();
  const cols = ['#ff9933', '#ffffff', '#138808'];
  cols.forEach((c, i) => {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, h / 3),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, side: THREE.DoubleSide }));
    strip.position.y = h / 3 - i * (h / 3);
    g.add(strip);
  });
  const chakra = new THREE.Mesh(new THREE.TorusGeometry(h / 9, h / 60, 8, 20),
    mat('#0a3a8a', 0.5, 0.3));
  chakra.position.z = 0.01; g.add(chakra);
  return g;
}

function buildLights() {
  scene.add(new THREE.HemisphereLight('#fff4dc', '#3a3552', 0.85));
  const sun = new THREE.DirectionalLight('#fff1d0', 1.75);
  sun.position.set(9, 17, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  const warm = new THREE.PointLight('#ffd9a0', 0.5, 40);
  warm.position.set(0, 6.5, 4); scene.add(warm);
}

/* ============================================================
   PLAYER  (billboard sprite + physics body)
   ============================================================ */
function billboardPlane(texture, height) {
  const img = texture.image;
  const aspect = img ? img.width / img.height : 0.62;
  const geo = new THREE.PlaneGeometry(height * aspect, height);
  geo.translate(0, height / 2, 0);   // anchor bottom at origin
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: texture, transparent: true, alphaTest: 0.42, depthWrite: true,
  }));
  return m;
}
function contactShadow(size) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.62),
    new THREE.MeshBasicMaterial({ map: softCircleTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'),
      transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.04;
  m.renderOrder = 1;
  return m;
}

function createPlayer() {
  const group = new THREE.Group();
  const sprite = billboardPlane(TEX['assets/images/modi-final-cut.png'], 3.5);
  sprite.material.toneMapped = false;
  const shadow = contactShadow(2.6);
  group.add(shadow, sprite);
  group.position.set(0, 0, 5.5);
  scene.add(group);

  const body = new CANNON.Body({
    mass: 7, fixedRotation: true,
    shape: new CANNON.Sphere(PLAYER_R),
    position: new CANNON.Vec3(0, PLAYER_R, 5.5),
  });
  body.linearDamping = 0.0;
  world.addBody(body);

  player = { group, sprite, shadow, body, bob: 0, recoil: 0 };
}

/* ============================================================
   COCKROACH
   ============================================================ */
const SPAWNS = [
  [-11, -7], [11, -7], [-11, 7], [11, 7], [0, -8.5],
  [-11, 1], [11, 1], [-6, 8.5], [6, 8.5],
];

function spawnRoach() {
  // pick a spawn point away from the player
  let pt, tries = 0;
  do { pt = SPAWNS[(Math.random() * SPAWNS.length) | 0]; tries++; }
  while (tries < 8 && dist2(pt[0], pt[1], player.body.position.x, player.body.position.z) < 16);

  const group = new THREE.Group();
  const sprite = billboardPlane(TEX['assets/images/roach.png'], 1.5);
  sprite.material.toneMapped = false;
  const shadow = contactShadow(1.15);
  group.add(shadow, sprite);
  group.position.set(pt[0], 0, pt[1]);
  scene.add(group);

  const body = new CANNON.Body({
    mass: 0.5, fixedRotation: true,
    shape: new CANNON.Sphere(ROACH_R),
    position: new CANNON.Vec3(pt[0], ROACH_R, pt[1]),
  });
  body.linearDamping = 0.2;
  world.addBody(body);

  const r = {
    group, sprite, shadow, body,
    state: 'wander', dead: false, deadT: 0,
    poison: 0, hp: CFG.roachHP,
    target: new THREE.Vector3(), repick: 0,
    speed: CFG.roachSpeed * (0.82 + Math.random() * 0.4),
    bob: Math.random() * 6, flip: 1, touchCD: 0, tint: 0,
  };
  pickRoachTarget(r);
  roaches.push(r);
  S.spawned++;
  AudioFX.spawn();
  particles.burst(group.position.x, ROACH_R, group.position.z, 10, '#6a4326', 0.9);
}

function pickRoachTarget(r) {
  r.repick = 1.4 + Math.random() * 2.2;
  if (Math.random() < 0.4) {                       // head toward Modi
    r.target.set(player.body.position.x, 0, player.body.position.z);
  } else {                                          // wander to a random spot
    r.target.set(
      (Math.random() * 2 - 1) * (ROOM.halfX - 2), 0,
      ROOM.backZ + 2 + Math.random() * (ROOM.frontZ - ROOM.backZ - 4));
  }
}

function killRoach(r) {
  if (r.dead) return;
  r.dead = true; r.state = 'dead'; r.deadT = 0;
  S.killed++;
  // combo scoring
  const now = S.time;
  S.combo = (now - S.lastKill < 2.3) ? S.combo + 1 : 1;
  S.lastKill = now;
  S.bestCombo = Math.max(S.bestCombo, S.combo);
  const gain = 100 * Math.max(1, S.combo);
  S.score += gain;
  popText(r.group.position.x, ROACH_R + 1, r.group.position.z, '+' + gain, false);
  if (S.combo >= 2) { showCombo(S.combo); AudioFX.combo(S.combo); }
  AudioFX.squish();
  // physics: pop into the air + tumble
  r.body.velocity.set((Math.random() - 0.5) * 5, 4.6, (Math.random() - 0.5) * 5);
  r.spin = (Math.random() - 0.5) * 16;
  // re-anchor the sprite to its centre so the death tumble spins in place
  const rh = r.sprite.geometry.parameters.height;
  r.sprite.geometry.translate(0, -rh / 2, 0);
  r.sprite.position.y += rh / 2;
  particles.burst(r.group.position.x, ROACH_R + 0.3, r.group.position.z, 16, '#7bd14a', 1.1);
  particles.burst(r.group.position.x, ROACH_R + 0.2, r.group.position.z, 8, '#6a4326', 0.9);
  shake(0.4);
}

function removeRoach(r, i) {
  scene.remove(r.group);
  r.sprite.geometry.dispose(); r.sprite.material.dispose();
  world.removeBody(r.body);
  roaches.splice(i, 1);
}

/* ============================================================
   PARTICLE POOL  (pooled sprites for mist + bursts)
   ============================================================ */
class ParticlePool {
  constructor(n) {
    this.tex = softCircleTexture();
    this.items = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.tex, transparent: true, depthWrite: false, opacity: 0, rotation: 0,
      }));
      s.visible = false; s.material.toneMapped = false;
      scene.add(s);
      this.items.push({ s, vel: new THREE.Vector3(), life: 0, max: 1, grow: 1, active: false });
    }
  }
  _free() { return this.items.find((p) => !p.active); }
  emit(x, y, z, vx, vy, vz, color, size, life, grow) {
    const p = this._free(); if (!p) return;
    p.active = true; p.life = 0; p.max = life; p.grow = grow;
    p.vel.set(vx, vy, vz);
    p.s.visible = true;
    p.s.position.set(x, y, z);
    p.s.scale.setScalar(size);
    p.s.material.color.set(color);
    p.s.material.opacity = 0.9;
  }
  burst(x, y, z, n, color, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, sp = 1.5 + Math.random() * 3.5;
      this.emit(x, y, z, Math.cos(a) * sp, 1.5 + Math.random() * 3, Math.sin(a) * sp,
        color, size * (0.5 + Math.random() * 0.7), 0.5 + Math.random() * 0.4, 1.8);
    }
  }
  update(dt) {
    for (const p of this.items) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.max) { p.active = false; p.s.visible = false; continue; }
      p.vel.y -= 4.5 * dt;
      p.s.position.x += p.vel.x * dt;
      p.s.position.y += p.vel.y * dt;
      p.s.position.z += p.vel.z * dt;
      if (p.s.position.y < 0.05) { p.s.position.y = 0.05; p.vel.y *= -0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; }
      const k = p.life / p.max;
      p.s.material.opacity = 0.9 * (1 - k);
      p.s.scale.setScalar(p.s.scale.x + p.grow * dt);
    }
  }
}

/* ============================================================
   INPUT
   ============================================================ */
function bindInput() {
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    keys[k] = true;
    if (k === 'p' || k === 'escape') { if (S.running && !S.over) togglePause(); }
  });
  addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
}
function axis() {
  let x = 0, z = 0;
  if (keys['a'] || keys['arrowleft']) x -= 1;
  if (keys['d'] || keys['arrowright']) x += 1;
  if (keys['w'] || keys['arrowup']) z -= 1;
  if (keys['s'] || keys['arrowdown']) z += 1;
  const l = Math.hypot(x, z);
  return l ? { x: x / l, z: z / l, moving: true } : { x: 0, z: 0, moving: false };
}
function spraying() {
  return (keys['enter'] || keys[' ']) && S.sprayMeter > 1 && S.running && !S.paused && !S.over;
}

/* DEV autopilot — lets the game play itself for testing / attract mode */
function autopilot() {
  keys['w'] = keys['a'] = keys['s'] = keys['d'] = keys['enter'] = false;
  let best = null, bd = 1e9;
  for (const r of roaches) {
    if (r.dead) continue;
    const dx = r.body.position.x - player.body.position.x;
    const dz = r.body.position.z - player.body.position.z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = r; }
  }
  if (!best) return;
  const dx = best.body.position.x - player.body.position.x;
  const dz = best.body.position.z - player.body.position.z;
  const d = Math.hypot(dx, dz) || 1;
  if (d > 3.2) {
    if (dx < -0.6) keys['a'] = true; else if (dx > 0.6) keys['d'] = true;
    if (dz < -0.6) keys['w'] = true; else if (dz > 0.6) keys['s'] = true;
  } else {
    facing.x = dx / d; facing.z = dz / d;
    if (facing.x < -0.1) flipSign = 1; else if (facing.x > 0.1) flipSign = -1;
  }
  keys['enter'] = true;
}

/* ============================================================
   UPDATE — PLAYER
   ============================================================ */
function updatePlayer(dt) {
  const a = axis();
  const sp = CFG.playerSpeed;
  player.body.velocity.x = a.x * sp;
  player.body.velocity.z = a.z * sp;

  if (a.moving) {
    facing.x = a.x; facing.z = a.z;
    if (a.x < -0.1) flipSign = 1;
    else if (a.x > 0.1) flipSign = -1;
    player.bob += dt * 13;
  } else {
    player.bob += dt * 3;
  }

  // recoil while spraying
  player.recoil += ((spraying() ? 1 : 0) - player.recoil) * Math.min(1, dt * 12);
}

function syncPlayer() {
  const b = player.body;
  b.position.y = PLAYER_R; b.velocity.y = 0;
  // clamp inside the room as a safety net
  b.position.x = THREE.MathUtils.clamp(b.position.x, -ROOM.halfX + 1, ROOM.halfX - 1);
  b.position.z = THREE.MathUtils.clamp(b.position.z, ROOM.backZ + 1.4, ROOM.frontZ - 1.2);

  player.group.position.set(b.position.x, 0, b.position.z);
  player.sprite.position.y = Math.abs(Math.sin(player.bob) * 0.1);
  player.sprite.rotation.y = billboardY(player.group.position);
  // squash-stretch + recoil tilt
  const sq = 1 + Math.sin(player.bob) * 0.035 - player.recoil * 0.06;
  player.sprite.scale.set(flipSign * (2 - sq), sq, 1);
  player.sprite.rotation.z = -player.recoil * 0.1 * flipSign;
  player.shadow.position.set(b.position.x, 0.04, b.position.z);
}

function billboardY(pos) {
  return Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z);
}

/* ============================================================
   UPDATE — SPRAY
   ============================================================ */
let sprayActive = false;
function updateSpray(dt) {
  const on = spraying();
  if (on !== sprayActive) { sprayActive = on; AudioFX.setSpray(on); }

  // muzzle position (the Raid can, in front of Modi at hand height)
  const px = player.body.position.x, pz = player.body.position.z;
  sprayMuzzle.set(px + facing.x * 1.15, SPRAY.muzzleY, pz + facing.z * 1.15);

  if (on) {
    S.sprayMeter = Math.max(0, S.sprayMeter - SPRAY.drain * dt);
    S.sprays += dt;
    // emit fine mist puffs from the can muzzle
    for (let i = 0; i < 2; i++) {
      const spread = 0.42;
      const vx = facing.x + (Math.random() - 0.5) * spread;
      const vz = facing.z + (Math.random() - 0.5) * spread;
      particles.emit(
        sprayMuzzle.x + (Math.random() - 0.5) * 0.18, sprayMuzzle.y + (Math.random() - 0.5) * 0.25,
        sprayMuzzle.z + (Math.random() - 0.5) * 0.18,
        vx * 5, 0.3 + Math.random() * 1.1, vz * 5,
        '#d6fbf6', 0.16 + Math.random() * 0.18, 0.42 + Math.random() * 0.3, 1.6);
    }
    // hit-test roaches inside the cone
    let didHit = false;
    for (const r of roaches) {
      if (r.dead) continue;
      const dx = r.group.position.x - sprayMuzzle.x;
      const dz = r.group.position.z - sprayMuzzle.z;
      const d = Math.hypot(dx, dz);
      if (d > SPRAY.range || d < 0.2) continue;
      const dot = (dx / d) * facing.x + (dz / d) * facing.z;
      if (dot < SPRAY.cone) continue;
      // in the cone — douse it
      r.poison += SPRAY.power * dt;
      r.tint = 1; r.state = 'flee'; r.repick = 0.25;
      didHit = true;
      if (r.poison >= r.hp) killRoach(r);
    }
    if (didHit) S.hits += dt;
  } else {
    S.sprayMeter = Math.min(100, S.sprayMeter + SPRAY.recharge * dt);
  }
}

/* ============================================================
   UPDATE — ROACHES
   ============================================================ */
function updateRoaches(dt) {
  for (let i = roaches.length - 1; i >= 0; i--) {
    const r = roaches[i];

    if (r.dead) {
      r.deadT += dt;
      r.body.position.y = Math.max(ROACH_R, r.body.position.y);
      r.group.position.set(r.body.position.x, r.body.position.y - ROACH_R, r.body.position.z);
      r.sprite.rotation.z += r.spin * dt;
      r.spin *= (1 - dt * 2);
      if (r.deadT > 0.7) {
        const k = Math.min(1, (r.deadT - 0.7) / 0.6);
        r.sprite.material.opacity = 1 - k;
        r.shadow.material.opacity = (1 - k) * 0.7;
      }
      if (r.deadT > 1.35) removeRoach(r, i);
      continue;
    }

    // ---- AI steering ----
    r.repick -= dt;
    r.touchCD -= dt;
    const ppos = player.body.position;
    const toPlayer = new THREE.Vector3(ppos.x - r.body.position.x, 0, ppos.z - r.body.position.z);
    const distToPlayer = toPlayer.length();

    let desired;
    if (r.state === 'flee') {
      desired = new THREE.Vector3(r.body.position.x - ppos.x, 0, r.body.position.z - ppos.z)
        .normalize().multiplyScalar(CFG.roachPanic);
      if (r.repick <= 0) { r.state = 'wander'; pickRoachTarget(r); }
    } else {
      if (r.repick <= 0) pickRoachTarget(r);
      desired = new THREE.Vector3(r.target.x - r.body.position.x, 0, r.target.z - r.body.position.z);
      if (desired.length() < 0.6) pickRoachTarget(r);
      desired.normalize().multiplyScalar(r.speed);
    }
    // erratic roach jitter
    const j = r.state === 'flee' ? 0.6 : 1.4;
    desired.x += (Math.random() - 0.5) * j;
    desired.z += (Math.random() - 0.5) * j;
    r.body.velocity.x = desired.x;
    r.body.velocity.z = desired.z;
    r.body.position.y = ROACH_R; r.body.velocity.y = 0;

    // ---- touch the player → composure damage ----
    if (distToPlayer < PLAYER_R + ROACH_R + 0.25 && r.touchCD <= 0) {
      r.touchCD = 1.1;
      S.composure = Math.max(0, S.composure - CFG.touchDmg);
      AudioFX.hurt();
      shake(0.7);
      damageFlash();
      popText(ppos.x, 2.4, ppos.z, '-' + CFG.touchDmg, true);
      // knock the roach away
      const away = toPlayer.clone().normalize().multiplyScalar(-7);
      r.body.velocity.x = away.x; r.body.velocity.z = away.z;
      r.state = 'flee'; r.repick = 0.5;
    }

    // ---- visuals ----
    r.bob += dt * (10 + r.speed * 3);
    r.group.position.set(r.body.position.x, 0, r.body.position.z);
    r.sprite.position.y = Math.abs(Math.sin(r.bob) * 0.06);
    r.sprite.rotation.y = billboardY(r.group.position);
    const vx = r.body.velocity.x;
    if (vx < -0.4) r.flip = 1; else if (vx > 0.4) r.flip = -1;
    r.sprite.scale.set(r.flip * (1 + Math.sin(r.bob) * 0.06), 1 + Math.cos(r.bob) * 0.05, 1);
    r.shadow.position.set(r.body.position.x, 0.04, r.body.position.z);

    // poison tint fade
    r.tint = Math.max(0, r.tint - dt * 2.5);
    r.sprite.material.color.setRGB(1 - r.tint * 0.5, 1, 1 - r.tint * 0.5);
    r.poison = Math.max(0, r.poison - dt * 0.35);   // slowly recover if not sprayed
  }
}

/* ============================================================
   SPAWNER
   ============================================================ */
function updateSpawner(dt) {
  const aliveCount = roaches.filter((r) => !r.dead).length;
  const need = CFG.target - S.killed;
  if (need <= 0) return;
  S.spawnTimer -= dt;
  if (S.spawnTimer <= 0 && aliveCount < CFG.maxAlive && (S.spawned - S.killed) < need) {
    spawnRoach();
    S.spawnTimer = CFG.spawnEvery * (0.7 + Math.random() * 0.6);
  }
}

/* ============================================================
   HUD + FX
   ============================================================ */
function updateHUD() {
  $('score-val').textContent = S.score.toLocaleString();
  $('roach-killed').textContent = S.killed;

  const comp = $('composure-fill');
  comp.style.width = S.composure + '%';
  comp.className = 'hud__bar-fill' + (S.composure <= 30 ? ' is-low' : S.composure <= 60 ? ' is-mid' : '');

  const spray = $('spray-fill');
  spray.style.width = S.sprayMeter + '%';
  spray.className = 'hud__bar-fill' + (S.sprayMeter < 12 ? ' is-empty' : '');
}

function popText(wx, wy, wz, text, bad) {
  const v = new THREE.Vector3(wx, wy, wz).project(camera);
  const el = document.createElement('div');
  el.className = 'fx-pop' + (bad ? ' fx-pop--bad' : '');
  el.textContent = text;
  el.style.left = (v.x * 0.5 + 0.5) * innerWidth + 'px';
  el.style.top = (-v.y * 0.5 + 0.5) * innerHeight + 'px';
  $('fx-layer').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
function showCombo(n) {
  const el = $('combo');
  el.textContent = 'COMBO ×' + n + '!';
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function damageFlash() {
  let f = document.querySelector('.damage-flash');
  if (!f) { f = document.createElement('div'); f.className = 'damage-flash'; document.body.appendChild(f); }
  f.classList.remove('hit'); void f.offsetWidth; f.classList.add('hit');
}
function shake(amt) { S.shake = Math.min(1.2, S.shake + amt); }

/* ============================================================
   GAME FLOW
   ============================================================ */
function countdown() {
  const el = $('countdown'); const span = el.querySelector('span');
  el.hidden = false;
  let n = 3;
  const tick = () => {
    span.textContent = n > 0 ? n : 'GO!';
    span.style.animation = 'none'; void span.offsetWidth; span.style.animation = '';
    AudioFX.ui();
    if (n < 0) { el.hidden = true; startGame(); return; }
    n--; setTimeout(tick, 1000);
  };
  tick();
}
function startGame() {
  hud.hidden = false;
  S.running = true;
  clock.getDelta();
}
function togglePause() {
  if (!S.running || S.over) return;
  S.paused = !S.paused;
  $('pause').hidden = !S.paused;
  AudioFX.setSpray(false); sprayActive = false;
  AudioFX.ui();
}
function endGame(win) {
  if (S.over) return;
  S.over = true; S.running = false;
  AudioFX.setSpray(false); sprayActive = false;

  $('result-emoji').textContent = win ? '🏆' : '🪳';
  $('result-title').textContent = win ? 'Office Secured!' : 'Office Overrun!';
  $('result-sub').textContent = win
    ? 'The infestation has been crushed. Wah, Modi ji!'
    : 'The roaches wore down the PM. Try again!';

  const acc = S.sprays > 0 ? Math.round((S.hits / S.sprays) * 100) : 0;
  const stars = win ? (S.composure > 66 ? 3 : S.composure > 33 ? 2 : 1) : 0;
  $('result-stats').innerHTML = `
    <div class="stat"><b>${S.killed}/${CFG.target}</b><small>EXTERMINATED</small></div>
    <div class="stat"><b>×${S.bestCombo}</b><small>BEST COMBO</small></div>
    <div class="stat"><b>${Math.round(S.composure)}%</b><small>COMPOSURE</small></div>
    <div class="stat"><b>${S.score.toLocaleString()}</b><small>SCORE</small></div>
    <div class="stat"><b>${acc}%</b><small>SPRAY ACCURACY</small></div>
    <div class="stat"><b>${'★'.repeat(stars) + '☆'.repeat(3 - stars)}</b><small>RATING</small></div>`;
  $('result').hidden = false;
  win ? AudioFX.win() : AudioFX.lose();
}

/* ============================================================
   MAIN LOOP
   ============================================================ */
function loop() {
  let dt = clock.getDelta();
  dt = Math.min(dt, 0.05);

  if (S.running && !S.paused && !S.over) {
    S.time += dt;
    if (DEV) autopilot();
    updatePlayer(dt);
    world.step(1 / 60, dt, 4);
    syncPlayer();
    updateSpray(dt);
    updateRoaches(dt);
    updateSpawner(dt);
    updateHUD();

    if (S.killed >= CFG.target) endGame(true);
    else if (S.composure <= 0) endGame(false);
  }

  // particles + ambient run even on menus for life
  if (particles) particles.update(dt);
  animateAmbient(dt);

  // camera shake
  S.shake = Math.max(0, S.shake - dt * 3);
  const sh = S.shake * 0.18;
  camera.position.set(
    camBase.x + (Math.random() - 0.5) * sh,
    camBase.y + (Math.random() - 0.5) * sh,
    camBase.z + (Math.random() - 0.5) * sh);
  camera.lookAt(camLook);

  renderer.render(scene, camera);
}

let ambT = 0;
function animateAmbient(dt) {
  ambT += dt;
  for (const f of flags) f.rotation.y = Math.sin(ambT * 2 + f.position.x) * 0.22;
  if (officeClock.min) {
    officeClock.min.rotation.z = -ambT * 0.5;
    officeClock.hour.rotation.z = -ambT * 0.04;
  }
}

/* ============================================================
   UTIL
   ============================================================ */
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
