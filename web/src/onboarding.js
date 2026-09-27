// Cadet onboarding: three Starfield-style screens that run before the galaxy.
//   1. SELECT YOUR CADET  (character-creation record screen, light)
//   2. MISSION BRIEFING   (flight HUD / ship-systems screen, dark)
//   3. HOW RANK WORKS     (inventory screen, dark)
// The profile is saved under its own key so the galaxy's own save (course-galaxy/v3) is untouched.

const STORE = 'course-galaxy/cadet';
const STEPS = ['cadet', 'briefing', 'rank'];

// ------------------------------------------------------------------ data

// Roster roles are cosmetic: they set the portrait, colours and flavour text, not the curriculum.
const ROLES = [
  {
    id: 'pilot', name: 'Pilot', suit: '#d9dcdf', trim: '#8e979f', accent: '#d9822b', visor: '#2a3a4a', gear: ['stripe', 'holster'],
    text: 'Somebody has to fly the thing. You learned to read instruments before you learned to read maps, and you trust a steady hand over a loud opinion. Point the ship and it goes.',
    skills: [
      ['Piloting', 'shield', '#a33a2c', 'ship', 'Clean launches, tight turns and landings that nobody talks about afterwards. The best flights are the boring ones.'],
      ['Astrodynamics', 'round', '#1d3553', 'orbit', 'Orbits, transfers and burn windows. Knowing where everything will be is half of getting anywhere.'],
      ['Targeting', 'round', '#2c3a47', 'reticle', 'Lock on, hold steady, commit. A calm eye matters more than a fast trigger.'],
    ],
  },
  {
    id: 'engineer', name: 'Engineer', suit: '#c4b18c', trim: '#7d6c4f', accent: '#e3b341', visor: '#2d2a22', gear: ['belt', 'lamp'],
    text: 'Every system on the ship has a failure mode, and you have met most of them personally. You take things apart to find out how they work, and usually put them back together better.',
    skills: [
      ['Systems', 'round', '#3b3f45', 'gear', 'Reactors, relays and life support. You see the whole machine, not just the part that is smoking.'],
      ['Power', 'shield', '#8a5a14', 'bolt', 'Routing energy where it is needed before anyone asks. Grav drives do not charge themselves.'],
      ['Fabrication', 'round', '#26394a', 'wrench', 'If the part does not exist yet, you build it. Spare parts are a state of mind.'],
    ],
  },
  {
    id: 'comms', name: 'Comms Officer', suit: '#cfd6dc', trim: '#7f8b95', accent: '#3aa0c8', visor: '#1f3444', gear: ['antenna', 'stripe'],
    text: 'Half the galaxy is noise and the other half is talking over it. You find the signal, clean it up and get it where it needs to go, in a language the receiver actually speaks.',
    skills: [
      ['Signals', 'round', '#18506a', 'waves', 'Picking a whisper out of static across a light-year of nothing. Every transmission tells you something.'],
      ['Linguistics', 'shield', '#2d3f55', 'speech', 'Protocols, dialects and machine languages. Meaning survives translation when you are the one translating.'],
      ['Encryption', 'round', '#2b2f3a', 'lock', 'What is sent is not always what should be read. You decide which is which.'],
    ],
  },
  {
    id: 'navigator', name: 'Navigator', suit: '#c8ccd0', trim: '#6f7a85', accent: '#3d67b1', visor: '#1c2b44', gear: ['tablet', 'stripe'],
    text: 'You plot the course everyone else takes for granted. Stars drift, gravity wells shift and charts go stale; you notice first and quietly correct for it.',
    skills: [
      ['Starcharts', 'round', '#1f3558', 'compass', 'Reading the sky like a page. Every jump starts with knowing exactly where you are.'],
      ['Astrodynamics', 'round', '#1d3553', 'orbit', 'Orbits, transfers and burn windows. Knowing where everything will be is half of getting anywhere.'],
      ['Surveying', 'shield', '#34465a', 'scanner', 'New worlds hand you raw data. You turn it into something the crew can act on.'],
    ],
  },
  {
    id: 'science', name: 'Science Officer', suit: '#e6e8ea', trim: '#8c969e', accent: '#5aa36a', visor: '#1d3a33', gear: ['tablet', 'lamp'],
    text: 'Every anomaly is a question and you have never met a question you could leave alone. Hypothesis, test, repeat, until the universe gives you a straight answer.',
    skills: [
      ['Research', 'round', '#2c5a3a', 'flask', 'Careful experiments beat confident guesses. You write down what happened, not what you hoped for.'],
      ['Xenobiology', 'shield', '#3e6b2e', 'leaf', 'Life finds strange ways to exist out here. You catalogue it before it catalogues you.'],
      ['Analysis', 'round', '#26394a', 'chart', 'Numbers only mean something once you know where they came from.'],
    ],
  },
  {
    id: 'analyst', name: 'Data Analyst', suit: '#9aa3ab', trim: '#5d666e', accent: '#7b68e0', visor: '#221d3d', gear: ['tablet', 'antenna'],
    text: 'You see patterns in the telemetry that other people scroll past. Give you enough data and a quiet corner and you will tell the captain what is about to happen next.',
    skills: [
      ['Pattern Recognition', 'round', '#3a2f6b', 'eye', 'Spotting the signal that repeats, and the one that should have repeated but did not.'],
      ['Statistics', 'shield', '#2f3a55', 'chart', 'Averages lie, distributions do not. You know how sure you are, and say so.'],
      ['Computation', 'round', '#27313d', 'chip', 'Models, simulations and the machines that run them. You make the math do the heavy lifting.'],
    ],
  },
  {
    id: 'medic', name: 'Medic', suit: '#eef0f1', trim: '#99a2a9', accent: '#c8453c', visor: '#2c2a30', gear: ['band', 'belt'],
    text: 'Space is very good at hurting people and you are very good at undoing it. Steady under pressure, precise under worse, and always the last one to leave the med bay.',
    skills: [
      ['Medicine', 'shield', '#a33a2c', 'cross', 'Triage, treatment and the calm voice that goes with both.'],
      ['Biometrics', 'round', '#5a2230', 'pulse', 'Vitals tell a story before the patient can. You listen closely.'],
      ['Xenobiology', 'round', '#2f5a36', 'leaf', 'Life finds strange ways to exist out here. You catalogue it before it catalogues you.'],
    ],
  },
  {
    id: 'security', name: 'Security', suit: '#5f666d', trim: '#3b4248', accent: '#b94a3f', visor: '#1a1f24', gear: ['holster', 'stripe'],
    text: 'Someone has to think about what could go wrong, and plan for it before it does. You keep the crew safe, the airlocks closed and the unexpected very, very expected.',
    skills: [
      ['Tactics', 'round', '#3a2a2a', 'reticle', 'Read the room, pick the ground, choose when to act. Most fights are won before they start.'],
      ['Shields', 'shield', '#2d3f55', 'shield', 'Layered defence for the ship and the people in it. Nothing gets through by accident.'],
      ['Surveillance', 'round', '#27313d', 'eye', 'Knowing who is where and why. Quiet attention is the best alarm.'],
    ],
  },
];

