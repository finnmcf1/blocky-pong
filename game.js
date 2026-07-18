// Pixel Pitch — a Minecraft-styled soccer-pong game.
// Single player (left) vs AI (right). First to 3 points wins.

'use strict';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------
const W = 960, H = 540;
const FLOOR_Y = H - 64;          // top of the grass floor
const WALL_W = 12;               // back wall thickness
const WIN_SCORE = 3;

// Soccer goals: the opening covers a bit over half the playfield height above
// the floor. Balls that hit the wall above the goal (or the crossbar) bounce back.
const GOAL_H = Math.round(FLOOR_Y * 0.55);
const GOAL_TOP = FLOOR_Y - GOAL_H;
const GOAL_DEPTH = 38;           // how far the crossbar/net sticks into the field
const CROSSBAR_T = 12;
const POST_T = 8;                // thickness of the goal posts
const WALL_BOUNCE = 0.85;
const CROSSBAR_BOUNCE = 0.75;

const CHAR_SPEED = 420;          // player horizontal speed (px/s)
const CHAR_JUMP = -980;
const CHAR_GRAVITY = 2600;

const BALL_R = 14;
const BALL_GRAVITY = 1350;
const BALL_MAX_SPEED = 1500;
const FLOOR_BOUNCE = 0.88;
const CEIL_BOUNCE = 0.9;

const HIT_BASE_SPEED = 560;      // outgoing ball speed on a character hit
const HIT_RALLY_RAMP = 55;       // extra speed per rally hit
const HIT_RALLY_CAP = 8;
const HIT_COOLDOWN = 0.25;

// AI difficulty presets — speed (px/s, player is 420), reaction (seconds
// between "looks" at the ball), noise (px of aiming error), jumpChance
// (per-frame probability while the ball is in jumping range)
const DIFFICULTIES = {
  easy:   { id: 'easy',   name: 'EASY',   speed: 230, reaction: 0.30, noise: 75, jumpChance: 0.07 },
  normal: { id: 'normal', name: 'NORMAL', speed: 300, reaction: 0.18, noise: 42, jumpChance: 0.15 },
  hard:   { id: 'hard',   name: 'HARD',   speed: 385, reaction: 0.09, noise: 16, jumpChance: 0.28 },
};
let aiDifficulty = DIFFICULTIES.normal;
const AI_HOME_X = W * 0.74;

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ---------------------------------------------------------------------------
// Sound (WebAudio bleeps, created on first user input)
// ---------------------------------------------------------------------------
let audio = null;

// Goal celebration sample (from finnmcf1/Videogamesounds)
const goalSound = new Audio('sounds/goal.mp3');
goalSound.preload = 'auto';
goalSound.volume = 0.7;
// Blunt kick "thump" for character hits: a fast-dropping low sine plus a
// short burst of low-passed noise for the contact.
function thump() {
  if (!audio) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
  gain.gain.setValueAtTime(0.28, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + 0.14);

  const len = Math.floor(audio.sampleRate * 0.03);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const noise = audio.createBufferSource();
  noise.buffer = buf;
  const lp = audio.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 850;
  const ng = audio.createGain();
  ng.gain.value = 0.14;
  noise.connect(lp).connect(ng).connect(audio.destination);
  noise.start(t);
}

// Schedule one chiptune note at an absolute WebAudio time.
function playNote(freq, when, dur, type = 'square', vol = 0.06) {
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.01);
  g.gain.setValueAtTime(vol, when + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  osc.connect(g).connect(audio.destination);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

// End-of-match jingle: an upbeat 8-bit fanfare when the player wins, a short
// downbeat sting when the AI wins. Delayed so the goal sample lands first.
function playVictoryMusic(won) {
  if (!audio) return;
  const t0 = audio.currentTime + 0.6;
  if (won) {
    const b = 0.16;                      // beat length in seconds
    const melody = [                     // [freq, startBeat, durBeats] — C major fanfare
      [523, 0, 1], [659, 1, 1], [784, 2, 1], [1047, 3, 2],
      [784, 5, 1], [1047, 6, 3],
      [880, 9.5, 1], [988, 10.5, 1], [1047, 11.5, 3.5],
    ];
    const bass = [
      [131, 0, 2], [165, 2, 2], [196, 4, 2], [131, 6, 3],
      [175, 9.5, 2], [196, 11.5, 3.5],
    ];
    for (const [f, s, d] of melody) playNote(f, t0 + s * b, d * b, 'square', 0.07);
    for (const [f, s, d] of bass) playNote(f, t0 + s * b, d * b, 'triangle', 0.09);
  } else {
    const b = 0.22;
    const sting = [[659, 0, 1], [622, 1, 1], [587, 2, 1], [554, 3, 3]];
    for (const [f, s, d] of sting) playNote(f, t0 + s * b, d * b, 'triangle', 0.08);
  }
}

function beep(freq, dur = 0.07, type = 'square', vol = 0.04) {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + dur);
}

// ---------------------------------------------------------------------------
// Sprite generation — blocky Steve-like characters drawn as pixel art.
// Grid is 16x32 "minecraft pixels", scaled 3x -> 48x96 canvas.
// ---------------------------------------------------------------------------
const SPR_SCALE = 3;
const SPR_W = 16 * SPR_SCALE, SPR_H = 32 * SPR_SCALE;

function makeCharSprite(c, swingSide) {
  const cv = document.createElement('canvas');
  cv.width = SPR_W;
  cv.height = SPR_H;
  const g = cv.getContext('2d');
  const p = (x, y, w, h, color) => {
    g.fillStyle = color;
    g.fillRect(x * SPR_SCALE, y * SPR_SCALE, w * SPR_SCALE, h * SPR_SCALE);
  };

  // Head (x 4-11)
  p(4, 0, 8, 2, c.hair);            // hair top
  p(4, 2, 8, 6, c.skin);            // face
  p(4, 2, 1, 2, c.hair);            // hair sides
  p(11, 2, 1, 2, c.hair);
  p(5, 4, 2, 1, '#ffffff');         // eyes
  p(6, 4, 1, 1, c.eye);
  p(9, 4, 2, 1, '#ffffff');
  p(9, 4, 1, 1, c.eye);
  p(7, 6, 2, 1, c.mouth);           // mouth

  // Body (x 4-11, rows 8-19)
  p(4, 8, 8, 12, c.shirt);
  p(4, 8, 8, 1, c.shirtDark);       // collar shading

  // Arms (2 wide). Sleeves on top, skin below.
  const arm = (x) => {
    p(x, 8, 2, 4, c.shirt);
    p(x, 12, 2, 7, c.skin);
    p(x, 19, 2, 1, c.skinDark);     // hand
  };
  if (swingSide === 'left') {
    // left arm raised horizontally toward the net
    p(0, 10, 4, 2, c.skin);
    p(0, 10, 1, 2, c.skinDark);
    arm(12);
  } else if (swingSide === 'right') {
    arm(2);
    p(12, 10, 4, 2, c.skin);
    p(15, 10, 1, 2, c.skinDark);
  } else {
    arm(2);
    arm(12);
  }

  // Legs (rows 20-31)
  p(4, 20, 8, 8, c.pants);
  p(7, 20, 1, 8, c.pantsDark);      // gap shading between legs
  p(4, 28, 3, 4, c.shoes);
  p(9, 28, 3, 4, c.shoes);

  return cv;
}

