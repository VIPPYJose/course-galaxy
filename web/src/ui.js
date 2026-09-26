import { courseStatus } from './galaxy-view.js';
import { GALAXY_STYLES } from './backdrop.js';

const STATUS_TEXT = {
  saved: 'Planet saved',
  active: 'Rescue in progress',
  idle: 'Awaiting rescue',
};

const $ = (sel, root = document) => root.querySelector(sel);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function ring(progress, status) {
  const r = 25;
  const c = 2 * Math.PI * r;
  const p = status === 'saved' ? 1 : Math.max(0, Math.min(1, progress));
  return `<svg class="ring" viewBox="0 0 56 56" aria-hidden="true">
    <circle cx="28" cy="28" r="${r}" class="track"/>
    <circle cx="28" cy="28" r="${r}" class="fill" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}"/>
  </svg>`;
}

export class UI {
  constructor({ store, view, manifest }) {
    this.store = store;
    this.view = view;
    this.types = manifest.planets;
    this.typeById = new Map(this.types.map((t) => [t.id, t]));
    this.onLaunch = null;
    this.current = null;

    this.el = {
      panel: $('#coursePanel'),
      index: $('#cIndex'),
      type: $('#cType'),
      title: $('#cTitle'),
      desc: $('#cDesc'),
      bar: $('#cBar'),
      status: $('#cStatus'),
      pct: $('#cPct'),
      launch: $('#launchBtn'),
      save: $('#saveBtn'),
      more: $('#moreBtn'),
      moreMenu: $('#moreMenu'),
      dock: $('#dockList'),
      prev: $('#prevBtn'),
      next: $('#nextBtn'),
      galaxyBtn: $('#galaxyBtn'),
      galaxyName: $('#galaxyName'),
      galaxyMenu: $('#galaxyMenu'),
      add: $('#addBtn'),
      addDialog: $('#addDialog'),
      addForm: $('#addForm'),
      typeGrid: $('#typeGrid'),
      galaxyDialog: $('#galaxyDialog'),
      galaxyForm: $('#galaxyForm'),
      styleGrid: $('#styleGrid'),
      toast: $('#toast'),
      flash: $('#warpFlash'),
      loader: $('#loader'),
    };

    this._buildTypeGrid();
    this._buildStyleGrid();
    this._bind();
    this.renderGalaxyMenu();
    this.renderDock();
  }

  // ------------------------------------------------------------------ rendering
  renderCourse(detail) {
    const el = this.el;
    if (!detail) {
      el.panel.classList.add('empty');
      el.title.textContent = 'An empty galaxy';
      el.desc.textContent = 'Chart your first planet to start this journey.';
      el.index.textContent = '00 / 00';
      el.type.textContent = 'Uncharted space';
      return;
    }
    el.panel.classList.remove('empty');
    const { course, index, total, def } = detail;
    this.current = course;
    const st = courseStatus(course);
    const pct = st === 'saved' ? 100 : Math.round(course.progress * 100);
    el.index.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    el.type.textContent = `${def.name}-class · ${def.kind}`;
    el.title.textContent = course.title;
    el.desc.textContent = course.description || 'No description yet.';
    el.bar.style.width = `${pct}%`;
    el.panel.dataset.status = st;
    el.status.textContent = STATUS_TEXT[st];
    el.pct.textContent = `${pct}%`;
    el.launch.textContent = st === 'idle' ? 'Launch mission' : st === 'saved' ? 'Revisit mission' : 'Resume mission';
    el.save.textContent = st === 'saved' ? 'Mark as unsaved' : 'Mark as saved';
    el.panel.classList.remove('swap');
    void el.panel.offsetWidth; // restart the entrance animation
    el.panel.classList.add('swap');
    this._markDock();
  }

  renderDock() {
    const g = this.store.activeGalaxy;
    const list = this.el.dock;
    list.innerHTML = g.courses.map((c) => {
      const t = this.typeById.get(c.type);
      const st = courseStatus(c);
      return `<li><button class="dock-item" data-id="${c.id}" data-status="${st}" title="${esc(c.title)}"
          aria-label="${esc(c.title)} – ${STATUS_TEXT[st]}">
          ${ring(c.progress, st)}
          <img src="${t?.maps.thumb || ''}" alt="" loading="lazy" draggable="false">
        </button></li>`;
    }).join('');
    this._markDock();
  }

