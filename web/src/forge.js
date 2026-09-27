// The Galaxy Forge: build a galaxy yourself, in four steps, with a live 3D preview behind the panels.
//
//   1. Environment  the sky all around the system (nebula, Milky Way band, stars, deep space)
//   2. Star         temperature, size, glow, rays, the light it throws on the planets
//   3. Planets      how many, and every setting of each world: type, look, atmosphere, clouds,
//                   rings, belt, moons, tilt, spin, plus the course it stands for
//   4. Galaxy       name, orbits, main asteroid belt, moons, exposure and bloom
//
// Every section has a random button, each step has one, and RANDOMIZE ALL rolls a whole galaxy.
// Nothing is saved until CREATE; the draft lives here and in the preview only. The first time
// the Forge opens it plays a short guided demo (replay it with the DEMO button or "?").
import { store, newId, NEBULAE } from './data.js';
import { getType } from './assets.js';
import * as P from './params.js';
import { renderFields, renderMoons } from './fields.js';
import { toast, confirmModal } from './ui.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (sel, root = document) => root.querySelector(sel);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DEMO_KEY = 'course-galaxy/forge-demo-seen';

const STEPS = [
  { id: 'sky', label: 'Environment', title: 'The environment', lead: 'The sky wrapped all the way around your system. Drag anywhere to look around it in 360°.' },
  { id: 'star', label: 'Star', title: 'The star', lead: 'The sun at the centre. Its temperature sets its colour and the colour of the light on every planet.' },
  { id: 'planets', label: 'Planets', title: 'The planets', lead: 'One planet per course. Pick how many, then shape each world.' },
  { id: 'galaxy', label: 'Galaxy', title: 'The galaxy', lead: 'Name it, then tune the system as a whole: orbits, the main asteroid belt, moons and light.' },
];

let app = null;
let rig = null;
let S = null; // { draft, mode, editId, step, sel, root, dirty, spin, tour }

export function initForge(appRef, rigRef) {
  app = appRef;
  rig = rigRef;
  window.addEventListener('keydown', onKey, true);
}

// --------------------------------------------------------------------------- drafts

function newDraft() {
  const types = ['terra', 'dune', 'glacier', 'jovian', 'saturn', 'neptune', 'luna', 'thalassa', 'sylva', 'mesa'];
  // a believable starting point: rocky worlds inside, giants further out
  const planets = Array.from({ length: 5 }, () => P.randomPlanet({ id: newId() }));
  planets.sort((a, b) => P.GIANTS.has(a.type) - P.GIANTS.has(b.type));
  if (!planets.some((p) => types.includes(p.type))) planets[0].type = 'terra';
  const preset = P.STAR_PRESETS.g;
  return {
    id: newId(),
    name: P.randomGalaxyName(),
    star: 'star_yellow',
    nebula: 'violet',
    sky: {},
    sun: { ...preset.sun, surface: 'auto', tint: 0.85, limb: 0.65, light: 2.1, label: preset.label },
    system: {},
    planets,
  };
}

// --------------------------------------------------------------------------- open / close

/** Open the Forge on a new galaxy, or with `{ edit: galaxyId }` on an existing one. */
export async function openForge({ edit = null } = {}) {
  if (S || app.forge) return;
  const src = edit ? store.state.galaxies.find((g) => g.id === edit) : null;
  const draft = src ? structuredClone(src) : newDraft();
  if (!(await app.openForge(draft))) return;
  S = { draft, mode: src ? 'edit' : 'new', editId: src?.id ?? null, step: 0, sel: draft.planets[0]?.id ?? null, dirty: false, spin: true, tour: null };
  buildShell();
  goStep(0, { immediate: true });
  let seen = false;
  try {
    seen = !!localStorage.getItem(DEMO_KEY);
  } catch {
    /* storage unavailable: show the demo */
  }
  if (!seen) setTimeout(() => S && runDemo(), 600);
}

async function close(galaxyId = null) {
  stopDemo();
  S.root.remove();
  S = null;
  await app.closeForge(galaxyId);
}

async function cancel() {
  if (S.tour) return stopDemo();
  if (S.dirty) {
    const ok = await confirmModal({
      kicker: 'GALAXY FORGE',
      title: S.mode === 'edit' ? 'Discard changes?' : 'Discard this galaxy?',
      body: S.mode === 'edit' ? 'Your edits to this galaxy will be lost.' : 'The galaxy you are building will be lost.',
      confirm: 'Discard',
      danger: true,
    });
    if (!ok || !S) return;
  }
  close(null);
}

function create() {
  const d = S.draft;
  d.name = d.name.trim() || 'Unnamed Galaxy';
  if (S.mode === 'edit') {
    store.updateGalaxy(S.editId, d);
    toast(`${d.name} updated`, { kicker: 'GALAXY SAVED', sub: `${d.planets.length} PLANETS` });
    close(S.editId);
  } else {
    const g = store.addGalaxy(d);
    toast(`${g.name} charted`, { kicker: 'GALAXY CREATED', sub: `${g.planets.length} PLANETS` });
    close(g.id);
  }
}

async function deleteGalaxy() {
  const ok = await confirmModal({
    kicker: 'GALAXY FORGE',
    title: `Delete ${S.draft.name}?`,
    body: `The galaxy and all <strong>${S.draft.planets.length}</strong> of its planets (and their course progress) will be removed.`,
    confirm: 'Delete galaxy',
    danger: true,
  });
  if (!ok || !S) return;
  const id = S.editId;
  store.removeGalaxy(id);
  toast('Galaxy removed', { kicker: 'GALAXY FORGE' });
  close(store.galaxy.id);
}