const PLAYER_COLORS = {
  skin: '#c68e63', skinDark: '#a3714c', hair: '#4a2f1b', eye: '#3d2fb5',
  mouth: '#8a5f41', shirt: '#00a5a5', shirtDark: '#007d7d',
  pants: '#3b4da0', pantsDark: '#2d3b7d', shoes: '#555555',
};
const AI_COLORS = {
  skin: '#c68e63', skinDark: '#a3714c', hair: '#1d1d1d', eye: '#8a1616',
  mouth: '#8a5f41', shirt: '#c9342c', shirtDark: '#9c2620',
  pants: '#3a3a3a', pantsDark: '#2a2a2a', shoes: '#1c1c1c',
};

// ---------------------------------------------------------------------------
// Persistence (localStorage) + player stats
// ---------------------------------------------------------------------------
const STORE_PREFIX = 'pixelPitch.';
// one-time migration of saved progress from the game's old name
try {
  if (!localStorage.getItem('pixelPitch.stats') && localStorage.getItem('blockyPong.stats')) {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('blockyPong.')) {
        localStorage.setItem(STORE_PREFIX + k.slice('blockyPong.'.length), localStorage.getItem(k));
      }
    }
  }
} catch {}

const store = {
  get(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_PREFIX + key));
      return v === null || v === undefined ? fallback : v;
    } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(STORE_PREFIX + key, JSON.stringify(val)); } catch {}
  },
};

const stats = Object.assign(
  { wins: 0, losses: 0, streak: 0, bestStreak: 0, fastestWinMs: null },
  store.get('stats', {})
);

aiDifficulty = DIFFICULTIES[store.get('difficulty', 'normal')] || DIFFICULTIES.normal;

// ---------------------------------------------------------------------------
// Skins — palettes for makeCharSprite, unlocked by total match wins
// ---------------------------------------------------------------------------
const BASE_FACE = { skin: '#c68e63', skinDark: '#a3714c', mouth: '#8a5f41' };
const SKINS = [
  { id: 'classic', name: 'CLASSIC', unlockWins: 0, colors: PLAYER_COLORS },
  { id: 'crimson', name: 'CRIMSON', unlockWins: 1, colors: { ...BASE_FACE,
    hair: '#222222', eye: '#5c0f0f', shirt: '#b71c1c', shirtDark: '#7f1010',
    pants: '#263238', pantsDark: '#1a2327', shoes: '#444444' } },
  { id: 'forest', name: 'FOREST', unlockWins: 3, colors: { ...BASE_FACE,
    hair: '#6d4c41', eye: '#1b5e20', shirt: '#388e3c', shirtDark: '#27632a',
    pants: '#5d4037', pantsDark: '#46302a', shoes: '#33291f' } },
  { id: 'ninja', name: 'NINJA', unlockWins: 5, colors: { ...BASE_FACE,
    hair: '#111111', eye: '#b71c1c', shirt: '#212121', shirtDark: '#111111',
    pants: '#212121', pantsDark: '#151515', shoes: '#000000' } },
  { id: 'royal', name: 'ROYAL', unlockWins: 8, colors: { ...BASE_FACE,
    hair: '#3e2723', eye: '#4a148c', shirt: '#6a1b9a', shirtDark: '#4a1370',
    pants: '#f9a825', pantsDark: '#c17f1a', shoes: '#3e2723' } },
  { id: 'ice', name: 'ICE', unlockWins: 12, colors: { ...BASE_FACE,
    hair: '#eceff1', eye: '#0277bd', shirt: '#b3e5fc', shirtDark: '#81c7e8',
    pants: '#90caf9', pantsDark: '#6da8d6', shoes: '#546e7a' } },
  { id: 'blaze', name: 'BLAZE', unlockWins: 16, colors: { ...BASE_FACE,
    hair: '#3e2723', eye: '#e65100', shirt: '#ff6f00', shirtDark: '#c65600',
    pants: '#d32f2f', pantsDark: '#a02525', shoes: '#4e342e' } },
  { id: 'gold', name: 'GOLD', unlockWins: 20, colors: { ...BASE_FACE,
    hair: '#fdd835', eye: '#795548', shirt: '#fdd835', shirtDark: '#c9a929',
    pants: '#f9a825', pantsDark: '#c17f1a', shoes: '#8d6e63' } },
];

const sprites = {
  playerIdle: makeCharSprite(PLAYER_COLORS, null),
  playerSwing: makeCharSprite(PLAYER_COLORS, 'right'),  // player faces right
  aiIdle: makeCharSprite(AI_COLORS, null),
  aiSwing: makeCharSprite(AI_COLORS, 'left'),           // AI faces left
};
for (const s of SKINS) s.preview = makeCharSprite(s.colors, null);

let currentSkinId = 'classic';
function applySkin(id) {
  const skin = SKINS.find(s => s.id === id && stats.wins >= s.unlockWins) || SKINS[0];
  sprites.playerIdle = makeCharSprite(skin.colors, null);
  sprites.playerSwing = makeCharSprite(skin.colors, 'right');
  currentSkinId = skin.id;
  store.set('skin', skin.id);
}
applySkin(store.get('skin', 'classic'));

// The AI wears a random skin each match — never the one the player has on.
function randomizeAiSkin() {
  const pool = SKINS.filter(s => s.id !== currentSkinId);
  const skin = pool[(Math.random() * pool.length) | 0];
  sprites.aiIdle = makeCharSprite(skin.colors, null);
  sprites.aiSwing = makeCharSprite(skin.colors, 'left');
}
randomizeAiSkin();