// Rank ladder from the onboarding plan: complete a module's assessment to rank up.
const RANKS = [
  { name: 'Cadet', module: 1, text: 'Where every recruit starts. Your assignment is Module 1: How AI Actually Works. Complete its lessons to earn XP, then complete the module\'s assessment to rank up.' },
  { name: 'Specialist', module: 2, text: 'Unlocked by completing the Module 1 assessment. Specialists are cleared for Module 2 and its lessons.' },
  { name: 'Officer', module: 3, text: 'Unlocked by completing the Module 2 assessment. Officers are cleared for Module 3 and its lessons.' },
  { name: 'Commander', module: 4, text: 'Unlocked by completing the Module 3 assessment. Commanders are cleared for Module 4 and the capstone.' },
];

const BRIEFING = [
  'Your directive: complete Main Quest training, then choose a specialization track.',
  'Progress earns XP. XP earns rank.',
  'Rank unlocks new assignments.',
];

// ------------------------------------------------------------------ state

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private window: the flow still works */ }
}

const state = Object.assign({ role: 'pilot', name: '', callsign: '', tagline: '', confirmed: false, number: '' }, load());
if (!state.number) {
  const d = new Date();
  const ymd = `${d.getFullYear() % 100}`.padStart(2, '0') + `${d.getMonth() + 1}`.padStart(2, '0') + `${d.getDate()}`.padStart(2, '0');
  state.number = `SLR-${ymd}-${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
  save();
}
let tab = 'role';
let rankSel = 0;

const role = () => ROLES.find((r) => r.id === state.role) || ROLES[0];
const nameOk = () => state.name.trim().length >= 2;
const callOk = () => /^[A-Za-z0-9_]{3,18}$/.test(state.callsign);
const valid = () => nameOk() && callOk();
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);

// ------------------------------------------------------------------ insignia

const GLYPHS = {
  ship: '<path d="M50 28 61 54v18l-11-6-11 6V54z"/><path d="M45 74h10l-5 10z" class="fill"/>',
  orbit: '<circle cx="50" cy="56" r="6" class="fill"/><ellipse cx="50" cy="56" rx="17" ry="17"/><ellipse cx="50" cy="56" rx="28" ry="28" opacity=".7"/><circle cx="67" cy="46" r="4" class="fill"/><circle cx="31" cy="76" r="3" class="fill"/>',
  reticle: '<circle cx="50" cy="56" r="20"/><path d="M50 26v14M50 72v14M20 56h14M66 56h14"/><circle cx="50" cy="56" r="4" class="fill"/>',
  gear: null, // generated below
  bolt: '<path d="M55 28 38 60h12l-5 26 19-34H52z" class="fill"/>',
  wrench: '<path d="M64 32a12 12 0 0 0-14 16L32 66l6 6 18-18a12 12 0 0 0 16-14l-8 8-7-2-2-7z"/>',
  waves: '<circle cx="50" cy="70" r="4" class="fill"/><path d="M40 60a14 14 0 0 1 20 0M33 52a24 24 0 0 1 34 0M26 44a34 34 0 0 1 48 0"/>',
  speech: '<path d="M28 38h44v28H48l-10 10v-10H28z"/><path d="M37 49h26M37 57h16"/>',
  lock: '<rect x="34" y="52" width="32" height="26" rx="3"/><path d="M40 52v-8a10 10 0 0 1 20 0v8"/><circle cx="50" cy="64" r="3" class="fill"/>',
  compass: '<circle cx="50" cy="56" r="24"/><path d="M50 36 56 56 50 76 44 56z" class="fill"/><circle cx="50" cy="56" r="3"/>',
  scanner: '<rect x="42" y="56" width="16" height="28" rx="3"/><path d="M45 62h10M40 48a14 14 0 0 1 20 0M34 41a22 22 0 0 1 32 0"/>',
  flask: '<path d="M44 30h12M46 30v18L32 78h36L54 48V30"/><path d="M38 66h24" opacity=".8"/>',
  leaf: '<path d="M32 78C32 48 50 34 70 32c0 26-14 44-38 46z"/><path d="M34 76 60 44"/>',
  chart: '<path d="M30 80h40"/><path d="M36 78V62M46 78V48M56 78V56M66 78V38" class="thick"/>',
  chip: '<rect x="36" y="42" width="28" height="28" rx="2"/><rect x="44" y="50" width="12" height="12" class="fill"/><path d="M42 36v6M50 36v6M58 36v6M42 70v6M50 70v6M58 70v6M30 48h6M30 56h6M30 64h6M64 48h6M64 56h6M64 64h6"/>',
  eye: '<path d="M26 56c8-12 16-18 24-18s16 6 24 18c-8 12-16 18-24 18s-16-6-24-18z"/><circle cx="50" cy="56" r="8" class="fill"/>',
  cross: '<path d="M44 34h12v16h16v12H56v16H44V62H28V50h16z" class="fill"/>',
  pulse: '<path d="M26 58h12l5-12 8 24 6-18 4 6h13"/>',
  shield: '<path d="M50 32 68 38v16c0 14-8 22-18 26-10-4-18-12-18-26V38z"/><path d="M42 56l6 6 12-12"/>',
};
GLYPHS.gear = (() => {
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 ? 17 : 23;
    pts.push(`${(50 + Math.cos(a) * r).toFixed(1)},${(56 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}"/><circle cx="50" cy="56" r="7"/>`;
})();

