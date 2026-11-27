import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Itinerario } from '../layers/routes';
import type { MapFrame } from '../scene/geo';
import { t } from '../ui/i18n';
import { AmbientMusic } from '../audio/ambient';

/**
 * Punto audio lungo un itinerario: quando il volo passa nel raggio parte il commento e il volo rallenta.
 * Con `inizio` il commento parte appena si avvia il volo.
 * Il commento è un file audio (`file`) oppure un testo letto dalla sintesi vocale (`testo`).
 */
export interface AudioPoint {
  id: string; itinerario: number; titolo: string;
  file?: string; testo?: string;
  u: number; v: number; raggio?: number;
  inizio?: boolean;
}

/** Immagine collegata a un punto vicino al percorso: durante il volo compare ingrandita in una finestra. */
export interface FlightImage { id: string; titolo: string; file: string; crediti?: string | null; pos: () => THREE.Vector3 }

type Speaker = { speak(text: string): Promise<void>; stop(): void };

/** Sintesi vocale: voce Claude dove la pagina la offre, altrimenti la voce del browser; il testo resta a schermo. */
async function makeSpeaker(): Promise<Speaker | null> {
  const c = (window as any).claude;
  try {
    const tts = c?.use ? await Promise.race([c.use('tts'), new Promise((r) => setTimeout(() => r(null), 5000))]) as any : null;
    if (tts) {
      return {
        speak: (text) => tts.speak(text, { language: 'it', voice: 'rounded' }).then(() => undefined),
        stop: () => { tts.stop().catch(() => {}); },
      };
    }
  } catch { /* nessuna voce Claude in questa vista */ }
  if (!c && 'speechSynthesis' in window) {
    // fuori da Claude (es. versione Supabase): voce del browser
    return {
      speak: (text) => new Promise<void>((res, rej) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'it-IT';
        u.onend = () => res();
        u.onerror = (e) => rej(e);
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }),
      stop: () => speechSynthesis.cancel(),
    };
  }
  return null;
}

/**
 * Volo lungo un itinerario: la camera sta in alto (CONFIG.flight.height) e guarda il percorso
 * dall'indietro con un'inclinazione di circa 45°. Play/Pausa, velocità, barra di avanzamento,
 * commenti audio geoposizionati.
 */