// Soccer ball sprite: pixel circle, white with a center pentagon and five
// rim patches spaced evenly (72 degrees apart) so the ball looks the same
// from every side as it spins.
function makeBallSprite() {
  const grid = 14, s = 2;                 // 14x14 pixels at 2x -> 28x28
  const cv = document.createElement('canvas');
  cv.width = cv.height = grid * s;
  const g = cv.getContext('2d');
  const c = (grid - 1) / 2, r2 = (grid / 2) * (grid / 2);
  const blobs = [[c, c, 2.3]];            // [x, y, radius] center pentagon
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + k * (2 * Math.PI / 5);
    blobs.push([c + Math.cos(a) * 6.4, c + Math.sin(a) * 6.4, 2.1]);
  }
  const inPatch = (x, y) =>
    blobs.some(([bx, by, br]) => (x - bx) ** 2 + (y - by) ** 2 <= br * br);
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const dx = x - c, dy = y - c;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      // uniform gray ring just inside the silhouette keeps the shading even
      const rim = d2 > (grid / 2 - 1.4) ** 2;
      g.fillStyle = inPatch(x, y) ? '#1c1c1c' : (rim ? '#cbcbcb' : '#f4f4f4');
      g.fillRect(x * s, y * s, s, s);
    }
  }
  return cv;
}
const ballSprite = makeBallSprite();

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
function makeChar(isPlayer) {
  return {
    isPlayer,
    w: 40, h: SPR_H,                // hitbox (sprite is 48 wide, drawn centered)
    x: 0, y: 0, vx: 0, vy: 0,
    onGround: true,
    hitCooldown: 0,
    swingTimer: 0,
    // AI-only
    targetX: AI_HOME_X,
    lookTimer: 0,
  };
}

const game = {
  // home | gamemodes | leaderboard | skins | countdown | play | score | gameover
  state: 'home',
  stateTimer: 0,
  menuIndex: 0,
  matchStart: 0,
  unlockBanner: null,
  lb: { status: 'idle', rows: [] },
  menuBall: { x: 280, y: 120, vx: 250, vy: 0, spin: 0 },
  playerScore: 0,
  aiScore: 0,
  rallyHits: 0,
  serveDir: Math.random() < 0.5 ? -1 : 1,  // -1 = toward player, 1 = toward AI
  lastScorer: null,
  player: makeChar(true),
  ai: makeChar(false),
  ball: { x: W / 2, y: 150, vx: 0, vy: 0, spin: 0 },
  confetti: [],
  clouds: [
    { x: 90, y: 60, s: 1.0 },
    { x: 420, y: 110, s: 0.7 },
    { x: 700, y: 50, s: 1.2 },
  ],
};

function resetChars() {
  const p = game.player, a = game.ai;
  p.x = W * 0.22 - p.w / 2; p.y = FLOOR_Y - p.h; p.vx = p.vy = 0; p.onGround = true;
  a.x = W * 0.78 - a.w / 2; a.y = FLOOR_Y - a.h; a.vx = a.vy = 0; a.onGround = true;
  p.swingTimer = a.swingTimer = 0;
  p.hitCooldown = a.hitCooldown = 0;
  a.targetX = AI_HOME_X;
}

function serve() {
  resetChars();
  game.ball.x = W / 2;
  game.ball.y = 150;
  game.ball.vx = game.serveDir * 150;
  game.ball.vy = 0;
  game.ball.spin = 0;
  game.rallyHits = 0;
  game.state = 'countdown';
  game.stateTimer = 1.8;
}

function startMatch() {
  game.playerScore = 0;
  game.aiScore = 0;
  game.serveDir = Math.random() < 0.5 ? -1 : 1;
  game.matchStart = Date.now();
  game.unlockBanner = null;
  randomizeAiSkin();
  serve();
}

// ---------------------------------------------------------------------------
// Leaderboard API client (same-origin server.py; failures never break the game)
// ---------------------------------------------------------------------------
function fetchLeaderboard() {
  game.lb = { status: 'loading', rows: [] };
  fetch('/api/leaderboard')
    .then(r => r.json())
    .then(rows => { game.lb = { status: 'ok', rows }; })
    .catch(() => { game.lb = { status: 'offline', rows: [] }; });
}

function submitResult(won) {
  const name = store.get('name', '') || 'Player';
  fetch('/api/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, won,
      score: game.playerScore,
      opponentScore: game.aiScore,
      durationMs: Date.now() - game.matchStart,
    }),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Menus & input
// ---------------------------------------------------------------------------
const keys = {};
let mouse = { x: -1, y: -1 };

function ensureAudio() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
}

function goHome() {
  game.state = 'home';
  game.menuIndex = 0;
  game.confetti.length = 0;
  resetTouchInput();
  resetChars();
}

function enterLeaderboard() {
  game.state = 'leaderboard';
  fetchLeaderboard();
}

const HOME_BUTTONS = [
  { label: 'PLAY', action: () => { game.state = 'playselect'; game.menuIndex = 0; } },
  { label: 'GAMEMODES', action: () => { game.state = 'gamemodes'; } },
  { label: 'LEADERBOARDS', action: enterLeaderboard },
  { label: 'SKINS', action: () => { game.state = 'skins'; } },
].map((b, i) => ({ ...b, x: W / 2 - 160, y: 205 + i * 68, w: 320, h: 54 }));

const PLAY_BUTTONS = [
  { label: 'PLAY LOCAL', action: () => {
    game.state = 'difficulty';
    game.menuIndex = Object.keys(DIFFICULTIES).indexOf(aiDifficulty.id);
  } },
  { label: 'PLAY ONLINE', action: () => { game.state = 'online'; } },
].map((b, i) => ({ ...b, x: W / 2 - 160, y: 240 + i * 68, w: 320, h: 54 }));

const DIFF_BUTTONS = Object.values(DIFFICULTIES).map((d, i) => ({
  label: d.name,
  x: W / 2 - 160, y: 205 + i * 68, w: 320, h: 54,
  action: () => {
    aiDifficulty = d;
    store.set('difficulty', d.id);
    startMatch();
    beep(660, 0.1);
  },
}));
const DIFF_DESC = {
  EASY: 'a gentle opponent — good for warming up',
  NORMAL: 'the classic — a fair fight',
  HARD: 'fast, sharp, and relentless',
};