function onKey(e) {
  if (!S) return;
  if (document.querySelector('.backdrop')) return; // a confirm dialog is up
  const inField = e.target.closest?.('input, textarea, select');
  if (e.key === 'Escape') cancel();
  else if (inField || S.tour) return;
  else if (e.key === '?') runDemo();
  else if (e.key === 'Enter' && !e.target.closest?.('button')) (S.step === STEPS.length - 1 ? create() : goStep(S.step + 1));
  else return;
  e.preventDefault();
  e.stopPropagation();
}

/** A planet was clicked in the preview. */
export function onPick(id) {
  if (!S) return;
  S.sel = id;
  if (S.step !== 2) goStep(2);
  else renderStep();
}

// --------------------------------------------------------------------------- layout

function buildShell() {
  const root = document.createElement('div');
  root.id = 'forge';
  root.innerHTML = `
    <header class="fg-top">
      <div class="fg-title">
        <span class="fg-kicker">GALAXY FORGE <span class="sep">&gt;</span> ${S.mode === 'edit' ? 'EDIT' : 'NEW GALAXY'}</span>
        <span class="fg-name" id="fg-name"></span>
      </div>
      <nav class="fg-steps">${STEPS.map((s, i) => `<button type="button" data-step="${i}"><b>${i + 1}</b>${s.label}</button>`).join('')}</nav>
      <div class="fg-tools">
        <button type="button" class="prompt" id="fg-demo"><span class="pl">DEMO</span><kbd>?</kbd></button>
        <button type="button" class="prompt" id="fg-randall"><span class="pl">RANDOMIZE ALL</span><kbd><i class="dice"></i></kbd></button>
        <button type="button" class="prompt" id="fg-cancel"><span class="pl">CANCEL</span><kbd>ESC</kbd></button>
      </div>
    </header>
    <aside class="fg-panel fg-left">
      <div class="fg-panel-head"><div class="fg-kicker" id="fg-step-kicker"></div><h2 id="fg-step-title"></h2><p id="fg-step-lead"></p>
        <div class="fg-btns" id="fg-step-btns"></div></div>
      <div class="fg-scroll" id="fg-left"></div>
    </aside>
    <aside class="fg-panel fg-right" id="fg-right-wrap" hidden>
      <div class="fg-panel-head" id="fg-right-head"></div>
      <div class="fg-scroll" id="fg-right"></div>
    </aside>
    <div class="fg-mswitch"><button type="button" data-mv="list">Planet list</button><button type="button" data-mv="edit">Edit planet</button></div>
    <div class="fg-view"><span>DRAG TO LOOK AROUND · SCROLL TO ZOOM</span>
      <button type="button" class="fg-mini" id="fg-spin">AUTO-SPIN</button></div>
    <footer class="fg-foot">
      <button type="button" class="prompt" id="fg-back"><span class="pl">BACK</span><kbd>&larr;</kbd></button>
      <button type="button" class="prompt" id="fg-next"><span class="pl">NEXT</span><kbd>&#8629;</kbd></button>
      <button type="button" class="prompt fg-create" id="fg-create"><span class="pl">${S.mode === 'edit' ? 'SAVE GALAXY' : 'CREATE GALAXY'}</span><kbd>&#10003;</kbd></button>
    </footer>`;
  document.body.append(root);
  S.root = root;
  root.querySelectorAll('.fg-steps button').forEach((b) => b.addEventListener('click', () => goStep(+b.dataset.step)));
  root.querySelectorAll('.fg-mswitch button').forEach((b) => b.addEventListener('click', () => setMobileView(b.dataset.mv)));
  setMobileView('list');
  $('#fg-demo', root).addEventListener('click', () => runDemo());
  $('#fg-randall', root).addEventListener('click', randomizeAll);
  $('#fg-cancel', root).addEventListener('click', cancel);
  $('#fg-back', root).addEventListener('click', () => goStep(S.step - 1));
  $('#fg-next', root).addEventListener('click', () => goStep(S.step + 1));
  $('#fg-create', root).addEventListener('click', create);
  $('#fg-spin', root).addEventListener('click', () => {
    S.spin = !S.spin;
    applyCamera(false);
  });
  renderName();
}

/** Phones show one planet panel at a time: the list, or the selected planet's editor. */
function setMobileView(v) {
  S.root.dataset.mview = v;
  S.root.querySelectorAll('.fg-mswitch button').forEach((b) => b.classList.toggle('active', b.dataset.mv === v));
}

function renderName() {
  $('#fg-name', S.root).textContent = S.draft.name || 'Unnamed Galaxy';
}

function goStep(i, { immediate = false } = {}) {
  if (!S || i < 0 || i >= STEPS.length) return;
  S.step = i;
  const st = STEPS[i];
  S.root.dataset.step = st.id;
  S.root.querySelectorAll('.fg-steps button').forEach((b, j) => {
    b.classList.toggle('active', j === i);
    b.classList.toggle('done', j < i);
  });
  $('#fg-back', S.root).disabled = i === 0;
  $('#fg-next', S.root).hidden = i === STEPS.length - 1;
  $('#fg-step-kicker', S.root).textContent = `STEP ${i + 1} OF ${STEPS.length}`;
  $('#fg-step-title', S.root).textContent = st.title;
  $('#fg-step-lead', S.root).textContent = st.lead;
  renderStep();
  applyCamera(immediate);
}