  _markDock() {
    const id = this.current?.id;
    for (const b of this.el.dock.querySelectorAll('.dock-item')) {
      const on = b.dataset.id === id;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
  }

  renderGalaxyMenu() {
    const g = this.store.activeGalaxy;
    this.el.galaxyName.textContent = g.name;
    this.el.galaxyMenu.innerHTML = this.store.galaxies.map((x) => `
      <button role="menuitemradio" aria-checked="${x.id === g.id}" data-galaxy="${x.id}">
        <span class="swatch" data-style="${x.style}"></span>
        <span class="gname">${esc(x.name)}</span>
        <span class="gcount">${x.courses.length} planets</span>
      </button>`).join('') + `
      <hr>
      <button role="menuitem" data-action="new-galaxy"><span class="plus">+</span> Chart a new galaxy</button>`;
  }

  _buildTypeGrid() {
    this.el.typeGrid.innerHTML = this.types.map((t, i) => `
      <label class="type-card">
        <input type="radio" name="type" value="${t.id}" ${i === 0 ? 'checked' : ''}>
        <img src="${t.maps.thumb}" alt="" draggable="false">
        <span class="tname">${esc(t.name)}</span>
        <span class="tkind">${esc(t.kind)}</span>
      </label>`).join('');
  }

  _buildStyleGrid() {
    this.el.styleGrid.innerHTML = Object.entries(GALAXY_STYLES).map(([id, s], i) => `
      <label class="style-card">
        <input type="radio" name="style" value="${id}" ${i === 0 ? 'checked' : ''}>
        <span class="swatch big" data-style="${id}"></span>
        <span class="tname">${esc(s.label)}</span>
      </label>`).join('');
  }

  // ------------------------------------------------------------------ behaviour
  _bind() {
    const { el, view, store } = this;
    view.addEventListener('focus', (e) => this.renderCourse(e.detail));
    view.addEventListener('transition-start', () => el.panel.classList.add('leaving'));
    view.addEventListener('transition-end', () => el.panel.classList.remove('leaving'));
    view.addEventListener('warp', () => {
      el.flash.classList.remove('go');
      void el.flash.offsetWidth;
      el.flash.classList.add('go');
    });
    view.addEventListener('hero-click', () => {
      el.panel.classList.remove('pulse');
      void el.panel.offsetWidth;
      el.panel.classList.add('pulse');
    });

    store.subscribe((evt) => {
      switch (evt.type) {
        case 'course-added':
          view.addCourse(evt.course);
          this.renderDock();
          this.renderGalaxyMenu();
          break;
        case 'course-updated':
          view.updateCourse(evt.course);
          this.renderDock();
          break;
        case 'course-removed':
          view.removeCourse(evt.course.id);
          this.renderDock();
          this.renderGalaxyMenu();
          if (!store.activeGalaxy.courses.length) this.renderCourse(null);
          break;
        case 'galaxy-changed':
        case 'galaxy-added':
        case 'reset':
          view.setGalaxy(store.activeGalaxy, { warp: true });
          this.renderGalaxyMenu();
          this.renderDock();
          if (!store.activeGalaxy.courses.length) this.renderCourse(null);
          break;
        default:
      }
    });

    el.prev.addEventListener('click', () => view.prev());
    el.next.addEventListener('click', () => view.next());
    el.dock.addEventListener('click', (e) => {
      const b = e.target.closest('.dock-item');
      if (b) view.focusCourse(b.dataset.id);
    });
    $('#dockAdd').addEventListener('click', () => this.openAdd());
    el.add.addEventListener('click', () => this.openAdd());

    el.launch.addEventListener('click', () => this.launch());
    el.save.addEventListener('click', () => {
      const c = this.current;
      if (!c) return;
      const saved = courseStatus(c) !== 'saved';
      store.updateCourse(c.id, { saved, progress: saved ? 1 : Math.min(c.progress, 0.99) });
      if (saved) {
        view.celebrate?.(c.id);
        this.toast(`“${c.title}” is saved. The planet is safe.`);
      }
    });

    // course overflow menu
    el.more.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleMenu(el.moreMenu, el.more);
    });
    el.moreMenu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b || !this.current) return;
      this._toggleMenu(el.moreMenu, el.more, false);
      const c = this.current;
      if (b.dataset.action === 'remove') {
        if (window.confirm(`Remove the planet “${c.title}” from this galaxy?`)) {
          store.removeCourse(c.id);
          this.toast(`Removed “${c.title}”.`);
        }
      } else if (b.dataset.action === 'reset-progress') {
        store.updateCourse(c.id, { saved: false, progress: 0 });
      } else if (b.dataset.action === 'progress') {
        const next = Math.min(1, Math.round((c.progress + 0.25) * 100) / 100);
        store.updateCourse(c.id, { progress: next, saved: next >= 1 });
      }
    });

    // galaxy switcher
    el.galaxyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleMenu(el.galaxyMenu, el.galaxyBtn);
    });
    el.galaxyMenu.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this._toggleMenu(el.galaxyMenu, el.galaxyBtn, false);
      if (b.dataset.action === 'new-galaxy') this.openGalaxy();
      else if (b.dataset.galaxy && b.dataset.galaxy !== store.activeGalaxy.id) store.setActiveGalaxy(b.dataset.galaxy);
    });
    document.addEventListener('click', () => {
      this._toggleMenu(el.galaxyMenu, el.galaxyBtn, false);
      this._toggleMenu(el.moreMenu, el.more, false);
    });

    // add-planet dialog
    $('#surpriseBtn').addEventListener('click', () => {
      const radios = [...el.typeGrid.querySelectorAll('input')];
      radios[Math.floor(Math.random() * radios.length)].checked = true;
      el.typeGrid.querySelector('input:checked').closest('label').scrollIntoView({ block: 'nearest' });
    });
    el.addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(el.addForm);
      const title = String(f.get('title') || '').trim();
      if (!title) return;
      store.addCourse(store.activeGalaxy.id, {
        title,
        description: String(f.get('description') || '').trim(),
        type: f.get('type'),
        size: f.get('size') || 'm',
      });
      el.addDialog.close();
      this.toast(`New planet charted: “${title}”`);
    });
    for (const d of [el.addDialog, el.galaxyDialog]) {
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      d.querySelector('[data-close]').addEventListener('click', () => d.close());
    }

    el.galaxyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(el.galaxyForm);
      const name = String(f.get('name') || '').trim();
      if (!name) return;
      el.galaxyDialog.close();
      store.addGalaxy({ name, style: f.get('style') });
      this.toast(`Warping to ${name}…`);
      setTimeout(() => this.openAdd(), 1900);
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, dialog[open]')) return;
      if (e.key === 'ArrowRight') view.next();
      else if (e.key === 'ArrowLeft') view.prev();
      else if (e.key === 'Enter' && e.target === document.body) this.launch();
      else if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey) this.openAdd();
    });
  }

  _toggleMenu(menu, btn, force) {
    const open = force ?? menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  openAdd() {
    const { addDialog, addForm } = this.el;
    addForm.reset();
    addDialog.showModal();
    addForm.querySelector('input[name="title"]').focus();
  }

  openGalaxy() {
    this.el.galaxyForm.reset();
    this.el.galaxyDialog.showModal();
    this.el.galaxyForm.querySelector('input[name="name"]').focus();
  }

  launch() {
    const c = this.current;
    if (!c) return;
    const evt = new CustomEvent('course-launch', { detail: c, cancelable: true });
    const proceed = window.dispatchEvent(evt);
    if (this.onLaunch) this.onLaunch(c);
    else if (proceed) this.toast(`Launching “${c.title}”… (connect your course player via window.courseGalaxy.onLaunch)`);
  }

  toast(msg) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  hideLoader() {
    this.el.loader.classList.add('done');
    setTimeout(() => this.el.loader.remove(), 1200);
  }
}