const BACK_BUTTON = { label: 'BACK', x: 24, y: 20, w: 120, h: 44, action: goHome };
const BACK_TO_PLAY = { label: 'BACK', x: 24, y: 20, w: 120, h: 44,
  action: () => { game.state = 'playselect'; game.menuIndex = 0; } };
const LB_REFRESH = { label: 'REFRESH', x: W - 168, y: 20, w: 144, h: 44, action: fetchLeaderboard };

function skinCardRect(i) {
  const cols = 4, cw = 210, ch = 175, gap = 14;
  const x0 = (W - (cols * cw + (cols - 1) * gap)) / 2;
  return {
    x: x0 + (i % cols) * (cw + gap),
    y: 108 + Math.floor(i / cols) * (ch + gap),
    w: cw, h: ch,
  };
}

function currentButtons() {
  switch (game.state) {
    case 'home': return HOME_BUTTONS;
    case 'playselect': return [BACK_BUTTON, ...PLAY_BUTTONS];
    case 'difficulty': return [BACK_TO_PLAY, ...DIFF_BUTTONS];
    case 'online': return [BACK_TO_PLAY];
    case 'gamemodes': return [BACK_BUTTON];
    case 'leaderboard': return [BACK_BUTTON, LB_REFRESH];
    case 'skins': return [
      BACK_BUTTON,
      ...SKINS.map((s, i) => ({ ...skinCardRect(i), action: () => {
        if (stats.wins >= s.unlockWins) { applySkin(s.id); beep(700, 0.08); }
      } })),
    ];
    default: return [];
  }
}

const hit = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
  ensureAudio();
  const st = game.state;
  if (st === 'home' || st === 'playselect' || st === 'difficulty') {
    const btns = st === 'home' ? HOME_BUTTONS
      : st === 'playselect' ? PLAY_BUTTONS : DIFF_BUTTONS;
    if (e.key === 'ArrowUp') game.menuIndex = (game.menuIndex + btns.length - 1) % btns.length;
    else if (e.key === 'ArrowDown') game.menuIndex = (game.menuIndex + 1) % btns.length;
    else if (e.key === 'Enter' || e.key === ' ') btns[game.menuIndex].action();
    else if (e.key === 'Escape' && st === 'playselect') goHome();
    else if (e.key === 'Escape' && st === 'difficulty') BACK_TO_PLAY.action();
  } else if (st === 'gamemodes' || st === 'leaderboard' || st === 'skins') {
    if (e.key === 'Escape') goHome();
  } else if (st === 'online') {
    if (e.key === 'Escape') BACK_TO_PLAY.action();
  } else if (st === 'gameover') {
    if (e.key === 'Escape') goHome();
    else if (game.stateTimer <= 0) { startMatch(); beep(660, 0.1); }
  } else if (e.key === 'Escape') {
    goHome();                        // quit the current match back to the menu
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

function canvasPosXY(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) * (W / r.width), y: (clientY - r.top) * (H / r.height) };
}
function canvasPos(e) {
  return canvasPosXY(e.clientX, e.clientY);
}
canvas.addEventListener('mousemove', (e) => {
  mouse = canvasPos(e);
  if (game.state === 'home') {
    HOME_BUTTONS.forEach((b, i) => { if (hit(b, mouse)) game.menuIndex = i; });
  }
});
canvas.addEventListener('mousedown', (e) => {
  ensureAudio();
  const p = canvasPos(e);
  for (const b of currentButtons()) {
    if (hit(b, p)) { b.action(); return; }
  }
  if (game.state === 'gameover' && game.stateTimer <= 0) startMatch();
});

// ---------------------------------------------------------------------------
// Touch controls (mobile). Everything here is gated behind touchMode, which
// only flips on a real touch — the desktop experience is untouched.
// ---------------------------------------------------------------------------
let touchMode = false;
const TOUCH_HOME = { x: W - 64, y: 14, w: 48, h: 48, label: '✕' };  // quit to menu
const MATCH_STATES = ['countdown', 'play', 'score', 'gameover'];

// Floating joystick: touching anywhere on the LEFT half spawns a stick under
// the finger; horizontal drag gives analog movement. Anywhere on the RIGHT
// half is the jump zone. Touches are tracked by identifier so both work at
// once and fingers can cross the midline mid-hold.
const JOY_R = 58;            // knob travel radius (canvas px)
const JOY_DEAD = 10;         // ignore tiny wobbles around the center
const joy = { id: null, baseX: 0, baseY: 0, knobX: 0, dir: 0 };
let jumpTouchId = null;
let jumpHeld = false;

function resetTouchInput() {
  joy.id = null;
  joy.dir = 0;
  jumpTouchId = null;
  jumpHeld = false;
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();          // suppress scrolling and synthesized mouse events
  touchMode = true;
  ensureAudio();
  const st = game.state;

  if (!MATCH_STATES.includes(st)) {
    // menu screens: a tap acts like a click
    const p = canvasPosXY(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    for (const b of currentButtons()) {
      if (hit(b, p)) { b.action(); return; }
    }
    return;
  }

  for (const t of e.changedTouches) {
    const p = canvasPosXY(t.clientX, t.clientY);
    if (hit(TOUCH_HOME, p)) { goHome(); return; }
    if (st === 'gameover') {
      if (game.stateTimer <= 0) { startMatch(); return; }
      continue;
    }
    if (p.x < W / 2 && joy.id === null) {
      joy.id = t.identifier;
      joy.baseX = p.x;
      joy.baseY = p.y;
      joy.knobX = p.x;
      joy.dir = 0;
    } else if (p.x >= W / 2 && jumpTouchId === null) {
      jumpTouchId = t.identifier;
      jumpHeld = true;
    }
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== joy.id) continue;
    const p = canvasPosXY(t.clientX, t.clientY);
    const dx = Math.max(-JOY_R, Math.min(JOY_R, p.x - joy.baseX));
    joy.knobX = joy.baseX + dx;
    joy.dir = Math.abs(dx) < JOY_DEAD
      ? 0
      : (dx - Math.sign(dx) * JOY_DEAD) / (JOY_R - JOY_DEAD);
  }
}, { passive: false });