/** Point the camera at what the current step is about. */
function applyCamera() {
  const id = STEPS[S.step].id;
  $('#fg-spin', S.root).classList.toggle('active', S.spin);
  rig.autoSpin = 0;
  if (id === 'sky') {
    // low over the orbital plane, so most of the view is sky
    app.forgeFrameStar(true, -0.2);
    rig.targetZoom = 1.1;
    if (S.spin) rig.autoSpin = 0.07;
  } else if (id === 'star') {
    app.forgeFrameStar(false);
    if (S.spin) rig.autoSpin = 0.05;
  } else if (id === 'planets') {
    if (!S.draft.planets.some((p) => p.id === S.sel)) S.sel = S.draft.planets[0]?.id ?? null;
    if (S.sel) app.forgeFocus(S.sel);
    else app.forgeFrameStar(true);
    if (S.spin) rig.autoSpin = 0.04;
  } else {
    app.forgeFrameStar(true);
    if (S.spin) rig.autoSpin = 0.03;
  }
}

function renderStep() {
  const id = STEPS[S.step].id;
  const left = $('#fg-left', S.root);
  const btns = $('#fg-step-btns', S.root);
  const rightWrap = $('#fg-right-wrap', S.root);
  rightWrap.hidden = id !== 'planets';
  btns.innerHTML = '';
  const addBtn = (label, fn, { dice = false, id: bid } = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fg-btn';
    if (bid) b.id = bid;
    b.innerHTML = `${dice ? '<i class="dice"></i>' : ''}${esc(label)}`;
    b.addEventListener('click', fn);
    btns.append(b);
    return b;
  };
  if (id === 'sky') {
    addBtn('Randomize environment', () => {
      S.draft.sky = P.randomSky();
      touched();
      app.applySky(S.draft);
      renderStep();
    }, { dice: true, id: 'fg-rand-step' });
    addBtn('Reset', () => {
      S.draft.sky = {};
      touched();
      app.applySky(S.draft);
      renderStep();
    });
    renderSky(left);
  } else if (id === 'star') {
    addBtn('Randomize star', () => {
      S.draft.sun = P.randomSun();
      S.draft.star = P.legacyStarFor(S.draft.sun.temp);
      touched();
      app.system.setSun(P.sunOf(S.draft));
      renderStep();
    }, { dice: true, id: 'fg-rand-step' });
    addBtn('Reset', () => applyStarPreset('g'));
    renderStar(left);
  } else if (id === 'planets') {
    addBtn('Randomize all planets', async () => {
      const n = S.draft.planets.length || 5;
      await replacePlanets(Array.from({ length: n }, () => P.randomPlanet({ id: newId() })));
    }, { dice: true, id: 'fg-rand-step' });
    renderPlanetList(left);
    renderPlanetEditor();
  } else {
    addBtn('Randomize galaxy', () => {
      S.draft.system = P.randomSystem();
      touched();
      app.applySystem(S.draft);
      renderStep();
    }, { dice: true, id: 'fg-rand-step' });
    addBtn('Reset', () => {
      S.draft.system = {};
      touched();
      app.applySystem(S.draft);
      renderStep();
    });
    renderGalaxy(left);
  }
}

function touched() {
  S.dirty = true;
}

// --------------------------------------------------------------------------- 1. environment

function renderSky(root) {
  const sky = () => P.skyOf(S.draft);
  root.innerHTML = `<section class="fg-sec" data-group="Presets"><div class="fg-sec-head"><span>Presets</span></div>
    <div class="fg-presets">${Object.entries(NEBULAE)
      .map(([id, n]) => `<button type="button" class="fg-preset ${id === S.draft.nebula && !Object.keys(S.draft.sky ?? {}).length ? 'active' : ''}" data-preset="${id}">
        <i style="background:radial-gradient(circle at 35% 40%, ${n.a}, ${n.b} 70%)"></i>${esc(n.label)}</button>`)
      .join('')}</div></section><div id="fg-sky-fields"></div>`;
  root.querySelectorAll('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      S.draft.nebula = b.dataset.preset;
      S.draft.sky = {};
      touched();
      app.applySky(S.draft);
      renderStep();
    }),
  );
  renderFields($('#fg-sky-fields', root), P.SKY_FIELDS, {
    get: (k) => sky()[k],
    set: (k, v) => {
      S.draft.sky = { ...(S.draft.sky ?? {}), [k]: v };
      touched();
      app.applySky(S.draft);
      root.querySelectorAll('.fg-preset').forEach((x) => x.classList.remove('active'));
    },
    randomGroup: (fields) => {
      const r = P.randomSky();
      const patch = Object.fromEntries(fields.map((f) => [f.key, r[f.key]]));
      S.draft.sky = { ...(S.draft.sky ?? {}), ...patch };
      touched();
      app.applySky(S.draft);
    },
  });
}

// --------------------------------------------------------------------------- 2. star

/** Star settings as the Forge edits them (a galaxy from before the Forge starts from its preset). */
function sunDraft() {
  if (!S.draft.sun) {
    const cur = P.sunOf(S.draft);
    S.draft.sun = { ...Object.fromEntries(P.SUN_FIELDS.map((f) => [f.key, cur[f.key]])), label: cur.label };
  }
  return S.draft.sun;
}