export class RouteFlight {
  active = false;
  playing = false;
  route: Itinerario | null = null;
  private curve: THREE.CatmullRomCurve3 | null = null;
  private length = 1;
  private s = 0;
  private mul = 1;
  private v = 0;   // velocità attuale (m/s), che si avvicina con dolcezza a quella richiesta
  private dir = new THREE.Vector3(0, 0, -1);
  private trans: { t: number; p0: THREE.Vector3; q0: THREE.Quaternion } | null = null;
  private audioPts: (AudioPoint & { pos: THREE.Vector3; s: number; done: boolean })[] = [];
  private images: (FlightImage & { s: number })[] = [];
  private shownImages = '';
  private gallery: HTMLDivElement;
  private music = new AmbientMusic();
  /** Immagini da mostrare nella finestra durante il volo (fornite dalla pagina). */
  getImages: () => FlightImage[] = () => [];
  onImage: (id: string) => void = () => {};
  private audio: HTMLAudioElement | null = null;
  private speaking = false;
  private speaker: Promise<Speaker | null>;
  private bar: HTMLDivElement;
  private caption: HTMLDivElement;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  /** Sfera colorata nel punto inquadrato dalla camera (sostituisce quella che fa avanti e indietro). */
  marker = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ roughness: 0.35 }));
  onExit: () => void = () => {};

  constructor(
    public audioData: AudioPoint[], private map: MapFrame,
    private getHeight: (x: number, z: number) => number | null,
  ) {
    this.speaker = makeSpeaker();
    this.marker.visible = false;
    this.marker.renderOrder = 3;
    // contorno bianco
    this.marker.add(new THREE.Mesh(new THREE.SphereGeometry(1.18, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide })));
    this.caption = document.createElement('div');
    this.caption.id = 'caption';
    this.caption.hidden = true;
    this.caption.setAttribute('aria-live', 'polite');
    this.gallery = document.createElement('div');
    this.gallery.id = 'flightgallery';
    this.gallery.hidden = true;
    this.bar = document.createElement('div');
    this.bar.id = 'flightbar';
    this.bar.hidden = true;
    this.bar.innerHTML = `
      <button class="pill play"></button>
      <div class="info">
        <div class="name"><b class="swatch"></b><span></span></div>
        <input class="progress" type="range" min="0" max="1000" value="0" aria-label="Avanzamento">
        <div class="status" aria-live="polite"></div>
      </div>
      <label class="speed"><span>${t('speed')}</span>
        <select>${CONFIG.flight.speeds.map((v) => `<option value="${v}"${v === 1 ? ' selected' : ''}>${v}×</option>`).join('')}</select>
      </label>
      <button class="pill exit">${t('exitFlight')}</button>`;
    document.body.append(this.caption, this.gallery, this.bar);
    this.q('.play').addEventListener('click', () => this.toggle());
    this.q('.exit').addEventListener('click', () => this.onExit());
    this.q<HTMLSelectElement>('select').addEventListener('change', (e) => { this.mul = +(e.target as HTMLSelectElement).value; });
    this.q<HTMLInputElement>('.progress').addEventListener('input', (e) => {
      this.s = (+(e.target as HTMLInputElement).value / 1000) * this.length;
      this.stopAudio();
      for (const a of this.audioPts) a.done = a.s < this.s - 50;
    });
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string) { return this.bar.querySelector(sel) as T; }

  /** Porta la camera sopra la partenza dell'itinerario, pronta per il volo. */
  start(it: Itinerario, camera: THREE.Camera) {
    if (!it.runner) return;
    this.stopAudio();
    this.route = it;
    this.curve = it.runner.curve;
    this.length = it.runner.length;
    if (this.route && this.route !== it && this.route.runner) this.route.runner.mesh.visible = this.route.visible;
    this.s = 0;
    this.active = true;
    this.playing = true;   // parte subito: animazione e commento iniziale
    this.dir.copy(CONFIG.flight.northUp ? new THREE.Vector3(0, 0, -1) : this.direction(0));
    const mat = this.marker.material as THREE.MeshStandardMaterial;
    mat.color.set(it.data.colore); mat.emissive.set(it.data.colore); mat.emissiveIntensity = 0.6;
    this.marker.visible = true;
    it.runner.mesh.visible = false;
    this.trans = { t: 0, p0: camera.position.clone(), q0: camera.quaternion.clone() };
    this.audioPts = this.audioData.filter((a) => a.itinerario === it.data.id).map((a) => {
      const { x, z } = this.map.toWorld(a.u, a.v);
      const pos = new THREE.Vector3(x, this.getHeight(x, z) ?? 0, z);
      return { ...a, pos, s: a.inizio ? 0 : this.sOf(pos), done: false };
    }).sort((a, b) => a.s - b.s);
    // immagini vicine al percorso, nell'ordine in cui si incontrano
    this.images = [];
    for (const im of this.getImages()) {
      const p = im.pos();
      const { s, d } = this.nearest(p);
      if (d <= CONFIG.flight.imageRadius) this.images.push({ ...im, s });
    }
    this.shownImages = '';
    this.gallery.hidden = true;
    this.music.start();
    this.q('.name span').textContent = it.data.nome;
    this.q('.swatch').style.background = it.data.colore;
    this.q('.status').textContent = this.audioPts.length ? `${this.audioPts.length} ${this.audioPts.length === 1 ? 'commento' : 'commenti'} audio lungo il percorso` : '';
    this.bar.hidden = false;
    this.renderButton();
  }

  stop() {
    this.active = false;
    this.playing = false;
    this.stopAudio();
    this.music.stop();
    this.bar.hidden = true;
    this.gallery.hidden = true;
    this.shownImages = '';
    this.marker.visible = false;
    if (this.route?.runner) this.route.runner.mesh.visible = this.route.visible;
  }

  toggle() {
    if (this.s >= this.length) { this.s = 0; this.audioPts.forEach((a) => (a.done = false)); this.playing = false; }
    this.playing = !this.playing;
    if (this.playing) this.music.start(); else { this.stopAudio(); this.music.stop(); }
    this.renderButton();
  }

  private renderButton() {
    this.q('.play').textContent = this.playing ? `❚❚ ${t('pause')}` : `▶ ${t('play')}`;
  }

  private stopAudio() {
    if (this.audio) { this.audio.pause(); this.audio = null; }
    if (this.speaking) { this.speaking = false; this.speaker.then((s) => s?.stop()); }
    this.caption.hidden = true;
    this.music.duck(false);
  }

  private resumeAfterAudio() {
    this.audio = null;
    this.speaking = false;
    this.caption.hidden = true;
    this.music.duck(false);
  }

  private async playAudio(a: AudioPoint) {
    this.music.duck(true);
    this.caption.replaceChildren();
    const b = document.createElement('b'); b.textContent = a.titolo;
    const p = document.createElement('p'); p.textContent = a.testo ?? '';
    this.caption.append(b, p);
    this.caption.hidden = false;
    if (a.file) {
      const el = new Audio(a.file);
      this.audio = el;
      el.addEventListener('ended', () => { if (this.audio === el) this.resumeAfterAudio(); });
      el.play().catch(() => { if (this.audio === el) this.resumeAfterAudio(); });
      return;
    }
    if (!a.testo) { this.resumeAfterAudio(); return; }
    this.speaking = true;
    const sp = await this.speaker;
    const readMs = Math.min(15000, 2500 + a.testo.length * 55);   // tempo di lettura, se non c'è voce
    try {
      if (sp) await sp.speak(a.testo);
      else await new Promise((r) => setTimeout(r, readMs));
    } catch {
      // voce non disponibile o interrotta: il testo resta a schermo per il tempo di lettura
      if (this.speaking) await new Promise((r) => setTimeout(r, readMs));
    }
    if (this.speaking) this.resumeAfterAudio();
  }

  /** Punto del percorso più vicino a p: distanza dalla partenza (s) e distanza dal percorso (d), in metri. */
  private nearest(p: THREE.Vector3) {
    const n = Math.max(400, Math.ceil(this.length / 100));
    let best = 0, bd = Infinity;
    const q = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      this.curve!.getPointAt(i / n, q);
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < bd) { bd = d; best = i / n; }
    }
    return { s: best * this.length, d: Math.sqrt(bd) };
  }
  private sOf(p: THREE.Vector3) { return this.nearest(p).s; }

  /** Finestra con le immagini del tratto che si sta sorvolando. */
  private updateGallery() {
    const W = CONFIG.flight.imageWindow;
    const now = this.images.filter((im) => this.s >= im.s - W && this.s <= im.s + W).slice(0, 3);
    const key = now.map((i) => i.id).join('|');
    if (key === this.shownImages) return;
    this.shownImages = key;
    if (!now.length) { this.gallery.classList.remove('show'); setTimeout(() => { if (!this.shownImages) this.gallery.hidden = true; }, 400); return; }
    this.gallery.replaceChildren(...now.map((im) => {
      const fig = document.createElement('figure');
      const img = document.createElement('img'); img.src = im.file; img.alt = im.titolo;
      const cap = document.createElement('figcaption'); cap.textContent = im.titolo;
      if (im.crediti) { const sm = document.createElement('small'); sm.textContent = im.crediti; cap.append(sm); }
      fig.append(img, cap);
      fig.addEventListener('click', () => this.onImage(im.id));
      return fig;
    }));
    this.gallery.dataset.n = String(now.length);
    this.gallery.hidden = false;
    requestAnimationFrame(() => this.gallery.classList.add('show'));
  }

  /** Punto del percorso sul terreno alla distanza s dalla partenza. */
  private ground(s: number, out = new THREE.Vector3()) {
    this.curve!.getPointAt(THREE.MathUtils.clamp(s / this.length, 0, 1), out);
    out.y = this.getHeight(out.x, out.z) ?? out.y;
    return out;
  }

  /** Direzione di marcia (orizzontale), media su un tratto per evitare scatti nelle curve. */
  private direction(s: number) {
    const w = CONFIG.flight.directionWindow;
    const a = this.ground(s - w), b = this.ground(s + w);
    const d = b.sub(a).setY(0);
    return d.lengthSq() > 1 ? d.normalize() : this.dir.clone();
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    if (!this.active || !this.curve) return;
    const F = CONFIG.flight;
    if (this.playing) {
      // veloce quando non c'è parlato; durante il commento rallenta molto, senza fermarsi
      const want = (this.audio || this.speaking ? F.speechSpeed : F.speed) * this.mul;
      this.v += (want - this.v) * (1 - Math.exp(-dt * 1.5));
      this.s += this.v * dt;
      if (this.s >= this.length) {
        this.s = this.length; this.playing = false; this.renderButton();
        this.q('.status').textContent = t('routeEnd');
        if (!this.audio && !this.speaking) this.music.stop();
      }
    }
    this.q<HTMLInputElement>('.progress').value = String(Math.round((this.s / this.length) * 1000));

    // camera alta, arretrata rispetto al punto e rivolta verso di esso a circa 45°
    const target = this.ground(this.s);
    // camera sempre a sud del punto, rivolta a nord: orientamento sud-nord come nella cartografia
    if (F.northUp) this.dir.set(0, 0, -1);
    else this.dir.lerp(this.direction(this.s), 1 - Math.exp(-dt * F.turnSmoothing)).setY(0).normalize();
    const pos = target.clone().addScaledVector(this.dir, -F.height * F.backRatio).add(new THREE.Vector3(0, F.height, 0));
    const g = this.getHeight(pos.x, pos.z);
    if (g !== null && pos.y < g + F.minClearance) pos.y = g + F.minClearance;
    this.tmpM.lookAt(pos, target, camera.up);
    this.tmpQ.setFromRotationMatrix(this.tmpM);

    if (this.trans) {
      this.trans.t = Math.min(1, this.trans.t + dt / F.approachSeconds);
      const e = this.trans.t < 0.5 ? 4 * this.trans.t ** 3 : 1 - (-2 * this.trans.t + 2) ** 3 / 2;
      camera.position.lerpVectors(this.trans.p0, pos, e);
      camera.quaternion.slerpQuaternions(this.trans.q0, this.tmpQ, e);
      if (this.trans.t >= 1) this.trans = null;
    } else {
      camera.position.lerp(pos, 1 - Math.exp(-dt * 6));
      camera.quaternion.slerp(this.tmpQ, 1 - Math.exp(-dt * 6));
    }

    // sfera nel punto inquadrato, di dimensione costante sullo schermo
    const r = Math.max(F.markerMinRadius, camera.position.distanceTo(target) * F.markerScreenSize);
    this.marker.position.copy(target).add(new THREE.Vector3(0, r * 0.8, 0));
    this.marker.scale.setScalar(r);

    // commenti audio: partono quando il volo arriva al loro punto del percorso (quello d'inizio subito);
    // se un commento è ancora in corso il successivo attende, ma si salta se ormai è troppo indietro
    if (!this.audio && !this.speaking && (this.playing || this.s === 0)) {
      for (const a of this.audioPts) {
        if (a.done) continue;
        if (this.s < a.s - (a.raggio ?? F.audioRadius)) break;
        a.done = true;
        if (this.s <= a.s + F.audioLate) { this.playAudio(a); break; }
      }
    }
    this.updateGallery();
  }
}