const SHAPES = {
  shield: 'M50 5 90 14v38c0 30-18 46-40 54C28 98 10 82 10 52V14z',
  round: 'M50 6a42 49 0 1 0 0.01 0z',
};

function badge(shape, color, glyph, cls = '') {
  const d = SHAPES[shape];
  return `<svg class="badge ${cls}" viewBox="0 0 100 112" aria-hidden="true">
    <path d="${d}" fill="#b6bec4" transform="translate(50 56) scale(1.06) translate(-50 -56)"/>
    <path d="${d}" fill="${color}"/>
    <path d="${d}" fill="url(#badge-sheen)"/>
    <g class="glyph-g">${GLYPHS[glyph]}</g>
  </svg>`;
}

function rankBadge(tier, cls = '') {
  // Chevrons stack up with each rank; Commander gets a star above them.
  let marks = '';
  for (let i = 0; i < tier; i++) marks += `<path d="M28 ${76 - i * 13} 50 ${62 - i * 13} 72 ${76 - i * 13}" />`;
  if (tier === 4) marks += '<path d="M50 14l3.5 7 7.5 1-5.5 5 1.5 7.5L50 31l-7 3.5 1.5-7.5-5.5-5 7.5-1z" class="fill"/>';
  return `<svg class="rank-badge ${cls}" viewBox="0 0 100 112" aria-hidden="true">
    <defs><linearGradient id="rb-${cls}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9edf0"/><stop offset=".45" stop-color="#9ea8b0"/><stop offset="1" stop-color="#4d5761"/></linearGradient></defs>
    <path d="${SHAPES.shield}" fill="url(#rb-${cls})"/>
    <path d="${SHAPES.shield}" fill="#1a2430" transform="translate(50 56) scale(.86) translate(-50 -56)"/>
    <g class="chev">${marks}</g>
  </svg>`;
}