function applyStarPreset(key) {
  const p = P.STAR_PRESETS[key];
  S.draft.sun = { ...P.SUN_DEFAULTS, ...p.sun, surface: 'auto', tint: 0.85, label: p.label };
  S.draft.star = P.legacyStarFor(p.sun.temp);
  touched();
  app.system.setSun(P.sunOf(S.draft));
  app.forgeFrameStar(false);
  renderStep();
}

function renderStar(root) {
  const sun = P.sunOf(S.draft);
  root.innerHTML = `<section class="fg-sec" data-group="Star class"><div class="fg-sec-head"><span>Star class</span></div>
    <div class="fg-stars">${Object.entries(P.STAR_PRESETS)
      .map(([id, p]) => `<button type="button" class="fg-starbtn ${sun.label === p.label && sun.temp === p.sun.temp ? 'active' : ''}" data-star="${id}">
        <i style="background:${P.glowForTemp(p.sun.temp)};color:${P.glowForTemp(p.sun.temp)}"></i><span>${esc(p.label)}<small>${esc(p.note)}</small></span></button>`)
      .join('')}</div></section><div id="fg-star-fields"></div>`;
  root.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => applyStarPreset(b.dataset.star)));
  renderFields($('#fg-star-fields', root), P.SUN_FIELDS, {
    get: (k) => P.sunOf(S.draft)[k],
    set: (k, v, final) => {
      const sun2 = sunDraft();
      sun2[k] = v;
      if (k === 'temp') {
        delete sun2.label; // named after the nearest star class again
        S.draft.star = P.legacyStarFor(v);
      }
      touched();
      app.system.setSun(P.sunOf(S.draft));
      if (k === 'radius' && final) app.forgeFrameStar(false);
      if (final && k === 'temp') root.querySelectorAll('.fg-starbtn').forEach((x) => x.classList.remove('active'));
    },
    randomGroup: (fields) => {
      const r = P.randomSun();
      const sun2 = sunDraft();
      for (const f of fields) sun2[f.key] = r[f.key];
      if (fields.some((f) => f.key === 'temp')) {
        delete sun2.label;
        S.draft.star = P.legacyStarFor(sun2.temp);
      }
      touched();
      app.system.setSun(P.sunOf(S.draft));
    },
  });
}

// --------------------------------------------------------------------------- 3. planets

function renderPlanetList(root) {
  const planets = S.draft.planets;
  root.innerHTML = `
    <section class="fg-sec" data-group="Count"><div class="fg-sec-head"><span>Number of planets</span></div>
      <div class="fg-count">
        <button type="button" class="fg-btn" data-count="-1" ${planets.length ? '' : 'disabled'}>−</button>
        <output>${planets.length}</output>
        <button type="button" class="fg-btn" data-count="1" ${planets.length >= 14 ? 'disabled' : ''}>+</button>
        <span class="fg-note">New ones are random. Up to 14.</span>
      </div>
    </section>
    <section class="fg-sec" data-group="Planets"><div class="fg-sec-head"><span>Planets <em>inner → outer</em></span></div>
      <ul class="fg-plist">${planets
        .map((p, i) => {
          const t = getType(p.type);
          return `<li class="${p.id === S.sel ? 'active' : ''}" data-id="${p.id}">
            <button type="button" class="fg-pick"><img src="${t.maps.thumb}" alt=""><span><b>${esc(p.name)}</b><small>${esc(t.name)} · ${P.moonsOf(p, t).length} moon${P.moonsOf(p, t).length === 1 ? '' : 's'}${P.planetValue(p, 'rings', t) ? ' · rings' : ''}</small></span></button>
            <span class="fg-ops">
              <button type="button" data-op="up" title="Move inward" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button type="button" data-op="down" title="Move outward" ${i === planets.length - 1 ? 'disabled' : ''}>▼</button>
              <button type="button" data-op="dup" title="Duplicate">⧉</button>
              <button type="button" data-op="del" title="Remove">✕</button>
            </span></li>`;
        })
        .join('')}</ul>
      <div class="fg-btns">
        <button type="button" class="fg-btn" id="fg-add">+ Add planet</button>
        <button type="button" class="fg-btn" id="fg-add-rand"><i class="dice"></i>Add random planet</button>
      </div>
    </section>`;
  root.querySelectorAll('[data-count]').forEach((b) =>
    b.addEventListener('click', () => {
      if (+b.dataset.count > 0) addPlanet(P.randomPlanet({ id: newId() }), false);
      else if (planets.length) removePlanet(planets[planets.length - 1].id);
    }),
  );
  root.querySelectorAll('.fg-plist li').forEach((li) => {
    const id = li.dataset.id;
    li.querySelector('.fg-pick').addEventListener('click', () => {
      S.sel = id;
      setMobileView('edit');
      app.forgeFocus(id);
      renderStep();
    });
    li.querySelectorAll('[data-op]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = planets.findIndex((p) => p.id === id);
        const op = b.dataset.op;
        if (op === 'del') return removePlanet(id);
        if (op === 'dup') {
          const copy = { ...structuredClone(planets[i]), id: newId(), name: `${planets[i].name} II`, completed: 0 };
          return addPlanet(copy, true, i + 1);
        }
        const j = op === 'up' ? i - 1 : i + 1;
        [planets[i], planets[j]] = [planets[j], planets[i]];
        touched();
        app.system.layout(false);
        renderStep();
      }),
    );
  });
  $('#fg-add', root).addEventListener('click', () =>
    addPlanet({ id: newId(), name: P.randomName(), course: 'New course', lessons: 10, completed: 0, type: 'terra', size: 1, hue: 0 }, true),
  );
  $('#fg-add-rand', root).addEventListener('click', () => addPlanet(P.randomPlanet({ id: newId() }), true));
}