for (const type of ['touchend', 'touchcancel']) {
  canvas.addEventListener(type, (e) => {
    if (e.cancelable) e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) { joy.id = null; joy.dir = 0; }
      if (t.identifier === jumpTouchId) { jumpTouchId = null; jumpHeld = false; }
    }
  }, { passive: false });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function updateChar(ch, dt, moveDir, wantJump) {
  ch.vx = moveDir * (ch.isPlayer ? CHAR_SPEED : aiDifficulty.speed);
  if (wantJump && ch.onGround) {
    ch.vy = CHAR_JUMP;
    ch.onGround = false;
  }
  ch.vy += CHAR_GRAVITY * dt;
  ch.x += ch.vx * dt;
  ch.y += ch.vy * dt;

  if (ch.y + ch.h >= FLOOR_Y) {
    ch.y = FLOOR_Y - ch.h;
    ch.vy = 0;
    ch.onGround = true;
  }
  // confine to own half
  const minX = ch.isPlayer ? WALL_W + 2 : W / 2 + 4;
  const maxX = ch.isPlayer ? W / 2 - ch.w - 4 : W - WALL_W - 2 - ch.w;
  ch.x = Math.max(minX, Math.min(maxX, ch.x));

  ch.hitCooldown = Math.max(0, ch.hitCooldown - dt);
  ch.swingTimer = Math.max(0, ch.swingTimer - dt);
}

function updateAI(dt) {
  const a = game.ai, b = game.ball;
  a.lookTimer -= dt;
  if (a.lookTimer <= 0) {
    a.lookTimer = aiDifficulty.reaction;
    const incoming = b.vx > -60 || b.x > W / 2;
    a.targetX = incoming
      ? b.x + (Math.random() * 2 - 1) * aiDifficulty.noise
      : AI_HOME_X;
  }
  const cx = a.x + a.w / 2;
  const dx = a.targetX - cx;
  const moveDir = Math.abs(dx) > 8 ? Math.sign(dx) : 0;

  // jump at falling balls that are close and overhead
  const close = Math.abs(b.x - cx) < 120;
  const overhead = b.y < a.y + 20 && b.y > 60;
  const wantJump = close && overhead && b.vy > 0 && Math.random() < aiDifficulty.jumpChance;

  updateChar(a, dt, moveDir, wantJump);
}

function hitBall(ch) {
  const b = game.ball;
  const cx = ch.x + ch.w / 2;
  const cy = ch.y + ch.h / 2;
  const dir = ch.isPlayer ? 1 : -1;

  game.rallyHits = Math.min(game.rallyHits + 1, HIT_RALLY_CAP);
  const speed = HIT_BASE_SPEED + HIT_RALLY_RAMP * game.rallyHits;

  // contact height on the character: -1 = head, 1 = feet
  const relY = Math.max(-1, Math.min(1, (b.y - cy) / (ch.h / 2 + BALL_R)));
  // low contact -> steeper upward launch, high contact -> flatter shot
  const up = 0.35 + 0.28 * (relY + 1) / 2;

  b.vx = dir * speed * (1 - up * 0.45) + ch.vx * 0.35;
  b.vy = -speed * up + ch.vy * 0.35;

  // always send it toward the opponent with real pace
  if (b.vx * dir < 220) b.vx = dir * 220;

  ch.hitCooldown = HIT_COOLDOWN;
  ch.swingTimer = 0.22;
  thump();
}

function collideBallChar(ch) {
  if (ch.hitCooldown > 0) return;
  const b = game.ball;
  const nearX = Math.max(ch.x, Math.min(b.x, ch.x + ch.w));
  const nearY = Math.max(ch.y, Math.min(b.y, ch.y + ch.h));
  const dx = b.x - nearX, dy = b.y - nearY;
  if (dx * dx + dy * dy <= BALL_R * BALL_R) {
    // push the ball out of the overlap before applying the hit
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    b.x = nearX + (dx / dist) * (BALL_R + 1);
    b.y = nearY + (dy / dist) * (BALL_R + 1);
    hitBall(ch);
  }
}

const CONFETTI_COLORS = ['#ff5252', '#ffd740', '#40c4ff', '#69f0ae', '#ff4081', '#e040fb', '#ffffff'];
// all-blue burst for the player's own goals
const CONFETTI_BLUE = ['#2196f3', '#64b5f6', '#0d47a1', '#4fc3f7', '#bbdefb', '#00b0ff', '#ffffff'];
function spawnConfetti(x, y, colors = CONFETTI_COLORS) {
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 150 + Math.random() * 420;
    game.confetti.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 260,      // bias the burst upward
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 12,
      w: 5 + Math.random() * 4,
      h: 3 + Math.random() * 3,
      color: colors[(Math.random() * colors.length) | 0],
      life: 1.8 + Math.random() * 0.9,
    });
  }
}

function updateConfetti(dt) {
  for (let i = game.confetti.length - 1; i >= 0; i--) {
    const p = game.confetti[i];
    p.vy += 420 * dt;                  // light gravity: confetti flutters down
    p.vx *= 0.99;
    p.vy *= 0.99;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    p.life -= dt;
    if (p.y >= FLOOR_Y) {              // settle on the grass and fade out
      p.y = FLOOR_Y;
      p.vy = 0;
      p.vx *= 0.9;
      p.vrot = 0;
    }
    if (p.life <= 0) game.confetti.splice(i, 1);
  }
}

function scorePoint(scorer) {
  if (scorer === 'player') game.playerScore++;
  else game.aiScore++;
  game.lastScorer = scorer;
  game.serveDir = scorer === 'player' ? 1 : -1; // serve toward whoever conceded
  goalSound.currentTime = 0;
  goalSound.play().catch(() => {});
  const gx = scorer === 'player' ? W - WALL_W - GOAL_DEPTH / 2 : WALL_W + GOAL_DEPTH / 2;
  spawnConfetti(gx, GOAL_TOP + GOAL_H * 0.35,
    scorer === 'player' ? CONFETTI_BLUE : CONFETTI_COLORS);

  if (game.playerScore >= WIN_SCORE || game.aiScore >= WIN_SCORE) {
    game.state = 'gameover';
    game.stateTimer = 0.8;          // brief input lockout so key mashing can't skip the win screen
    const won = game.playerScore > game.aiScore;
    playVictoryMusic(won);
    recordMatchEnd(won);
  } else {
    game.state = 'score';
    game.stateTimer = 1.1;
  }
}

