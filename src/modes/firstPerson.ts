import * as THREE from 'three';
import { CONFIG } from '../config';

/**
 * Vista in prima persona: un avatar semplice cammina sul territorio seguendo il terreno.
 * Desktop: W A S D o frecce, trascinamento per guardarsi intorno, Maiusc per correre.
 * Mobile: joystick virtuale in basso a sinistra, trascinamento altrove per guardarsi intorno.
 * La camera segue l'avatar da dietro, leggermente sopra le spalle.
 */
export class FirstPerson {
  active = false;
  avatar = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0;            // 0 = verso nord (−z)
  pitch = -0.12;
  private keys = new Set<string>();
  private joy = new THREE.Vector2();
  private look: { id: number; x: number; y: number } | null = null;
  private trans: { t: number; p0: THREE.Vector3; q0: THREE.Quaternion } | null = null;
  private joyEl: HTMLDivElement;
  private knob: HTMLDivElement;
  private tmpQ = new THREE.Quaternion();
  private tmpM = new THREE.Matrix4();

  constructor(
    private canvas: HTMLCanvasElement,
    private getHeight: (x: number, z: number) => number | null,
    private bounds: THREE.Box3,
  ) {
    // avatar: corpo + testa + freccia di direzione, ingrandito per essere visibile sul plastico
    const C = CONFIG.firstPerson;
    const mat = new THREE.MeshStandardMaterial({ color: C.avatarColor, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 6, 12), mat);
    body.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf3d2b0, roughness: 0.7 }));
    head.position.y = 1.55;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 12), mat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 1.05, -0.35);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
    this.avatar.add(body, head, nose, ring);
    this.avatar.scale.setScalar(C.avatarScale);
    this.avatar.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    this.avatar.visible = false;

    // joystick (solo touch)
    this.joyEl = document.createElement('div');
    this.joyEl.id = 'joystick';
    this.joyEl.hidden = true;
    this.knob = document.createElement('div');
    this.joyEl.appendChild(this.knob);
    document.body.appendChild(this.joyEl);
    this.bindInput();
  }

  private bindInput() {
    addEventListener('keydown', (e) => {
      if (!this.active || (e.target as HTMLElement).closest('input, textarea')) return;
      this.keys.add(e.key.toLowerCase());
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    // guardarsi intorno trascinando sul canvas
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || this.look) return;
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.look || e.pointerId !== this.look.id) return;
      const k = CONFIG.firstPerson.lookSensitivity;
      this.yaw += (e.clientX - this.look.x) * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - this.look.y) * k, -1.0, 0.6);
      this.look.x = e.clientX; this.look.y = e.clientY;
    });
    const end = (e: PointerEvent) => { if (this.look?.id === e.pointerId) this.look = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);

    // joystick
    let jid = -1;
    const R = 46;
    const setJoy = (e: PointerEvent) => {
      const r = this.joyEl.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const len = Math.min(R, Math.hypot(dx, dy)) / (Math.hypot(dx, dy) || 1);
      this.knob.style.transform = `translate(${dx * len}px, ${dy * len}px)`;
      this.joy.set((dx * len) / R, (dy * len) / R);
    };
    this.joyEl.addEventListener('pointerdown', (e) => { jid = e.pointerId; this.joyEl.setPointerCapture(jid); setJoy(e); e.stopPropagation(); });
    this.joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === jid) setJoy(e); });
    const jend = (e: PointerEvent) => { if (e.pointerId !== jid) return; jid = -1; this.joy.set(0, 0); this.knob.style.transform = ''; };
    this.joyEl.addEventListener('pointerup', jend);
    this.joyEl.addEventListener('pointercancel', jend);
  }

  /** Entra in prima persona nel punto p (sul terreno), con transizione dalla camera attuale. */
  enter(p: THREE.Vector3, camera: THREE.Camera, yaw?: number) {
    this.pos.set(p.x, 0, p.z);
    this.clamp();
    if (yaw === undefined) {
      const d = new THREE.Vector3(); camera.getWorldDirection(d);
      yaw = Math.atan2(d.x, -d.z);
    }
    this.yaw = yaw;
    this.pitch = -0.12;
    this.active = true;
    this.avatar.visible = true;
    this.joyEl.hidden = !matchMedia('(pointer: coarse)').matches;
    this.trans = { t: 0, p0: camera.position.clone(), q0: camera.quaternion.clone() };
  }

  exit() {
    this.active = false;
    this.avatar.visible = false;
    this.joyEl.hidden = true;
    this.keys.clear();
    this.joy.set(0, 0);
  }

  private clamp() {
    const m = 60, b = this.bounds;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, b.min.x + m, b.max.x - m);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, b.min.z + m, b.max.z - m);
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    if (!this.active) return;
    const C = CONFIG.firstPerson;
    // input
    let fwd = 0, side = 0, turn = 0;
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) fwd += 1;
    if (k.has('s') || k.has('arrowdown')) fwd -= 1;
    if (k.has('a')) side -= 1;
    if (k.has('d')) side += 1;
    if (k.has('arrowleft') || k.has('q')) turn -= 1;
    if (k.has('arrowright') || k.has('e')) turn += 1;
    fwd -= this.joy.y; side += this.joy.x;
    const run = k.has('shift') || this.joy.length() > 0.92;
    this.yaw += turn * dt * 1.6;
    const speed = (run ? C.runSpeed : C.walkSpeed) * dt;
    const len = Math.hypot(fwd, side);
    if (len > 0.05 && !this.trans) {
      const f = new THREE.Vector2(Math.sin(this.yaw), -Math.cos(this.yaw));
      const r = new THREE.Vector2(Math.cos(this.yaw), Math.sin(this.yaw));
      const n = Math.min(1, len) / len;
      this.pos.x += (f.x * fwd + r.x * side) * n * speed;
      this.pos.z += (f.y * fwd + r.y * side) * n * speed;
      this.clamp();
    }
    this.pos.y = this.getHeight(this.pos.x, this.pos.z) ?? this.pos.y;
    this.avatar.position.copy(this.pos);
    this.avatar.rotation.y = -this.yaw;

    // camera dietro e sopra l'avatar
    const s = C.avatarScale;
    const back = new THREE.Vector3(-Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const head = this.pos.clone().add(new THREE.Vector3(0, 1.6 * s, 0));
    const camPos = head.clone().addScaledVector(back, C.cameraDistance * s).add(new THREE.Vector3(0, C.cameraHeight * s - Math.sin(this.pitch) * C.cameraDistance * s, 0));
    const ground = this.getHeight(camPos.x, camPos.z);
    if (ground !== null) camPos.y = Math.max(camPos.y, ground + 2 * s);
    const look = head.clone().addScaledVector(back, -30 * s);
    look.y += Math.sin(this.pitch) * 30 * s;
    this.tmpM.lookAt(camPos, look, camera.up);
    this.tmpQ.setFromRotationMatrix(this.tmpM);

    if (this.trans) {
      this.trans.t = Math.min(1, this.trans.t + dt / C.landingSeconds);
      const e = this.trans.t < 0.5 ? 4 * this.trans.t ** 3 : 1 - (-2 * this.trans.t + 2) ** 3 / 2;
      camera.position.lerpVectors(this.trans.p0, camPos, e);
      camera.quaternion.slerpQuaternions(this.trans.q0, this.tmpQ, e);
      if (this.trans.t >= 1) this.trans = null;
    } else {
      camera.position.lerp(camPos, 1 - Math.exp(-dt * 10));
      camera.quaternion.slerp(this.tmpQ, 1 - Math.exp(-dt * 12));
    }
  }
}