function addPlanet(p, select = true, at = S.draft.planets.length) {
  if (S.draft.planets.length >= 14) return;
  S.draft.planets.splice(at, 0, p);
  touched();
  app.forgeAddPlanet(p);
  if (select || !S.sel) {
    S.sel = p.id;
    if (select) setMobileView('edit');
    app.forgeFocus(p.id);
  }
  renderStep();
}

function removePlanet(id) {
  const planets = S.draft.planets;
  const i = planets.findIndex((p) => p.id === id);
  if (i < 0) return;
  planets.splice(i, 1);
  touched();
  app.forgeRemovePlanet(id);
  if (S.sel === id) {
    S.sel = planets[Math.min(i, planets.length - 1)]?.id ?? null;
    if (S.sel) app.forgeFocus(S.sel);
    else app.forgeFrameStar(true);
  }
  renderStep();
}

async function replacePlanets(list) {
  const planets = S.draft.planets;
  planets.splice(0, planets.length, ...list);
  touched();
  await reloadPreview();
  S.sel = planets[0]?.id ?? null;
  renderStep();
  applyCamera();
}

async function reloadPreview() {
  await app.loadSystem(S.draft);
  for (const b of app.system.bodies.values()) b.planet.instant = true;
}

let rebuildTimer = null;
function scheduleRebuild(p, now = false) {
  clearTimeout(rebuildTimer);
  const run = () => {
    if (!S || !app.system?.bodies.has(p.id)) return;
    app.forgeRebuildPlanet(p);
    if (S.sel === p.id) app.forgeFocus(p.id);
  };
  if (now) run();
  else rebuildTimer = setTimeout(run, 140);
}

function renderPlanetEditor() {
  const head = $('#fg-right-head', S.root);
  const root = $('#fg-right', S.root);
  const p = S.draft.planets.find((x) => x.id === S.sel);
  if (!p) {
    head.innerHTML = '<div class="fg-kicker">PLANET</div><h2>No planet selected</h2><p>Add a planet to start shaping it.</p>';
    root.innerHTML = '';
    return;
  }
  const t = getType(p.type);
  head.innerHTML = `<div class="fg-kicker">PLANET ${S.draft.planets.indexOf(p) + 1} OF ${S.draft.planets.length}</div>
    <h2>${esc(p.name)}</h2><p>${esc(t.kind)}</p>
    <div class="fg-btns"><button type="button" class="fg-btn" id="fg-rand-planet"><i class="dice"></i>Randomize planet</button>
      <button type="button" class="fg-btn" id="fg-reset-planet">Reset look</button></div>`;
  $('#fg-rand-planet', head).addEventListener('click', () => {
    const r = P.randomPlanet();
    for (const k of P.PLANET_LOOK_KEYS) p[k] = r[k];
    touched();
    scheduleRebuild(p, true);
    renderStep();
  });
  $('#fg-reset-planet', head).addEventListener('click', () => {
    for (const k of P.PLANET_LOOK_KEYS) if (k !== 'type') delete p[k];
    touched();
    scheduleRebuild(p, true);
    renderStep();
  });

  root.innerHTML = `<section class="fg-sec" data-group="Course"><div class="fg-sec-head"><span>Course</span></div>
      <div class="fg-row"><label for="fg-p-name"><span>Planet name</span></label><input id="fg-p-name" type="text" maxlength="24" value="${esc(p.name)}"></div>
      <div class="fg-row"><label for="fg-p-course"><span>Course</span></label><input id="fg-p-course" type="text" maxlength="60" value="${esc(p.course)}"></div>
      <div class="fg-row"><label for="fg-p-lessons"><span>Lessons (sectors)</span></label><input id="fg-p-lessons" type="number" min="1" max="200" value="${p.lessons}"></div>
    </section><div id="fg-p-fields"></div><div id="fg-p-moons"></div>`;
  const text = (sel, key, fn = (v) => v) =>
    $(sel, root).addEventListener('input', (e) => {
      p[key] = fn(e.target.value);
      touched();
      if (key === 'name') {
        $('h2', head).textContent = p.name;
        const li = S.root.querySelector(`.fg-plist li[data-id="${p.id}"] b`);
        if (li) li.textContent = p.name;
      }
    });
  text('#fg-p-name', 'name');
  text('#fg-p-course', 'course');
  text('#fg-p-lessons', 'lessons', (v) => Math.max(1, Math.min(200, parseInt(v, 10) || 1)));

  renderFields($('#fg-p-fields', root), P.PLANET_FIELDS, {
    ctx: t,
    get: (k) => P.planetValue(p, k, getType(p.type)),
    set: (k, v, final) => {
      touched();
      if (k === 'type') {
        p.type = v;
        P.clearTypeOverrides(p);
        scheduleRebuild(p, true);
        renderStep();
        return;
      }
      p[k] = v;
      if (k === 'rings' && v) p.belt = false;
      if (P.PLANET_REBUILD_KEYS.includes(k)) {
        scheduleRebuild(p, final);
        if (final && ['rings', 'belt', 'atmo', 'clouds'].includes(k)) renderPlanetListOnly();
      } else app.system.refreshPlanet(p);
    },
    randomGroup: (fields) => {
      const cur = getType(p.type);
      for (const f of fields) {
        if (f.key === 'type') continue;
        p[f.key] = P.randomValue(f, cur);
      }
      if (p.rings) p.belt = false;
      touched();
      scheduleRebuild(p, true);
      renderPlanetListOnly();
    },
  });
  renderMoons($('#fg-p-moons', root), p, (moons) => {
    p.moons = moons;
    touched();
    scheduleRebuild(p);
    renderPlanetListOnly();
  });
}