function recordMatchEnd(won) {
  const prevWins = stats.wins;
  if (won) {
    stats.wins++;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    const ms = Date.now() - game.matchStart;
    if (stats.fastestWinMs === null || ms < stats.fastestWinMs) stats.fastestWinMs = ms;
    const unlocked = SKINS.filter(s => s.unlockWins > prevWins && s.unlockWins <= stats.wins);
    if (unlocked.length) game.unlockBanner = unlocked.map(s => s.name).join(', ');
  } else {
    stats.losses++;
    stats.streak = 0;
  }
  store.set('stats', stats);
  submitResult(won);
}

function updateBall(dt) {
  const b = game.ball;
  // two substeps to keep fast balls from tunneling through characters
  for (let i = 0; i < 2; i++) {
    const sdt = dt / 2;
    b.vy += BALL_GRAVITY * sdt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > BALL_MAX_SPEED) {
      b.vx *= BALL_MAX_SPEED / sp;
      b.vy *= BALL_MAX_SPEED / sp;
    }
    b.x += b.vx * sdt;
    b.y += b.vy * sdt;

    if (b.y + BALL_R >= FLOOR_Y) {
      b.y = FLOOR_Y - BALL_R;
      if (Math.abs(b.vy) > 90) beep(160, 0.05, 'sine', 0.04);
      b.vy = -b.vy * FLOOR_BOUNCE;
      b.vx *= 0.995;
    }
    if (b.y - BALL_R <= 0) {
      b.y = BALL_R;
      b.vy = -b.vy * CEIL_BOUNCE;
    }

    collideBallChar(game.player);
    collideBallChar(game.ai);
    collideCrossbar(-1);
    collideCrossbar(1);

    // back walls: goal if the ball crosses the wall plane inside the goal
    // mouth, otherwise it bounces back into play
    if (b.x - BALL_R <= WALL_W) {
      if (b.y > GOAL_TOP) { scorePoint('ai'); return; }
      b.x = WALL_W + BALL_R;
      b.vx = -b.vx * WALL_BOUNCE;
      beep(200, 0.05, 'sine', 0.04);
    }
    if (b.x + BALL_R >= W - WALL_W) {
      if (b.y > GOAL_TOP) { scorePoint('player'); return; }
      b.x = W - WALL_W - BALL_R;
      b.vx = -b.vx * WALL_BOUNCE;
      beep(200, 0.05, 'sine', 0.04);
    }

    b.spin += (b.vx / BALL_R) * sdt * 0.6;
  }
}

// The crossbar sticking out over each goal mouth is solid: reflect the ball
// off its nearest face. side: -1 = left goal, 1 = right goal.
function collideCrossbar(side) {
  const b = game.ball;
  const rx = side === -1 ? WALL_W : W - WALL_W - GOAL_DEPTH;
  const ry = GOAL_TOP - CROSSBAR_T;
  const nearX = Math.max(rx, Math.min(b.x, rx + GOAL_DEPTH));
  const nearY = Math.max(ry, Math.min(b.y, ry + CROSSBAR_T));
  const dx = b.x - nearX, dy = b.y - nearY;
  if (dx * dx + dy * dy > BALL_R * BALL_R) return;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist, ny = dy / dist;
  b.x = nearX + nx * (BALL_R + 1);
  b.y = nearY + ny * (BALL_R + 1);
  const dot = b.vx * nx + b.vy * ny;
  if (dot < 0) {
    b.vx -= (1 + CROSSBAR_BOUNCE) * dot * nx;
    b.vy -= (1 + CROSSBAR_BOUNCE) * dot * ny;
    beep(520, 0.06, 'square', 0.05);
  }
}

function update(dt) {
  for (const c of game.clouds) {
    c.x += 8 * c.s * dt;
    if (c.x > W + 80) c.x = -140;
  }
  updateConfetti(dt);

  if (game.state === 'home') {
    // ambient ball bouncing around behind the menu
    const mb = game.menuBall;
    mb.vy += 1000 * dt;
    mb.x += mb.vx * dt;
    mb.y += mb.vy * dt;
    if (mb.y > FLOOR_Y - BALL_R) { mb.y = FLOOR_Y - BALL_R; mb.vy = -640; }
    if (mb.x < WALL_W + BALL_R) { mb.x = WALL_W + BALL_R; mb.vx = Math.abs(mb.vx); }
    if (mb.x > W - WALL_W - BALL_R) { mb.x = W - WALL_W - BALL_R; mb.vx = -Math.abs(mb.vx); }
    mb.spin += (mb.vx / BALL_R) * dt * 0.6;
    return;
  }
  if (['playselect', 'difficulty', 'online', 'gamemodes', 'leaderboard', 'skins']
      .includes(game.state)) return;
  if (game.state === 'gameover') {
    game.stateTimer -= dt;
    return;
  }

  // keyboard is digital, the joystick is analog — clamp their sum
  const moveDir = Math.max(-1, Math.min(1,
    (keys['a'] || keys['arrowleft'] ? -1 : 0) +
    (keys['d'] || keys['arrowright'] ? 1 : 0) +
    joy.dir));
  const wantJump = keys['w'] || keys['arrowup'] || keys[' '] || jumpHeld;
  updateChar(game.player, dt, moveDir, wantJump);
  updateAI(dt);

  if (game.state === 'countdown') {
    game.stateTimer -= dt;
    if (game.stateTimer <= 0) game.state = 'play';
  } else if (game.state === 'play') {
    updateBall(dt);
  } else if (game.state === 'score') {
    game.stateTimer -= dt;
    if (game.stateTimer <= 0) serve();
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const DIGITS = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '-': ['000', '000', '111', '000', '000'],
};

function drawDigits(text, centerX, topY, px, color) {
  const chW = 3 * px + px; // glyph + spacing
  const totalW = text.length * chW - px;
  let x = centerX - totalW / 2;
  ctx.fillStyle = color;
  for (const chr of text) {
    const glyph = DIGITS[chr];
    if (glyph) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (glyph[r][c] === '1') ctx.fillRect(x + c * px, topY + r * px, px, px);
        }
      }
    }
    x += chW;
  }
}

function drawCloud(c) {
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const u = 14 * c.s;
  ctx.fillRect(c.x, c.y, 5 * u, u);
  ctx.fillRect(c.x + u, c.y - u, 3 * u, u);
}

