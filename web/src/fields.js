// Builds controls from the schemas in params.js: sliders, colour pickers, on/off switches,
// option pickers and the planet-type grid, grouped into sections that each have their own
// random button. Used by the Galaxy Forge and the planet dialog.
import { planetTypes, getType } from './assets.js';
import { MOON_TYPES, MOON_DEFAULTS, moonsOf, randomMoons, fieldDefault } from './params.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmt(f, v) {
  if (f.type !== 'range') return v;
  const d = Math.max(0, -Math.floor(Math.log10(f.step)));
  return `${(+v).toFixed(Math.min(d, 2))}${f.unit ?? ''}`;
}

const labelOf = (f, ctx) => (typeof f.label === 'function' ? f.label(ctx) : f.label);

/**
 * Render schema fields into `root`, grouped by `field.group`.
 *   get(key)                 current value (override or default)
 *   set(key, value, final)   `final` is false while a slider is being dragged
 *   ctx                      passed to per-type defaults and conditions (a planet type)
 *   randomGroup(fields)      optional: shows a random button on each section
 *   only                     optional list of group names to render
 */
export function renderFields(root, fields, opts) {
  const { get, set, ctx, randomGroup, only } = opts;
  const rerender = () => renderFields(root, fields, opts);
  root.innerHTML = '';
  const groups = new Map();
  for (const f of fields) {
    if (only && !only.includes(f.group)) continue;
    if (f.when && !f.when(ctx)) continue;
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }
  for (const [name, list] of groups) {
    const sec = document.createElement('section');
    sec.className = 'fg-sec';
    sec.dataset.group = name;
    sec.innerHTML = `<div class="fg-sec-head"><span>${esc(name)}</span></div>`;
    if (randomGroup) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fg-mini';
      b.title = `Randomize ${name.toLowerCase()}`;
      b.innerHTML = '<i class="dice"></i>RANDOM';
      b.addEventListener('click', () => {
        randomGroup(list);
        rerender();
      });
      sec.firstChild.append(b);
    }
    for (const f of list) {
      if (f.needs && !get(f.needs)) continue;
      sec.append(fieldRow(f, get(f.key), { ctx, get, set, rerender }));
    }
    root.append(sec);
  }
}

function fieldRow(f, value, { ctx, get, set, rerender }) {
  const row = document.createElement('div');
  row.className = `fg-row fg-${f.type}`;
  row.dataset.key = f.key;
  const label = labelOf(f, ctx);
  const blocked = f.blocked && get(f.blocked);
  const hint = f.hint ? `<span class="fg-hint">${esc(f.hint)}</span>` : '';

  if (f.type === 'range') {
    row.innerHTML = `<label><span>${esc(label)}</span><output>${fmt(f, value)}</output></label>
      <input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${value}">
      ${f.hue ? '<div class="hue-track"></div>' : ''}${hint}`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    input.addEventListener('input', () => {
      out.textContent = fmt(f, input.value);
      set(f.key, parseFloat(input.value), false);
    });
    input.addEventListener('change', () => set(f.key, parseFloat(input.value), true));
    // double-click the label to put a slider back to its default
    row.querySelector('label').addEventListener('dblclick', () => {
      const d = fieldDefault(f, ctx);
      input.value = d;
      out.textContent = fmt(f, d);
      set(f.key, d, true);
    });
  } else if (f.type === 'color') {
    row.innerHTML = `<label><span>${esc(label)}</span><output>${esc(String(value).toUpperCase())}</output></label>
      <div class="fg-color"><input type="color" data-key="${f.key}" value="${value}"><span style="background:${value}"></span></div>${hint}`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    const chip = row.querySelector('.fg-color span');
    input.addEventListener('input', () => {
      out.textContent = input.value.toUpperCase();
      chip.style.background = input.value;
      set(f.key, input.value, false);
    });
    input.addEventListener('change', () => set(f.key, input.value, true));
  } else if (f.type === 'toggle') {
    row.innerHTML = `<label><span>${esc(label)}</span></label>
      <div class="seg" data-key="${f.key}"><button type="button" data-v="1">On</button><button type="button" data-v="0">Off</button></div>${hint}`;
    row.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.v === '1';
      b.classList.toggle('active', on === !!value && !(blocked && on));
      if (blocked && on) {
        b.disabled = true;
        b.title = 'Ringed worlds already have rings';
      }
      b.addEventListener('click', () => {
        set(f.key, on, true);
        rerender();
      });
    });
  } else if (f.type === 'select') {
    const options = f.options(ctx);
    row.innerHTML = `<label><span>${esc(label)}</span></label>
      <div class="seg wrap" data-key="${f.key}">${options.map((o) => `<button type="button" data-v="${o.value}" class="${o.value === value ? 'active' : ''}">${esc(o.label)}</button>`).join('')}</div>${hint}`;
    row.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        set(f.key, b.dataset.v, true);
        rerender();
      }),
    );
  } else if (f.type === 'types') {
    row.innerHTML = `<label><span>${esc(label)}</span><output>${esc(getType(value).kind)}</output></label>
      <div class="biomes" data-key="${f.key}">${planetTypes()
        .map((t) => `<button type="button" class="biome ${t.id === value ? 'active' : ''}" data-type="${t.id}" title="${esc(t.kind)}">
          <img class="orb" src="${t.maps.thumb}" alt="" draggable="false">${esc(t.name)}</button>`)
        .join('')}</div>`;
    row.querySelectorAll('.biome').forEach((b) =>
      b.addEventListener('click', () => {
        set(f.key, b.dataset.type, true);
        rerender();
      }),
    );
  }
  return row;
}