function renderPlanetListOnly() {
  const left = $('#fg-left', S.root);
  const top = left.scrollTop;
  renderPlanetList(left);
  left.scrollTop = top;
}

// --------------------------------------------------------------------------- 4. galaxy

function renderGalaxy(root) {
  const d = S.draft;
  const planets = d.planets;
  const moons = planets.reduce((n, p) => n + P.moonsOf(p).length, 0);
  const sun = P.sunOf(d);
  root.innerHTML = `<section class="fg-sec" data-group="Name"><div class="fg-sec-head"><span>Name</span>
      <button type="button" class="fg-mini" id="fg-rand-name"><i class="dice"></i>RANDOM</button></div>
      <div class="fg-row"><label for="fg-g-name"><span>Galaxy name</span></label><input id="fg-g-name" type="text" maxlength="28" value="${esc(d.name)}"></div>
      <div class="fg-summary">
        <div><span class="k">STAR</span><span class="v">${esc(sun.label)}</span></div>
        <div><span class="k">PLANETS</span><span class="v">${planets.length}</span></div>
        <div><span class="k">MOONS</span><span class="v">${moons}</span></div>
        <div><span class="k">LESSONS</span><span class="v">${planets.reduce((n, p) => n + (+p.lessons || 0), 0)}</span></div>
      </div>
    </section><div id="fg-sys-fields"></div>
    ${S.mode === 'edit' && store.state.galaxies.length > 1 ? '<section class="fg-sec"><div class="fg-sec-head"><span>Danger zone</span></div><button type="button" class="fg-btn danger" id="fg-delete">Delete this galaxy</button></section>' : ''}`;
  const name = $('#fg-g-name', root);
  name.addEventListener('input', () => {
    d.name = name.value;
    touched();
    renderName();
  });
  $('#fg-rand-name', root).addEventListener('click', () => {
    d.name = P.randomGalaxyName();
    name.value = d.name;
    touched();
    renderName();
  });
  $('#fg-delete', root)?.addEventListener('click', deleteGalaxy);
  renderFields($('#fg-sys-fields', root), P.SYSTEM_FIELDS, {
    get: (k) => P.systemOf(d)[k],
    set: (k, v) => {
      d.system = { ...(d.system ?? {}), [k]: v };
      touched();
      app.applySystem(d);
    },
    randomGroup: (fields) => {
      const r = P.randomSystem();
      d.system = { ...(d.system ?? {}), ...Object.fromEntries(fields.map((f) => [f.key, r[f.key]])) };
      touched();
      app.applySystem(d);
    },
  });
}

// --------------------------------------------------------------------------- randomize everything

async function randomizeAll() {
  const d = S.draft;
  d.sky = P.randomSky();
  d.nebula = 'violet';
  d.sun = P.randomSun();
  d.star = P.legacyStarFor(d.sun.temp);
  d.system = P.randomSystem();
  d.name = P.randomGalaxyName();
  const n = 3 + ((Math.random() * 6) | 0);
  const planets = Array.from({ length: n }, () => P.randomPlanet({ id: newId() }));
  if (Math.random() < 0.7) planets.sort((a, b) => P.GIANTS.has(a.type) - P.GIANTS.has(b.type));
  renderName();
  await replacePlanets(planets);
}

// =========================================================================== //
//  Guided demo
// =========================================================================== //
//
// Plays through every step, moving the real controls so the preview changes as it explains
// them. Next / Skip at any time; afterwards the draft is put back exactly as it was.