function drawArena() {
  // sky
  ctx.fillStyle = '#7ec8e3';
  ctx.fillRect(0, 0, W, H);
  for (const c of game.clouds) drawCloud(c);

  // floor: grass top + dirt blocks
  ctx.fillStyle = '#5d9c3a';
  ctx.fillRect(0, FLOOR_Y, W, 12);
  ctx.fillStyle = '#7b5230';
  ctx.fillRect(0, FLOOR_Y + 12, W, H - FLOOR_Y - 12);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < W; x += 32) {
    ctx.fillRect(x, FLOOR_Y + 12, 1, H - FLOOR_Y - 12);
  }
  for (let y = FLOOR_Y + 12; y < H; y += 26) {
    ctx.fillRect(0, y, W, 1);
  }

  // back walls (stone block columns)
  for (const wx of [0, W - WALL_W]) {
    ctx.fillStyle = '#8d8d8d';
    ctx.fillRect(wx, 0, WALL_W, FLOOR_Y);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let y = 0; y < FLOOR_Y; y += 24) ctx.fillRect(wx, y, WALL_W, 1);
  }

  drawGoal(-1);
  drawGoal(1);

  // center line
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let y = 0; y < FLOOR_Y; y += 28) {
    ctx.fillRect(W / 2 - 2, y, 4, 14);
  }
}

// side: -1 = left goal, 1 = right goal
function drawGoal(side) {
  const x0 = side === -1 ? WALL_W : W - WALL_W - GOAL_DEPTH;

  // net grid inside the goal mouth
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  for (let x = x0; x <= x0 + GOAL_DEPTH; x += 11) {
    ctx.fillRect(x, GOAL_TOP, 1, FLOOR_Y - GOAL_TOP);
  }
  for (let y = GOAL_TOP; y < FLOOR_Y; y += 12) {
    ctx.fillRect(x0, y, GOAL_DEPTH, 1);
  }

  // white frame: back post along the wall + crossbar with a front post stub
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(side === -1 ? WALL_W : W - WALL_W - POST_T, GOAL_TOP, POST_T, FLOOR_Y - GOAL_TOP);
  ctx.fillRect(x0, GOAL_TOP - CROSSBAR_T, GOAL_DEPTH, CROSSBAR_T);
  ctx.fillRect(side === -1 ? x0 + GOAL_DEPTH - POST_T : x0, GOAL_TOP, POST_T, 18);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(x0, GOAL_TOP - 3, GOAL_DEPTH, 3);
}

function drawChar(ch) {
  const sprite = ch.isPlayer
    ? (ch.swingTimer > 0 ? sprites.playerSwing : sprites.playerIdle)
    : (ch.swingTimer > 0 ? sprites.aiSwing : sprites.aiIdle);
  ctx.drawImage(sprite, Math.round(ch.x + ch.w / 2 - SPR_W / 2), Math.round(ch.y));
}

function drawBall(b) {
  ctx.save();
  ctx.translate(Math.round(b.x), Math.round(b.y));
  ctx.rotate(b.spin);
  ctx.drawImage(ballSprite, -BALL_R, -BALL_R, BALL_R * 2, BALL_R * 2);
  ctx.restore();
}

// Blocky Minecraft-style beveled button; highlighted when hovered or selected.
function drawButton(b, selected = false) {
  const hov = selected || hit(b, mouse);
  ctx.fillStyle = hov ? '#8f8f8f' : '#727272';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = hov ? '#c2c2c2' : '#9e9e9e';
  ctx.fillRect(b.x, b.y, b.w, 4);
  ctx.fillRect(b.x, b.y, 4, b.h);
  ctx.fillStyle = '#484848';
  ctx.fillRect(b.x, b.y + b.h - 4, b.w, 4);
  ctx.fillRect(b.x + b.w - 4, b.y, 4, b.h);
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(b.label, b.x + b.w / 2 + 2, b.y + b.h / 2 + 10);
  ctx.fillStyle = hov ? '#fff6ae' : '#ffffff';
  ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 8);
}

function drawHome() {
  drawBall(game.menuBall);
  drawChar(game.player);
  drawChar(game.ai);
  centerText('PIXEL PITCH', 150, 'bold 64px monospace', '#ffffff');
  HOME_BUTTONS.forEach((b, i) => drawButton(b, i === game.menuIndex));
  centerText(touchMode
    ? 'left side: joystick to move — right side: tap to jump'
    : 'A/D or arrows to move — W / Space to jump',
    H - 14, 'bold 16px monospace', '#e8f6ff');
}

function drawPlaySelect() {
  centerText('PLAY', 160, 'bold 48px monospace', '#ffffff');
  PLAY_BUTTONS.forEach((b, i) => drawButton(b, i === game.menuIndex));
  drawButton(BACK_BUTTON);
}

function drawDifficulty() {
  centerText('DIFFICULTY', 150, 'bold 44px monospace', '#ffffff');
  let highlighted = game.menuIndex;
  DIFF_BUTTONS.forEach((b, i) => {
    if (hit(b, mouse)) highlighted = i;
    drawButton(b, i === game.menuIndex);
  });
  const d = Object.values(DIFFICULTIES)[highlighted];
  centerText(DIFF_DESC[d.name] || '', 448, 'bold 18px monospace', '#e8f6ff');
  drawButton(BACK_TO_PLAY);
}

function drawOnline() {
  centerText('PLAY ONLINE', 150, 'bold 48px monospace', '#ffffff');
  centerText('COMING SOON', 270, 'bold 44px monospace', '#fff6ae');
  centerText('online matches are in the works', 320, 'bold 20px monospace', '#e8f6ff');
  drawButton(BACK_TO_PLAY);
}

function drawGamemodes() {
  centerText('GAMEMODES', 150, 'bold 48px monospace', '#ffffff');
  centerText('COMING SOON', 270, 'bold 44px monospace', '#fff6ae');
  centerText('new ways to play are in the works', 320, 'bold 20px monospace', '#e8f6ff');
  drawButton(BACK_BUTTON);
}