// ------------------------------------------------------------------ cadet figure

// One suited silhouette, recoloured and re-equipped per role.
function figureSVG(r) {
  const has = (g) => r.gear.includes(g);
  return `<svg class="cadet-svg" viewBox="10 14 240 456" preserveAspectRatio="xMidYMax meet" style="--suit:${r.suit};--trim:${r.trim};--accent:${r.accent};--visor:${r.visor}" aria-hidden="true">
  <defs>
    <linearGradient id="fg-suit" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset=".38" stop-color="#fff" stop-opacity=".16"/><stop offset=".62" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>
    <radialGradient id="fg-visor" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#9fb4c4" stop-opacity=".9"/><stop offset=".25" stop-color="var(--visor)"/><stop offset="1" stop-color="#05080b"/></radialGradient>
    <linearGradient id="fg-helm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
    <radialGradient id="fg-floor" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#1b2733" stop-opacity=".35"/><stop offset="1" stop-color="#1b2733" stop-opacity="0"/></radialGradient>
  </defs>
  <ellipse cx="130" cy="542" rx="92" ry="12" fill="url(#fg-floor)"/>

  <!-- pack -->
  <rect x="66" y="118" width="128" height="160" rx="16" fill="var(--trim)"/>
  <rect x="74" y="128" width="12" height="120" rx="4" fill="#000" opacity=".18"/>
  <rect x="174" y="128" width="12" height="120" rx="4" fill="#000" opacity=".18"/>
  ${has('antenna') ? '<path d="M180 124 196 20" stroke="var(--trim)" stroke-width="4" stroke-linecap="round"/><circle cx="196" cy="18" r="5" fill="var(--accent)"/>' : ''}

  <!-- legs -->
  <g class="suit">
    <path d="M96 318 L90 470 L86 512 L126 512 L127 470 L131 330 Z"/>
    <path d="M164 318 L170 470 L174 512 L134 512 L133 470 L129 330 Z"/>
  </g>
  <path d="M96 318 L90 470 L86 512 L126 512 L127 470 L131 330 Z M164 318 L170 470 L174 512 L134 512 L133 470 L129 330 Z" fill="url(#fg-suit)"/>
  <rect x="92" y="420" width="32" height="30" rx="7" fill="var(--trim)"/>
  <rect x="136" y="420" width="32" height="30" rx="7" fill="var(--trim)"/>
  <rect x="96" y="360" width="28" height="7" fill="var(--accent)" opacity=".9"/>
  <rect x="136" y="360" width="28" height="7" fill="var(--accent)" opacity=".9"/>
  <!-- boots -->
  <path d="M82 506h46l2 24c0 6-4 10-10 10H80c-6 0-8-4-7-9z" fill="#2a323a"/>
  <path d="M132 506h46l9 25c1 5-1 9-7 9h-40c-6 0-10-4-10-10z" fill="#2a323a"/>
  <path d="M78 530h52M130 530h56" stroke="#11171c" stroke-width="4"/>

  <!-- torso -->
  <path class="suit" d="M82 150 Q130 132 178 150 L184 252 Q178 300 168 332 L92 332 Q82 300 76 252 Z"/>
  <path d="M82 150 Q130 132 178 150 L184 252 Q178 300 168 332 L92 332 Q82 300 76 252 Z" fill="url(#fg-suit)"/>
  <path d="M98 166 Q130 156 162 166 L158 232 Q130 246 102 232 Z" fill="var(--trim)"/>
  <path d="M98 166 Q130 156 162 166 L158 232 Q130 246 102 232 Z" fill="url(#fg-helm)"/>
  <rect x="112" y="186" width="36" height="22" rx="3" fill="#1d252d"/>
  <rect x="116" y="190" width="10" height="4" fill="var(--accent)"/>
  <rect x="116" y="198" width="22" height="3" fill="#6f7a84"/>
  <circle cx="141" cy="192" r="2.4" fill="#7fe0a0"/>
  ${has('stripe') ? '<path d="M100 244 Q130 256 160 244 L158 256 Q130 268 102 256 Z" fill="var(--accent)"/>' : ''}
  <!-- belt -->
  <rect x="88" y="298" width="84" height="18" rx="3" fill="#29313a"/>
  <rect x="122" y="300" width="16" height="14" rx="2" fill="#8e98a1"/>
  ${has('belt') ? '<rect x="92" y="312" width="16" height="26" rx="3" fill="#3a434c"/><rect x="152" y="312" width="16" height="26" rx="3" fill="#3a434c"/><rect x="112" y="314" width="12" height="20" rx="2" fill="var(--accent)" opacity=".85"/>' : ''}
  ${has('holster') ? '<path d="M160 314h18l-2 44h-14z" fill="#2c343c"/><rect x="163" y="320" width="10" height="4" fill="var(--accent)"/>' : ''}

  <!-- arms -->
  <g class="suit">
    <path d="M84 150 Q60 158 56 200 L50 290 Q48 310 54 322 L76 322 Q80 300 80 288 L90 214 Z"/>
    <path d="M176 150 Q200 158 204 200 L210 290 Q212 310 206 322 L184 322 Q180 300 180 288 L170 214 Z"/>
  </g>
  <path d="M84 150 Q60 158 56 200 L50 290 Q48 310 54 322 L76 322 Q80 300 80 288 L90 214 Z M176 150 Q200 158 204 200 L210 290 Q212 310 206 322 L184 322 Q180 300 180 288 L170 214 Z" fill="url(#fg-suit)"/>
  <rect x="52" y="262" width="30" height="8" rx="2" fill="var(--trim)"/>
  <rect x="178" y="262" width="30" height="8" rx="2" fill="var(--trim)"/>
  ${has('band') ? '<rect x="54" y="226" width="30" height="16" rx="2" fill="#f4f5f6"/><path d="M69 228v12M63 234h12" stroke="var(--accent)" stroke-width="4"/>' : ''}
  ${has('tablet') ? '<rect x="186" y="232" width="30" height="40" rx="3" fill="#1d252d" transform="rotate(-8 201 252)"/><rect x="190" y="238" width="22" height="26" fill="var(--accent)" opacity=".55" transform="rotate(-8 201 252)"/>' : ''}
  <!-- gloves -->
  <path d="M52 318h26l2 20c0 10-6 16-15 16s-15-6-14-16z" fill="#2a323a"/>
  <path d="M182 318h26l1 20c1 10-5 16-14 16s-15-6-15-16z" fill="#2a323a"/>
  <!-- shoulders -->
  <ellipse cx="82" cy="160" rx="22" ry="16" fill="var(--trim)"/>
  <ellipse cx="178" cy="160" rx="22" ry="16" fill="var(--trim)"/>
  <ellipse cx="82" cy="160" rx="22" ry="16" fill="url(#fg-helm)"/>
  <ellipse cx="178" cy="160" rx="22" ry="16" fill="url(#fg-helm)"/>
  <!-- shoulder patch -->
  <g transform="translate(180 184) scale(.22) translate(-50 -56)" class="patch">${patchInner(r)}</g>
  ${has('lamp') ? '<rect x="66" y="146" width="18" height="12" rx="3" fill="#2a323a"/><circle cx="75" cy="152" r="4" fill="#fff6c9"/>' : ''}

  <!-- helmet -->
  <g transform="translate(130 142) scale(.86) translate(-130 -142)">
  <ellipse cx="130" cy="142" rx="38" ry="12" fill="#2a323a"/>
  <circle class="suit" cx="130" cy="88" r="52"/>
  <circle cx="130" cy="88" r="52" fill="url(#fg-helm)"/>
  ${has('stripe') ? '<path d="M126 36h8v24h-8z" fill="var(--accent)"/>' : ''}
  <path d="M90 92 Q92 58 130 56 Q168 58 170 92 Q168 124 130 128 Q92 124 90 92 Z" fill="#1f272f"/>
  <path d="M95 92 Q97 63 130 61 Q163 63 165 92 Q163 119 130 123 Q97 119 95 92 Z" fill="url(#fg-visor)"/>
  <path d="M104 78 Q110 66 128 64" stroke="#e8f1f7" stroke-opacity=".55" stroke-width="4" fill="none" stroke-linecap="round"/>
  <rect x="80" y="84" width="10" height="22" rx="3" fill="var(--trim)"/>
  <rect x="170" y="84" width="10" height="22" rx="3" fill="var(--trim)"/>
  </g>
</svg>`;
}