const DEMO = [
  { step: 0, target: '.fg-steps', title: 'Welcome to the Galaxy Forge', text: 'Four steps: the environment, the star, the planets and the galaxy as a whole. The preview behind the panels updates live as you change anything.' },
  { step: 0, target: '[data-group="Presets"]', title: 'Start from a preset', text: 'Each preset is a complete sky. Watch the nebula change colour.', act: async (c) => {
    for (const id of ['ember', 'emerald', 'teal', 'violet']) { await clickEl(`[data-preset="${id}"]`, c); await c.wait(900); }
  } },
  { step: 0, target: '[data-group="Nebula"]', title: 'Shape the nebula', text: 'Colours, intensity, cloud scale and pattern. Every slider previews while you drag it.', act: async (c) => {
    await slide('nebula', 2.2, 1100, c);
    await slide('seed', 42, 1400, c);
    await slide('nebula', 1, 700, c);
  } },
  { step: 0, target: '[data-group="Milky Way"]', title: 'Tilt the Milky Way', text: 'Brightness, width, colour, core glow and dust lanes of the band of stars, and how it tilts across your sky.', act: async (c) => {
    await slide('tilt', 40, 1300, c);
    await slide('bandWidth', 2.2, 1000, c);
    await slide('bandWidth', 1, 700, c);
  } },
  { step: 0, target: '.fg-view', title: 'Look all the way around', text: 'The sky wraps 360°. Drag anywhere on the scene to look around, scroll to zoom, or let AUTO-SPIN turn the view for you.' },
  { step: 0, target: '#fg-rand-step', title: 'Random buttons everywhere', text: 'Randomize a whole step here, or a single section with its RANDOM button. Double-click any slider’s name to reset it.', act: async (c) => {
    await clickEl('#fg-rand-step', c);
    await c.wait(1300);
  } },
  { step: 1, target: '[data-group="Star class"]', title: 'Choose a star', text: 'From tiny white dwarfs to swollen red giants. Each preset is just a starting point.', act: async (c) => {
    for (const id of ['m', 'b', 'rg', 'g']) { await clickEl(`[data-star="${id}"]`, c); await c.wait(1100); }
  } },
  { step: 1, target: '[data-key="temp"]', title: 'Temperature is colour', text: 'Cool stars glow orange-red, hot ones blue-white, and their light tints every planet in the system.', act: async (c) => {
    await slide('temp', 3000, 1300, c);
    await slide('temp', 14000, 1500, c);
    await slide('temp', 5800, 1000, c);
  } },
  { step: 1, target: '[data-group="Glow"]', title: 'Corona, halo and rays', text: 'Size and strength of the glow around the star, and light rays for a brilliant, compact star.', act: async (c) => {
    await slide('spikes', 0.7, 1000, c);
    await slide('coronaSize', 5.5, 1000, c);
    await slide('coronaSize', 3.6, 700, c);
  } },
  { step: 2, target: '[data-group="Count"]', title: 'How many planets', text: 'Each planet is a course. Add or remove them here; new ones are random worlds. Reorder, duplicate or remove any in the list below.', act: async (c) => {
    await clickEl('[data-count="1"]', c);
    await c.wait(1200);
  } },
  { step: 2, target: '[data-key="type"]', title: 'Pick the world', text: 'Twenty-one Blender-made planet types: ocean worlds, deserts, lava, ice moons, gas and ice giants.', right: true, act: async (c) => {
    await clickEl('[data-type="terra"]', c);
    await c.wait(1400);
  } },
  { step: 2, target: '[data-group="Surface"]', title: 'Tune the look', text: 'Colour shift, saturation, brightness, terrain relief, ocean glint and city lights.', right: true, act: async (c) => {
    await slide('hue', 1.6, 1300, c);
    await slide('hue', 0, 900, c);
  } },
  { step: 2, target: '[data-group="Rings"]', title: 'Rings and belts', text: 'Give any world rings in four styles and set their size and colour, or a belt of tumbling rocks instead.', right: true, act: async (c) => {
    await clickEl('[data-key="rings"] [data-v="1"]', c);
    await c.wait(900);
    await slide('ringOuter', 3, 1200, c);
  } },
  { step: 2, target: '#fg-p-moons', title: 'Moons', text: 'Every world starts with the moons a real one would have: one big moon for an Earth-like world, a family for giants, none for a hot Jupiter. Add your own or tune each one.', right: true, act: async (c) => {
    await clickEl('#fg-p-moons [data-act="add"]', c);
    await c.wait(1300);
  } },
  { step: 2, target: '#fg-rand-planet', title: 'A truly random planet', text: 'One click picks every setting of this world at random: type, colours, atmosphere, clouds, rings, moons, tilt and spin.', right: true, act: async (c) => {
    await clickEl('#fg-rand-planet', c);
    await c.wait(1500);
  } },
  { step: 3, target: '[data-group="Orbits"]', title: 'The system as a whole', text: 'Name your galaxy, then space out the orbits, speed them up and tune the main asteroid belt, moons, exposure and bloom.', act: async (c) => {
    await slide('orbitGap', 20, 1300, c);
    await slide('orbitGap', 11, 900, c);
  } },
  { step: 3, target: '#fg-create', title: 'Create it', text: 'When it looks right, create the galaxy and warp to it. Switch galaxies with Q / E, and reopen the Forge any time from the galaxy menu with CUSTOMIZE.' },
];

function stopDemo() {
  if (S?.tour) S.tour.stop();
}

