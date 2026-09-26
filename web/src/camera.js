// Camera rig that keeps the focused planet centred up front while the rest of
// the system keeps orbiting behind it.
//
// Planets are lit from where the star really is, so the resting view is chosen by phase
// angle (star - planet - camera). At ~70 degrees most of the disc is in daylight with a
// long, dramatic terminator, the classic spacecraft approach shot. Drag round toward the
// star and the world thins to a crescent with the star glaring behind it.
//
// Input only ever moves the camera toward targets set by the user (drag, wheel, pinch),
// eased at a fixed rate. There is no cursor parallax, inertia or auto-recentring.
//
// Switching planets flies a cinematic arc: the camera sweeps around the star,
// lifts over the orbital plane mid-flight and punches the FOV, and
// settles on the new planet's framing.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const BASE_FOV = 45;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

export class FocusRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    // Swing round from the star-planet line. With the pitch this gives a ~72 degree phase angle,
    // with the sunlit side on the left.
    this.baseYaw = -1.9;
    this.basePitch = 0.3;
    this.baseDist = 4.3; // in planet radii
    this.userYaw = 0;
    this.userPitch = 0;
    this.zoom = 1;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.targetZoom = 1;
    this.fovOffset = 0; // galaxy warp widens the lens through this
    this.body = null;
    this.flight = null;
    this.look = new THREE.Vector3();
    this.onClick = null;
    this.onHover = null;
    this._pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.attachInput();
  }

  /** Camera pose for a body, including the user's drag and zoom. */
  pose(body, out = { pos: new THREE.Vector3(), look: new THREE.Vector3() }) {
    const P = body.pivot.position;
    const outward = new THREE.Vector3(P.x, 0, P.z).normalize();
    if (!Number.isFinite(outward.x)) outward.set(0, 0, 1);
    const yaw = this.baseYaw + this.userYaw;
    const pitch = THREE.MathUtils.clamp(this.basePitch + this.userPitch, -1.2, 1.35);
    const dir = outward.applyAxisAngle(UP, yaw);
    dir.multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch)).normalize();
    const aspect = this.camera.aspect;
    const fit = aspect < 1 ? 1 / Math.pow(aspect, 0.85) : 1;
    const dist = (body.viewRadius ?? body.radius) * this.baseDist * this.zoom * fit;
    out.pos.copy(P).addScaledVector(dir, dist);
    out.look.copy(P);
    return out;
  }

  focus(body, { immediate = false, resetView = true } = {}) {
    if (!body) return;
    if (this.body && !immediate && body !== this.body) {
      // Start from wherever the camera is right now (also mid-flight), so the path stays continuous.
      const d = this.camera.position.distanceTo(body.pivot.position);
      this.flight = {
        pos: this.camera.position.clone(),
        look: this.look.clone(),
        t: 0,
        dur: THREE.MathUtils.clamp(1.3 + d / 90, 1.5, 3.0),
      };
    } else if (immediate) {
      this.flight = null;
    }
    this.body = body;
    if (resetView) {
      this.targetYaw = 0;
      this.targetPitch = 0;
      this.targetZoom = 1;
    }
    if (immediate) {
      this.userYaw = this.targetYaw;
      this.userPitch = this.targetPitch;
      this.zoom = this.targetZoom;
      const p = this.pose(body);
      this.camera.position.copy(p.pos);
      this.look.copy(p.look);
      this.camera.lookAt(this.look);
    }
  }

  get transitioning() {
    return !!this.flight;
  }

  update(dt) {
    if (!this.body) return;
    const k = Math.min(1, dt * 6);
    this.userYaw += (this.targetYaw - this.userYaw) * k;
    this.userPitch += (this.targetPitch - this.userPitch) * k;
    this.zoom += (this.targetZoom - this.zoom) * k;

    const to = this.pose(this.body, this._pose);
    let fov = BASE_FOV;
    const f = this.flight;
    if (f) {
      f.t += dt / f.dur;
      const s = Math.min(1, f.t);
      const e = easeInOutCubic(s);
      // Sweep around the star in cylindrical coordinates, hopping up over the orbital plane.
      const a0 = Math.atan2(f.pos.z, f.pos.x);
      const a1 = Math.atan2(to.pos.z, to.pos.x);
      const da = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
      const r0 = Math.hypot(f.pos.x, f.pos.z);
      const r1 = Math.hypot(to.pos.x, to.pos.z);
      const chord = f.pos.distanceTo(to.pos);
      const hop = Math.sin(Math.PI * s);
      const a = a0 + da * e;
      const r = THREE.MathUtils.lerp(r0, r1, e) + hop * chord * 0.12;
      const y = THREE.MathUtils.lerp(f.pos.y, to.pos.y, e) + hop * chord * 0.22;
      this.camera.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      this.look.lerpVectors(f.look, to.look, easeInOutSine(Math.min(1, s * 1.15)));
      // Brief FOV punch sells the "zoom through space" feel.
      fov += hop * 9;
      if (s >= 1) this.flight = null;
    } else {
      this.camera.position.copy(to.pos);
      this.look.copy(to.look);
    }
    fov += this.fovOffset;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.look);
  }

  attachInput() {
    const el = this.dom;
    const pointers = new Map();
    let downAt = null;
    let moved = 0;
    let pinchStart = 0;
    let zoomStart = 1;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      downAt = { x: e.clientX, y: e.clientY };
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        zoomStart = this.targetZoom;
      }
    });

    el.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        this.onHover?.(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.targetZoom = THREE.MathUtils.clamp(zoomStart * (pinchStart / Math.max(d, 1)), 0.65, 2.4);
        return;
      }
      if (moved > 4) el.classList.add('dragging');
      this.targetYaw -= dx * 0.0055;
      this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + dy * 0.0045, -1.3, 1.1);
    });

    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      el.classList.remove('dragging');
      if (moved < 6 && downAt && pointers.size === 0) this.onClick?.(e.clientX, e.clientY);
      downAt = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.targetZoom = THREE.MathUtils.clamp(this.targetZoom * Math.exp(e.deltaY * 0.0012), 0.65, 2.4);
      },
      { passive: false },
    );
  }
}