function patchInner(r) {
  const s = r.skills[0];
  return `<path d="${SHAPES[s[1]]}" fill="#d6dbdf"/><path d="${SHAPES[s[1]]}" fill="${s[2]}" transform="translate(50 56) scale(.9) translate(-50 -56)"/><g class="glyph-g">${GLYPHS[s[3]]}</g>`;
}

// ------------------------------------------------------------------ screen 1: cadet

function renderRoster() {
  $('roster').innerHTML = ROLES.map((r) => `
    <li><button role="option" data-role="${r.id}" aria-selected="${r.id === state.role}">
      <span class="rs-dot" style="background:${r.accent}"></span><span>${esc(r.name)}</span>
    </button></li>`).join('');
}

function renderRole() {
  const r = role();
  $('figure-stage').innerHTML = figureSVG(r);
  $('role-title').textContent = r.name;
  $('role-text').textContent = r.text;
  $('np-role').textContent = r.name.toUpperCase();
  $('skills').innerHTML = r.skills.map(([name, shape, color, glyph, text]) => `
    <article class="skill">
      <div class="skill-art">${badge(shape, color, glyph)}</div>
      <h3>${esc(name)}</h3>
      <p>${esc(text)}</p>
    </article>`).join('');
  document.querySelectorAll('#roster button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.role === r.id)));
  document.querySelector('#roster [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderIdentity() {
  $('np-name').textContent = state.name.trim() || 'UNNAMED CADET';
  $('np-call').textContent = '@' + (state.callsign || 'callsign');
  $('id-count').textContent = `${Number(nameOk()) + Number(callOk())}/2`;
  $('p-confirm').disabled = !valid();
  const note = $('call-note');
  const bad = state.callsign && !callOk();
  note.textContent = bad ? '3 to 18 letters, numbers or underscores.' : 'Letters, numbers and underscores.';
  note.classList.toggle('bad', !!bad);
  $('cadet-no').textContent = state.number;
}

function setTab(next) {
  tab = next;
  const onRole = tab === 'role';
  $('tab-role').setAttribute('aria-selected', String(onRole));
  $('tab-id').setAttribute('aria-selected', String(!onRole));
  $('pane-role').hidden = !onRole;
  $('pane-id').hidden = onRole;
  if (!onRole && !nameOk()) setTimeout(() => $('in-name').focus(), 0);
}

function stepRole(dir) {
  const i = ROLES.findIndex((r) => r.id === state.role);
  state.role = ROLES[(i + dir + ROLES.length) % ROLES.length].id;
  save();
  renderRole();
}

function confirmCadet() {
  if (!valid()) {
    setTab('id');
    (nameOk() ? $('in-call') : $('in-name')).focus();
    return;
  }
  state.confirmed = true;
  save();
  go('briefing');
}

// drag to rotate the figure (a turntable, like the character screen)
function initRotate() {
  const stage = $('figure-stage');
  let yaw = 0, startX = 0, startYaw = 0, dragging = false;
  const apply = () => { stage.style.setProperty('--yaw', `${yaw}deg`); };
  stage.addEventListener('pointerdown', (e) => { dragging = true; startX = e.clientX; startYaw = yaw; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); });
  stage.addEventListener('pointermove', (e) => { if (!dragging) return; yaw = Math.max(-38, Math.min(38, startYaw + (e.clientX - startX) * 0.35)); apply(); });
  const end = () => { dragging = false; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  $('p-rotate').addEventListener('click', () => { yaw = yaw > 0 ? -28 : 28; apply(); });
}

// ------------------------------------------------------------------ screen 2: briefing

let typeTimer = 0;
function renderBriefing() {
  const r = role();
  $('ro-to').innerHTML = `Cadet <b>${esc(state.name.trim())}</b>, StarLab Research Division`;
  $('ro-id').textContent = state.number;
  $('brief-role').textContent = r.name.toUpperCase();
  $('brief-call').textContent = '@' + state.callsign;
  $('brief-badge').innerHTML = badge(r.skills[0][1], r.skills[0][2], r.skills[0][3], 'mini');
  const tag = $('ro-tag');
  tag.hidden = !state.tagline.trim();
  tag.textContent = state.tagline.trim() ? `“${state.tagline.trim()}”` : '';

  $('sys-bars').innerHTML = ['M1', 'M2', 'M3', 'M4', 'CAP'].map((k, i) => `
    <div class="sb${i === 0 ? ' active' : ''}"><div class="sb-col">${'<i></i>'.repeat(8)}</div><span>${k}</span></div>`).join('');

  // Type the orders out line by line, like a readout arriving.
  clearTimeout(typeTimer);
  const body = $('ro-body');
  body.innerHTML = BRIEFING.map((l) => `<p><span class="typed"></span><span class="ghost">${esc(l)}</span></p>`).join('');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lines = [...body.querySelectorAll('p')];
  let li = 0, ci = 0;
  const tick = () => {
    if (li >= lines.length) return;
    const full = BRIEFING[li];
    const p = lines[li];
    p.classList.add('on');
    ci = reduce ? full.length : ci + 2;
    p.querySelector('.typed').textContent = full.slice(0, ci);
    p.querySelector('.ghost').textContent = full.slice(ci);
    if (ci >= full.length) { p.classList.add('done'); li++; ci = 0; typeTimer = setTimeout(tick, reduce ? 0 : 260); }
    else typeTimer = setTimeout(tick, 16);
  };
  typeTimer = setTimeout(tick, reduce ? 0 : 420);
}

// ------------------------------------------------------------------ screen 3: rank

function renderRanks() {
  $('rank-list').innerHTML = RANKS.map((k, i) => `
    <li><button role="option" data-rank="${i}" aria-selected="${i === rankSel}" class="${i === 0 ? 'current' : 'locked'}">
      <span class="rl-name">${rankBadge(i + 1, `row${i}`)}<span>${k.name.toUpperCase()}</span></span>
      <span class="rl-mod">MODULE ${k.module}</span>
      <span class="rl-st">${i === 0 ? 'ACTIVE' : 'LOCKED'}</span>
    </button></li>`).join('');
  $('cb-name').textContent = state.name.trim() || '—';
  renderRankCard();
}

function renderRankCard() {
  const k = RANKS[rankSel];
  document.querySelectorAll('#rank-list button').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.rank) === rankSel)));
  $('sc-name').textContent = k.name.toUpperCase();
  $('sc-sub').textContent = rankSel === 0 ? 'CURRENT RANK' : `RANK ${rankSel + 1} OF 4`;
  $('sc-rank').textContent = k.name.toUpperCase();
  $('sc-ico').innerHTML = rankBadge(rankSel + 1, 'card');
  $('sc-tier').textContent = `${rankSel + 1}/4`;
  $('sc-mod').textContent = `M${k.module}`;
  const st = $('sc-status');
  st.textContent = rankSel === 0 ? 'ACTIVE' : 'LOCKED';
  st.className = rankSel === 0 ? 'good' : 'bad';
  $('sc-rank').className = rankSel === 0 ? 'good' : '';
  $('sc-desc').textContent = k.text;
  $('rank-hero').innerHTML = rankBadge(rankSel + 1, 'hero');
}