/** Run the guided demo. The draft is snapshotted and restored afterwards. */
async function runDemo() {
  if (!S || S.tour) return;
  try {
    localStorage.setItem(DEMO_KEY, '1');
  } catch {
    /* ignore */
  }
  const snap = { draft: structuredClone(S.draft), step: S.step, sel: S.sel, dirty: S.dirty, spin: S.spin };
  const layer = document.createElement('div');
  layer.className = 'tour';
  layer.innerHTML = `<div class="tour-spot"></div>
    <div class="tour-card"><div class="tour-kicker"><span>DEMO</span><span class="tour-n"></span></div>
      <h3></h3><p></p><div class="tour-bar"><i></i></div>
      <div class="tour-actions">
        <button type="button" class="prompt" data-t="skip"><span class="pl">END DEMO</span><kbd>ESC</kbd></button>
        <button type="button" class="prompt" data-t="next"><span class="pl">NEXT</span><kbd>&rarr;</kbd></button>
      </div></div>`;
  S.root.append(layer);
  let stopped = false;
  let skipStep = null;
  const tour = {
    stop() {
      stopped = true;
      skipStep?.();
    },
  };
  S.tour = tour;
  layer.querySelector('[data-t=skip]').addEventListener('click', () => tour.stop());
  layer.querySelector('[data-t=next]').addEventListener('click', () => skipStep?.());
  const keyNext = (e) => {
    if (e.key === 'ArrowRight' && S?.tour === tour) {
      e.preventDefault();
      skipStep?.();
    }
  };
  window.addEventListener('keydown', keyNext);
  const follow = setInterval(() => placeSpot(layer), 200);

  for (let i = 0; i < DEMO.length && !stopped; i++) {
    const d = DEMO[i];
    if (S.step !== d.step) {
      goStep(d.step);
      await wait(700);
    }
    let skipped = false;
    const ctl = {
      get cancelled() {
        return skipped || stopped;
      },
      wait: (ms) => new Promise((r) => {
        const t = setTimeout(r, ms);
        const prev = skipStep;
        skipStep = () => {
          clearTimeout(t);
          r();
          prev?.();
        };
      }),
    };
    const skipper = new Promise((r) => {
      skipStep = () => {
        skipped = true;
        r();
      };
    });
    layer.querySelector('.tour-n').textContent = `${i + 1} / ${DEMO.length}`;
    layer.querySelector('h3').textContent = d.title;
    layer.querySelector('p').textContent = d.text;
    layer.querySelector('.tour-bar i').style.width = `${((i + 1) / DEMO.length) * 100}%`;
    layer.querySelector('[data-t=next] .pl').textContent = i === DEMO.length - 1 ? 'FINISH' : 'NEXT';
    setMobileView(d.right ? 'edit' : 'list');
    spotlight(layer, d.target);
    const act = (d.act ? d.act(ctl) : Promise.resolve()).then(() => !skipped && !stopped && wait(d.act ? 1600 : 4200));
    await Promise.race([act, skipper]);
  }

  clearInterval(follow);
  window.removeEventListener('keydown', keyNext);
  layer.remove();
  S.tour = null;
  // put the draft back the way it was before the demo
  S.draft = snap.draft;
  app.forge.draft = S.draft;
  S.sel = snap.sel;
  S.dirty = snap.dirty;
  S.spin = snap.spin;
  await reloadPreview();
  renderName();
  goStep(snap.step);
  toast('Demo finished. Your galaxy is back as it was.', { kicker: 'GALAXY FORGE', sub: 'NOW MAKE IT YOURS' });
}

function spotlight(layer, sel) {
  layer.sel = sel;
  S.root.querySelector(sel)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  placeSpot(layer);
}

/**
 * Keep the spotlight and its card on the current step's control. The target is looked up again
 * every time: the demo's own clicks re-render the panels, which replaces the elements.
 */
function placeSpot(layer) {
  const spot = layer.querySelector('.tour-spot');
  const card = layer.querySelector('.tour-card');
  const el = layer.sel && S?.root.querySelector(layer.sel);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cw = card.offsetWidth || 360;
  const ch = card.offsetHeight || 200;
  let r = el?.getBoundingClientRect();
  if (!r || !r.width || !r.height) {
    if (el || !layer.sel) {
      // no target (or it's hidden in this layout): centre the card
      spot.style.opacity = '0';
      card.style.left = `${(W - cw) / 2}px`;
      card.style.top = `${(H - ch) / 2}px`;
    }
    return;
  }
  // clip to the visible part of the scrolling panel the control sits in
  const box = el.closest('.fg-scroll')?.getBoundingClientRect() ?? { top: 0, bottom: H, left: 0, right: W };
  const top = Math.max(r.top, box.top);
  const bottom = Math.min(r.bottom, box.bottom);
  r = { left: r.left, right: r.right, width: r.width, top, bottom, height: Math.max(0, bottom - top) };
  const pad = 6;
  Object.assign(spot.style, {
    opacity: r.height > 0 ? '1' : '0',
    left: `${r.left - pad}px`,
    top: `${r.top - pad}px`,
    width: `${r.width + pad * 2}px`,
    height: `${r.height + pad * 2}px`,
  });
  let x;
  let y;
  if (W <= 760) {
    // phones: full-width card above or below the highlighted control
    x = 16;
    y = r.top + r.height / 2 > H / 2 ? Math.max(8, r.top - ch - 16) : Math.min(H - ch - 8, r.bottom + 16);
  } else {
    // beside the control, toward the middle of the screen
    const onLeft = r.left + r.width / 2 < W / 2;
    x = onLeft ? r.right + 24 : r.left - cw - 24;
    if (x < 16 || x + cw > W - 16) x = (W - cw) / 2;
    y = Math.max(80, Math.min(H - ch - 16, r.top));
  }
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
}

async function clickEl(sel, c) {
  if (c.cancelled) return;
  const el = S?.root.querySelector(sel);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest' });
  el.classList.add('tour-press');
  await c.wait(350);
  el.classList.remove('tour-press');
  if (!c.cancelled) el.click();
}

/** Drag a slider (by field key) to a value over `ms`, previewing as it goes. */
async function slide(key, to, ms, c) {
  if (c.cancelled) return;
  const input = S?.root.querySelector(`input[type=range][data-key="${key}"]`);
  if (!input) return;
  input.closest('.fg-row')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const from = parseFloat(input.value);
  const start = performance.now();
  input.closest('.fg-row')?.classList.add('tour-live');
  await new Promise((resolve) => {
    const step = (now) => {
      const t = c.cancelled ? 1 : Math.min(1, (now - start) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      input.value = from + (to - from) * e;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.closest('.fg-row')?.classList.remove('tour-live');
}