function drawLeaderboard() {
  centerText('LEADERBOARDS', 92, 'bold 44px monospace', '#ffffff');
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(180, 116, 600, 340);

  const lb = game.lb;
  if (lb.status === 'loading') {
    centerText('LOADING...', 290, 'bold 28px monospace', '#ffffff');
  } else if (lb.status === 'offline') {
    centerText('OFFLINE', 270, 'bold 34px monospace', '#ffd1d1');
    centerText('could not reach the leaderboard server', 312, 'bold 18px monospace', '#ffffff');
  } else if (!lb.rows.length) {
    centerText('no matches recorded yet', 290, 'bold 22px monospace', '#ffffff');
  } else {
    const myName = String(store.get('name', '')).toLowerCase();
    ctx.textAlign = 'left';
    ctx.font = 'bold 19px monospace';
    ctx.fillStyle = '#fff6ae';
    ctx.fillText('#', 205, 150);
    ctx.fillText('NAME', 255, 150);
    ctx.fillText('W', 565, 150);
    ctx.fillText('L', 630, 150);
    ctx.fillText('STREAK', 690, 150);
    lb.rows.slice(0, 10).forEach((row, i) => {
      const y = 182 + i * 27;
      if (row.name.toLowerCase() === myName) {
        ctx.fillStyle = 'rgba(255,246,174,0.2)';
        ctx.fillRect(190, y - 19, 580, 25);
      }
      ctx.fillStyle = row.name.toLowerCase() === myName ? '#fff6ae' : '#ffffff';
      ctx.fillText(String(i + 1), 205, y);
      ctx.fillText(row.name, 255, y);
      ctx.fillText(String(row.wins), 565, y);
      ctx.fillText(String(row.losses), 630, y);
      ctx.fillText(String(row.bestStreak), 690, y);
    });
  }

  centerText('playing as: ' + (store.get('name', '') || 'Player'),
    H - 14, 'bold 16px monospace', '#e8f6ff');
  drawButton(BACK_BUTTON);
  drawButton(LB_REFRESH);
}

function drawSkins() {
  centerText('SKINS', 76, 'bold 40px monospace', '#ffffff');
  ctx.textAlign = 'right';
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('TOTAL WINS: ' + stats.wins, W - 30, 84);

  SKINS.forEach((s, i) => {
    const r = skinCardRect(i);
    const unlocked = stats.wins >= s.unlockWins;
    const equipped = s.id === currentSkinId;
    const hov = unlocked && hit(r, mouse);
    ctx.fillStyle = hov ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.4)';
    ctx.fillRect(r.x, r.y, r.w, r.h);

    const scale = 1.15, sw = SPR_W * scale, sh = SPR_H * scale;
    ctx.drawImage(s.preview, r.x + (r.w - sw) / 2, r.y + 10, sw, sh);

    ctx.textAlign = 'center';
    ctx.font = 'bold 17px monospace';
    if (!unlocked) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s.name, r.x + r.w / 2, r.y + r.h - 28);
      ctx.fillStyle = '#ffd1d1';
      ctx.fillText('WIN ' + s.unlockWins + ' TO UNLOCK', r.x + r.w / 2, r.y + r.h - 8);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s.name, r.x + r.w / 2, r.y + r.h - 28);
      ctx.fillStyle = equipped ? '#8ff59a' : '#e8f6ff';
      ctx.fillText(equipped ? 'EQUIPPED' : 'CLICK TO EQUIP', r.x + r.w / 2, r.y + r.h - 8);
    }
    if (equipped) {
      ctx.strokeStyle = '#8ff59a';
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
    }
  });
  drawButton(BACK_BUTTON);
}

// On-screen controls, drawn only after a real touch has been seen.
function drawTouchControls() {
  if (joy.id !== null) {
    // active floating joystick: base ring + knob under the finger
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(joy.baseX, joy.baseY, JOY_R + 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(joy.knobX, joy.baseY, 28, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // resting hint where the thumb usually sits
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(110, H - 130, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('◀ ▶', 110, H - 121);
  }

  // jump zone hint (the whole right half works; this is just the landmark)
  ctx.fillStyle = jumpHeld ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(W - 110, H - 130, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = jumpHeld ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)';
  ctx.fillText('▲', W - 110, H - 118);
}

function drawTouchHome() {
  const r = TOUCH_HOME;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + 9);
}

function drawConfetti() {
  for (const p of game.confetti) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life * 1.6);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}

function drawHUD() {
  drawDigits(String(game.playerScore), W / 2 - 70, 24, 9, '#006d6d');
  drawDigits('-', W / 2, 24, 9, 'rgba(255,255,255,0.8)');
  drawDigits(String(game.aiScore), W / 2 + 70, 24, 9, '#8a1d17');
}

function centerText(text, y, font, color) {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(text, W / 2 + 3, y + 3);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y);
}

function draw() {
  drawArena();
  const st = game.state;

  if (st === 'home') {
    drawHome();
  } else if (st === 'playselect') {
    drawPlaySelect();
  } else if (st === 'difficulty') {
    drawDifficulty();
  } else if (st === 'online') {
    drawOnline();
  } else if (st === 'gamemodes') {
    drawGamemodes();
  } else if (st === 'leaderboard') {
    drawLeaderboard();
  } else if (st === 'skins') {
    drawSkins();
  } else {
    drawChar(game.player);
    drawChar(game.ai);
    drawBall(game.ball);
    drawHUD();

    if (st === 'countdown') {
      const n = Math.ceil(game.stateTimer / 0.6);
      drawDigits(String(Math.max(1, Math.min(3, n))), W / 2, 180, 16, '#ffffff');
    } else if (st === 'score') {
      const who = game.lastScorer === 'player' ? 'YOU SCORE!' : 'AI SCORES!';
      centerText(who, 200, 'bold 48px monospace',
        game.lastScorer === 'player' ? '#d1ffd1' : '#ffd1d1');
    } else if (st === 'gameover') {
      const won = game.playerScore > game.aiScore;
      centerText(won ? 'YOU WIN!' : 'AI WINS!', 200, 'bold 64px monospace',
        won ? '#d1ffd1' : '#ffd1d1');
      centerText(touchMode ? 'tap to play again' : 'press any key to play again',
        280, 'bold 24px monospace', '#fff6ae');
      centerText(touchMode ? '✕ — main menu' : 'esc — main menu',
        316, 'bold 18px monospace', '#e8f6ff');
      if (game.unlockBanner) {
        centerText('NEW SKIN UNLOCKED: ' + game.unlockBanner + '!', 360,
          'bold 26px monospace', '#ffd740');
      }
    }

    if (touchMode) {
      if (st !== 'gameover') drawTouchControls();
      drawTouchHome();
    }
  }

  if (touchMode && window.innerHeight > window.innerWidth) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, 34);
    centerText('rotate your phone for the best view', 24, 'bold 18px monospace', '#ffffff');
  }

  drawConfetti();
}

// Debug handle for testing from the console
window.PIXEL_PITCH = game;

// PWA: offline cache + installability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
resetChars();
let lastTime = performance.now();
function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