// ------------------------------------------------------------------ routing

function current() { return STEPS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'cadet'; }

function go(step) {
  if (step !== 'cadet' && !(state.confirmed && valid())) step = 'cadet';
  if (location.hash.slice(1) !== step) location.hash = step;
  else show(step);
}

function show(step) {
  if (step !== 'cadet' && !(state.confirmed && valid())) { history.replaceState(null, '', '#cadet'); step = 'cadet'; }
  document.body.dataset.step = step;
  $('screen-cadet').hidden = step !== 'cadet';
  $('screen-brief').hidden = step !== 'briefing';
  $('screen-rank').hidden = step !== 'rank';
  document.title = { cadet: 'Select Your Cadet', briefing: 'Mission Briefing', rank: 'How Rank Works' }[step] + ' · Course Galaxy';
  if (step === 'briefing') renderBriefing();
  else clearTimeout(typeTimer);
  if (step === 'rank') renderRanks();
  window.scrollTo(0, 0);
}

function stepBy(dir) {
  const i = STEPS.indexOf(current());
  const next = i + dir;
  if (next < 0) return;
  if (next >= STEPS.length) { finish(); return; }
  if (current() === 'cadet' && dir > 0) { confirmCadet(); return; }
  go(STEPS[next]);
}

function finish() {
  state.onboarded = true;
  save();
  location.href = 'index.html';
}

