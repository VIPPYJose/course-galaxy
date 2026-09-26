import { GalaxyView } from './galaxy-view.js';
import { Store } from './store.js';
import { UI } from './ui.js';

async function boot() {
  const manifest = await fetch('assets/planets.json').then((r) => r.json());
  const store = new Store();
  const view = new GalaxyView(document.getElementById('stage'), {
    manifest,
    labelLayer: document.getElementById('labels'),
  });
  const ui = new UI({ store, view, manifest });
  view.setGalaxy(store.activeGalaxy);
  if (!store.activeGalaxy.courses.length) ui.renderCourse(null);

  // reveal once the hero planet's textures are in (or after a safety timeout)
  await Promise.race([
    view.hero ? view.hero.ready : Promise.resolve(),
    new Promise((r) => setTimeout(r, 6000)),
  ]);
  ui.hideLoader();
  view.intro();

  // Small public API for embedding in the course platform.
  window.courseGalaxy = {
    store,
    view,
    /** Called with the course record when the user presses Launch. */
    set onLaunch(fn) { ui.onLaunch = fn; },
    focus: (courseId) => view.focusCourse(courseId),
    addCourse: (data) => store.addCourse(store.activeGalaxy.id, data),
    setProgress: (courseId, progress) => store.updateCourse(courseId, { progress, saved: progress >= 1 }),
  };
}

boot().catch((err) => {
  console.error(err);
  const l = document.getElementById('loader');
  if (l) l.querySelector('p').textContent = 'Could not start the galaxy. Serve this folder over http (see README).';
});