// --------------------------------------------------------------------------- moons

const moonTypeName = (id) => getType(id).name;

/**
 * The moon editor for one planet. Until the planet gets its own list it shows the realistic
 * moons for its type; the first edit copies them into `planet.moons`.
 * `onChange(moons)` receives a fresh array every time (or `undefined` for "realistic").
 */
export function renderMoons(root, planet, onChange) {
  const def = getType(planet.type);
  const own = Array.isArray(planet.moons);
  const moons = moonsOf(planet, def);
  const rerender = () => renderMoons(root, planet, onChange);
  const commit = (list) => {
    onChange(list);
    rerender();
  };
  const real = MOON_DEFAULTS[def.id] ?? [];
  root.innerHTML = `<section class="fg-sec" data-group="Moons">
    <div class="fg-sec-head"><span>Moons <em>${moons.length}</em></span>
      <button type="button" class="fg-mini" data-act="random"><i class="dice"></i>RANDOM</button></div>
    <p class="fg-note">${own ? 'Custom moons.' : real.length
      ? `Realistic for a ${esc(def.kind.toLowerCase())}: ${real.length} moon${real.length > 1 ? 's' : ''}.`
      : `A real ${esc(def.kind.toLowerCase())} would have no moons.`}</p>
    <div class="fg-moons"></div>
    <div class="fg-btns">
      <button type="button" class="fg-btn" data-act="add">+ Add moon</button>
      <button type="button" class="fg-btn" data-act="real" ${own ? '' : 'disabled'}>Realistic</button>
      <button type="button" class="fg-btn" data-act="none" ${moons.length ? '' : 'disabled'}>None</button>
    </div></section>`;
  const list = root.querySelector('.fg-moons');
  moons.forEach((m, i) => {
    const card = document.createElement('div');
    card.className = 'fg-moon';
    card.innerHTML = `
      <div class="fg-moon-head"><span>Moon ${i + 1}</span>
        <select data-k="type">${MOON_TYPES.map((t) => `<option value="${t}" ${t === m.type ? 'selected' : ''}>${esc(moonTypeName(t))}</option>`).join('')}</select>
        <button type="button" class="fg-x" title="Remove moon">✕</button></div>
      <label><span>Size</span><output>${(m.size ?? 0.15).toFixed(2)}</output></label>
      <input type="range" data-k="size" min="0.03" max="0.6" step="0.01" value="${m.size ?? 0.15}">
      <label><span>Distance</span><output>${(m.dist ?? 0.5).toFixed(2)}</output></label>
      <input type="range" data-k="dist" min="0" max="3" step="0.05" value="${m.dist ?? 0.5}">
      <div class="seg small">
        <button type="button" data-k="irregular" class="${m.irregular ? 'active' : ''}">Lumpy</button>
        <button type="button" data-k="retro" class="${m.retro ? 'active' : ''}">Retrograde</button>
      </div>`;
    const edit = (patch, final = true) => {
      const next = moons.map((x, j) => (j === i ? { ...x, ...patch } : { ...x }));
      if (final) commit(next);
      else onChange(next);
    };
    card.querySelector('select').addEventListener('change', (e) => edit({ type: e.target.value }));
    card.querySelectorAll('input[type=range]').forEach((inp) => {
      const out = inp.previousElementSibling.querySelector('output');
      inp.addEventListener('input', () => {
        out.textContent = (+inp.value).toFixed(2);
        edit({ [inp.dataset.k]: +inp.value }, false);
      });
      inp.addEventListener('change', () => edit({ [inp.dataset.k]: +inp.value }));
    });
    card.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => edit({ [b.dataset.k]: !m[b.dataset.k] })));
    card.querySelector('.fg-x').addEventListener('click', () => commit(moons.filter((_, j) => j !== i).map((x) => ({ ...x }))));
    list.append(card);
  });
  root.querySelector('[data-act=add]').addEventListener('click', () => {
    const last = moons.reduce((a, m) => Math.max(a, (m.dist ?? 0) + (m.size ?? 0)), 0);
    commit([...moons.map((x) => ({ ...x })), { type: 'luna', size: 0.14, dist: moons.length ? last + 0.4 : 0.4 }]);
  });
  root.querySelector('[data-act=real]').addEventListener('click', () => commit(undefined));
  root.querySelector('[data-act=none]').addEventListener('click', () => commit([]));
  root.querySelector('[data-act=random]').addEventListener('click', () => commit(randomMoons(def.id)));
}