// ------------------------------------------------------------------ wiring

function init() {
  // shared sheen gradient for the insignia
  document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <linearGradient id="badge-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
  </defs></svg>`);

  renderRoster();
  renderRole();
  $('in-name').value = state.name;
  $('in-call').value = state.callsign;
  $('in-tag').value = state.tagline;
  renderIdentity();
  initRotate();

  $('roster').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-role]');
    if (!b) return;
    state.role = b.dataset.role;
    save();
    renderRole();
  });
  $('tab-role').addEventListener('click', () => setTab('role'));
  $('tab-id').addEventListener('click', () => setTab('id'));
  $('tab-prev').addEventListener('click', () => setTab('role'));
  $('tab-next').addEventListener('click', () => setTab('id'));
  $('p-change').addEventListener('click', () => { setTab('role'); stepRole(1); });
  $('p-confirm').addEventListener('click', confirmCadet);

  const bind = (id, key, clean) => $(id).addEventListener('input', (e) => {
    if (clean) { const v = clean(e.target.value); if (v !== e.target.value) e.target.value = v; }
    state[key] = e.target.value;
    state.confirmed = false;
    save();
    renderIdentity();
  });
  bind('in-name', 'name');
  bind('in-call', 'callsign', (v) => v.replace(/^@+/, '').replace(/\s+/g, '_'));
  bind('in-tag', 'tagline');
  $('pane-id').addEventListener('submit', (e) => e.preventDefault());

  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => stepBy(Number(b.dataset.go))));
  $('rank-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rank]');
    if (!b) return;
    rankSel = Number(b.dataset.rank);
    renderRankCard();
  });
  $('p-rank-sel').addEventListener('click', () => { rankSel = (rankSel + 1) % RANKS.length; renderRankCard(); });
  $('p-start').addEventListener('click', finish);

  addEventListener('hashchange', () => show(current()));
  addEventListener('keydown', onKey);
  show(current());
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const step = current();
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  // Inside a text field only Enter (submit) and Escape (leave the field) mean anything.
  if (typing()) {
    if (k === 'Escape') document.activeElement.blur();
    else if (k === 'Enter' && step === 'cadet') { e.preventDefault(); confirmCadet(); }
    return;
  }

  if (step === 'cadet') {
    if (k === 'q') setTab('role');
    else if (k === 'e') setTab('id');
    else if (k === 'ArrowDown' || k === 's' || k === 'ArrowRight' || k === 'd') { setTab('role'); stepRole(1); }
    else if (k === 'ArrowUp' || k === 'w' || k === 'ArrowLeft' || k === 'a') { setTab('role'); stepRole(-1); }
    else if (k === 'Enter') { if (tab === 'role' && !valid()) setTab('id'); else confirmCadet(); }
    else return;
  } else if (step === 'briefing') {
    if (k === 'Enter' || k === 'e') stepBy(1);
    else if (k === 'q' || k === 'b' || k === 'Escape' || k === 'Backspace') stepBy(-1);
    else return;
  } else if (step === 'rank') {
    if (k === 'ArrowDown' || k === 's') { rankSel = (rankSel + 1) % RANKS.length; renderRankCard(); }
    else if (k === 'ArrowUp' || k === 'w') { rankSel = (rankSel + RANKS.length - 1) % RANKS.length; renderRankCard(); }
    else if (k === 'Enter' || k === 'e') finish();
    else if (k === 'q' || k === 'b' || k === 'Escape' || k === 'Backspace') stepBy(-1);
    else return;
  }
  e.preventDefault();
}

init();
