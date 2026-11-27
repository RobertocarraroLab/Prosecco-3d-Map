import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CONFIG } from './config';
import { loadPlastico, Plastico } from './scene/loadPlastico';
import { MapFrame } from './scene/geo';
import { LabelsLayer, Localita } from './layers/labels';
import { RoutesLayer, ItinerarioData } from './layers/routes';
import { MonumentsLayer } from './layers/monuments';
import { ContentLayer, Contenuto, isLive } from './layers/content';
import { ContentPopup, Viewer360 } from './ui/viewers';
import { buildPois, Poi } from './app/pois';
import { FirstPerson } from './modes/firstPerson';
import { RouteFlight, AudioPoint } from './modes/routeFlight';
import { Menu, SearchEntry, Gioco } from './ui/menu';
import { PoiCard } from './ui/poiCard';
import { t } from './ui/i18n';
import { mergeById, ClaudeDbStore, type Store, type Overrides } from './data/store';
import { Editor, type GiocoRec, type Settings } from './admin/editor';
import './style.css';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const isMobile = matchMedia('(pointer: coarse)').matches;
const debug = location.hash === '#debug';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !isMobile;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.colors.background);
scene.fog = new THREE.Fog(CONFIG.colors.fog, 180000, 320000);

// near piccolo per la prima persona e il volo: il depth buffer logaritmico regge l'intervallo
const camera = new THREE.PerspectiveCamera(CONFIG.aerial.fov, innerWidth / innerHeight, 1, 600000);
camera.position.set(...CONFIG.aerial.position);

const controls = new OrbitControls(camera, canvas);
controls.target.set(...CONFIG.aerial.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = CONFIG.aerial.minDistance;
controls.maxDistance = CONFIG.aerial.maxDistance;
controls.maxPolarAngle = CONFIG.aerial.maxPolarAngle;
controls.screenSpacePanning = false;
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x8a7f6a, 1.6));
const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
sun.position.set(-30000, 45000, 30000);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -26000, right: 26000, top: 18000, bottom: -18000, near: 1000, far: 140000 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 20;
scene.add(sun);

// ---------- caricamento ----------
const loading = document.getElementById('loading')!;
const bar = document.getElementById('bar')!;
let plastico: Plastico, localita: Localita[], itinerariData: ItinerarioData[], contenuti: Contenuto[];
let audioData: AudioPoint[], giochi: Gioco[];
try {
  const getJSON = (u: string, fallback?: unknown) => fetch(u)
    .then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); })
    .catch((e) => { if (fallback !== undefined) return fallback; throw e; });
  [plastico, localita, itinerariData, contenuti, audioData, giochi] = await Promise.all([
    loadPlastico((p) => { bar.style.width = `${Math.round(p * 100)}%`; }),
    getJSON(CONFIG.localitaUrl), getJSON(CONFIG.itinerariUrl), getJSON(CONFIG.content.url),
    getJSON(CONFIG.audioUrl, []), getJSON(CONFIG.giochiUrl, []),
  ]);
} catch (e) {
  loading.innerHTML = '<p>Errore nel caricamento del plastico.<br><small></small></p>';
  loading.querySelector('small')!.textContent = (e as Error).message;
  throw e;
}
scene.add(plastico.root);

const H = plastico.getTerrainHeight;
const map = new MapFrame(plastico.bounds);
// dati di base (file pubblicati); le modifiche della redazione si sovrappongono (vedi rebuild)
const base = { localita, contenuti, audio: audioData, giochi: giochi as unknown as GiocoRec[] };
let settings: Settings = {};
let labels!: LabelsLayer;
let content!: ContentLayer;
let pois: Poi[] = [];
let menu: Menu | null = null;
const routes = new RoutesLayer(itinerariData, map, H, plastico.routeMeshes);
scene.add(routes.group);
const monuments = new MonumentsLayer(plastico.monumentiList, plastico.monumenti, H, map);
const popup = new ContentPopup();
const viewer360 = new Viewer360();
const poiOf = (c: Contenuto) => pois.find((p) =>
  c.poi && p.tipo === c.poi.tipo && (p.tipo === 'localita' ? p.labelId === c.poi.id : p.nome.toLowerCase() === c.poi.id.toLowerCase()));
const fp = new FirstPerson(canvas, H, plastico.bounds);
scene.add(fp.avatar);
const flight = new RouteFlight(audioData, map, H);
scene.add(flight.marker);
const card = new PoiCard();
loading.classList.add('done');

function openContent(c: Contenuto) {
  if (c.tipo === 'foto360') viewer360.open(c);
  else popup.open(c, poiOf(c)?.nome ?? '');
}

// ---------- modalità della camera ----------
type Mode = 'aerea' | 'persona' | 'volo';
let mode: Mode = 'aerea';
let anim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number; dur: number } | null = null;

function flyTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 1.6) {
  anim = { from: camera.position.clone(), to: pos, tFrom: controls.target.clone(), tTo: target, t: 0, dur };
}

const nav = document.createElement('nav');
nav.className = 'top-left';
nav.innerHTML = `<div class="seg" role="group">
  <button class="pill" data-mode="aerea">${t('aerial')}</button>
  <button class="pill" data-mode="persona">${t('firstPerson')}</button></div>`;
// barra degli itinerari animati, in alto a sinistra (al posto dei pulsanti veduta aerea / prima persona)
const routeBar = document.createElement('nav');
routeBar.className = 'top-left routebar';
routeBar.setAttribute('aria-label', t('routes'));
routeBar.innerHTML = `<div class="seg"><span class="lbl">${t('routes')}</span></div>`;
for (const it of routes.itinerari) {
  const b = document.createElement('button');
  b.className = 'pill';
  b.dataset.route = String(it.data.id);
  b.title = `${t('fly')}: ${it.data.nome}`;
  b.innerHTML = '<b class="swatch"></b><span></span>';
  (b.querySelector('.swatch') as HTMLElement).style.background = it.data.colore;
  b.querySelector('span')!.textContent = it.data.nome.split(/[–-]/).pop()!.trim();
  b.addEventListener('click', () => navigate(`itinerario-${it.data.id}`));
  routeBar.firstElementChild!.appendChild(b);
}
const markRoute = (id: number | null) => routeBar.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((b) => b.classList.toggle('on', +b.dataset.route! === id));
if (CONFIG.firstPerson.enabled) document.getElementById('nav-slot')!.replaceWith(nav);
else document.getElementById('nav-slot')!.replaceWith(routeBar);
const hint = document.createElement('div');
hint.id = 'hint';
document.body.appendChild(hint);
const near = document.createElement('div');
near.id = 'near';
near.hidden = true;
near.innerHTML = '<span></span><button class="pill"></button>';
document.body.appendChild(near);

function setMode(m: Mode) {
  mode = m;
  controls.enabled = m === 'aerea';
  nav.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  if (m !== 'persona') { fp.exit(); near.hidden = true; }
  if (m !== 'volo') { flight.stop(); markRoute(null); }
  hint.textContent = m === 'persona' ? (isMobile ? t('fpHintMobile') : t('fpHintDesktop')) : m === 'aerea' && !debug && CONFIG.firstPerson.enabled ? t('tapToLand') : '';
  hint.classList.toggle('show', !!hint.textContent);
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hint.classList.remove('show'), 6000);
}
let hintTimer = 0;

/** Torna alla vista orbitale; con "full" alla veduta aerea dell'intero territorio. */
function goAerial(full: boolean) {
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const wasAerial = mode === 'aerea';
  setMode('aerea');
  if (!wasAerial) controls.target.copy(camera.position).addScaledVector(dir, 800);
  if (full) flyTo(new THREE.Vector3(...CONFIG.aerial.position), new THREE.Vector3(...CONFIG.aerial.target), 2);
  else {
    const tgt = camera.position.clone().addScaledVector(dir.setY(0).normalize(), 600);
    tgt.y = H(tgt.x, tgt.z) ?? 0;
    const back = dir.clone().multiplyScalar(-1);
    flyTo(tgt.clone().addScaledVector(back, 7600).add(new THREE.Vector3(0, 5400, 0)), tgt, 1.8);
  }
}

function enterFirstPerson(p: THREE.Vector3, yaw?: number) {
  card.hide();
  setMode('persona');
  fp.enter(p, camera, yaw);
}

function startFlight(id: number) {
  const it = routes.itinerari.find((i) => i.data.id === id);
  if (!it) return;
  routes.setVisible(id, true);
  card.hide();
  setMode('volo');
  markRoute(id);
  flight.start(it, camera);
}
flight.onExit = () => goAerial(false);
// immagini da mostrare nella finestra del volo: quelle sul percorso, nel punto a cui sono collegate
flight.getImages = () => content.items.filter((i) => i.c.tipo === 'immagine').map((i) => ({ id: i.c.id, titolo: i.c.titolo, file: i.c.file, crediti: i.c.diritti, pos: i.anchor }));
flight.onImage = (id) => { const c = content.items.find((i) => i.c.id === id)?.c; if (c) openContent(c); };
viewer360.onBackToMap = () => goAerial(true);

nav.querySelector('[data-mode="aerea"]')!.addEventListener('click', () => { card.hide(); labels.focusId = null; goAerial(true); setHash(''); });
nav.querySelector('[data-mode="persona"]')!.addEventListener('click', () => {
  if (mode === 'persona') return;
  // scende nel punto al centro dello schermo
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = ray.intersectObject(plastico.terrainMesh, false)[0];
  enterFirstPerson(hit?.point ?? controls.target.clone());
});
setMode('aerea');

// ---------- punti di interesse, ricerca, link diretti ----------
function showPoi(p: Poi) {
  if (mode !== 'aerea') goAerial(false);
  const g = p.ground().clone();
  const target = g.clone().add(new THREE.Vector3(0, 40, 0));
  const dir = target.clone().sub(camera.position).setY(0);
  if (dir.lengthSq() < 1) dir.set(0, 0, -1);
  dir.normalize();
  const mon = p.tipo === 'monumento';   // i monumenti si inquadrano da più lontano
  const dist = mon ? CONFIG.poiView.monumentDistance : CONFIG.poiView.distance;
  const hgt = mon ? CONFIG.poiView.monumentHeight : CONFIG.poiView.height;
  flyTo(target.clone().addScaledVector(dir, -dist).add(new THREE.Vector3(0, hgt, 0)), target, 2);
  labels.focusId = p.labelId ?? null;
  card.show(p);
}
card.onOpenContent = openContent;
card.onWalk = (p) => enterFirstPerson(p.ground().clone());
card.walkEnabled = CONFIG.firstPerson.enabled;
card.onClose = () => { labels.focusId = null; setHash(''); };

const routesByKey = new Map<string, () => void>();

let lastHash = '';
function setHash(k: string) {
  lastHash = k;
  if (debug) return;
  if (k) location.hash = k;
  else if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}
function navigate(k: string, fromHash = false) {
  const go = routesByKey.get(k);
  if (!go) return;
  go();
  if (!fromHash) setHash(k);
}
addEventListener('hashchange', () => {
  const k = location.hash.slice(1);
  if (k && k !== lastHash) { lastHash = k; navigate(k, true); }
});

/**
 * (Ri)costruisce tutto ciò che dipende dai dati modificabili: nomi, contenuti, punti di interesse,
 * ricerca, menu e link diretti. Chiamata all'avvio e a ogni modifica della redazione.
 */
function rebuild() {
  const focus = labels?.focusId ?? null;
  const openKey = card.current?.key;
  labels?.dispose();
  content?.dispose();
  menu?.dispose();
  labels = new LabelsLayer(localita, map, plastico.terrainMesh, H);
  labels.focusId = focus;
  content = new ContentLayer(contenuti, localita, map, H, monuments);
  scene.add(content.group);
  pois = buildPois(localita, monuments, contenuti, map, H);
  flight.audioData = audioData;

  routesByKey.clear();
  for (const p of pois) routesByKey.set(p.key, () => showPoi(p));
  for (const it of routes.itinerari) routesByKey.set(`itinerario-${it.data.id}`, () => startFlight(it.data.id));
  const live = contenuti.filter(isLive);
  for (const c of live) routesByKey.set(`foto-${c.id}`, () => { const p = poiOf(c); if (p) showPoi(p); else if (c.posizione) focusUV(c.posizione.u, c.posizione.v); openContent(c); });

  const search: SearchEntry[] = [
    ...pois.map((p) => ({ text: p.nome, sub: p.tipo === 'monumento' ? t('monument') : p.categoria, kind: p.tipo === 'monumento' ? 'M' : 'L', key: p.key })),
    ...live.map((c) => ({
      text: c.titolo, sub: `${c.tipo === 'foto360' ? t('photo360') : t('photo')}${poiOf(c) ? ' · ' + poiOf(c)!.nome : ''}`,
      kind: c.tipo === 'foto360' ? '360' : c.tipo === 'immagine' ? 'F' : c.tipo.slice(0, 1).toUpperCase(), key: `foto-${c.id}`,
    })),
    ...routes.itinerari.map((it) => ({ text: it.data.nome, sub: t('route'), kind: 'I', key: `itinerario-${it.data.id}` })),
  ];
  menu = new Menu({
    pois, itinerari: routes.itinerari, giochi: giochi as any, search,
    foto360: live.filter((c) => c.tipo === 'foto360'),
    onSelect: (k) => navigate(k),
    onToggleRoute: (id, v) => routes.setVisible(id, v),
    onFly: (id) => navigate(`itinerario-${id}`),
    onOverview: () => { card.hide(); labels.focusId = null; goAerial(true); setHash(''); },
    onGame: () => { /* i giochi verranno collegati qui quando saranno realizzati */ },
  });
  if (openKey) { const p = pois.find((q) => q.key === openKey); if (p) card.show(p); else card.hide(); }
  editor?.refresh();
}

/** Parametri della mappa impostati dalla redazione (vedi Editor › Parametri). */
const DEFAULTS: Settings = {
  labelL2Km: CONFIG.labels.maxDistance[2] / 1000, labelL3Km: CONFIG.labels.maxDistance[3] / 1000,
  monumentFarKm: CONFIG.monuments.farDistance / 1000, monumentNatural: Math.round(1 / CONFIG.monuments.defaultNaturalScale),
  iconNearPx: CONFIG.content.iconHeightNearPx, iconFarPx: CONFIG.content.iconHeightFarPx,
  activationKm: CONFIG.content.activationDistance / 1000, flightSpeed: CONFIG.flight.speed,
  flightHeight: CONFIG.flight.height, walkSpeed: CONFIG.firstPerson.walkSpeed,
};
function applySettings(o: Settings) {
  const s = { ...DEFAULTS, ...o };
  CONFIG.labels.maxDistance[2] = s.labelL2Km! * 1000;
  CONFIG.labels.maxDistance[3] = s.labelL3Km! * 1000;
  CONFIG.monuments.farDistance = s.monumentFarKm! * 1000;
  CONFIG.monuments.defaultNaturalScale = 1 / Math.max(1, s.monumentNatural!);
  CONFIG.content.iconHeightNearPx = s.iconNearPx!;
  CONFIG.content.iconHeightFarPx = s.iconFarPx!;
  CONFIG.content.activationDistance = s.activationKm! * 1000;
  CONFIG.flight.speed = s.flightSpeed!;
  CONFIG.flight.height = s.flightHeight!;
  CONFIG.firstPerson.walkSpeed = s.walkSpeed!;
  CONFIG.firstPerson.runSpeed = s.walkSpeed! * 3.5;
  monuments.applyConfig();
}

function focusUV(u: number, v: number) {
  const { x, z } = map.toWorld(u, v);
  const g = new THREE.Vector3(x, H(x, z) ?? 0, z);
  if (mode !== 'aerea') goAerial(false);
  flyTo(g.clone().add(new THREE.Vector3(0, CONFIG.poiView.height, CONFIG.poiView.distance)), g, 1.6);
}

// ---------- scelta di un punto sul plastico (redazione) ----------
let pickResolve: ((p: { u: number; v: number } | null) => void) | null = null;
function pickPoint(msg: string) {
  if (mode !== 'aerea') goAerial(false);
  document.body.classList.add('picking');
  hint.textContent = msg; hint.classList.add('show'); clearTimeout(hintTimer);
  return new Promise<{ u: number; v: number } | null>((res) => { pickResolve = res; });
}
function endPick(p: { u: number; v: number } | null) {
  document.body.classList.remove('picking');
  hint.classList.remove('show');
  pickResolve?.(p);
  pickResolve = null;
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && pickResolve) endPick(null); });

let editor: Editor | null = null;
rebuild();

// ---------- archivio della redazione ----------
(async () => {
  let store: Store | null = null;
  const env = import.meta.env;
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
    const { SupabaseStore } = await import('./data/supabaseStore');
    store = await SupabaseStore.create(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  } else {
    store = await ClaudeDbStore.create();
  }
  if (!store) return;   // nessun archivio (es. pagina aperta senza accesso): restano i dati di base
  store.subscribe((o: Overrides) => {
    localita = mergeById(base.localita, o.localita);
    contenuti = mergeById(base.contenuti, o.contenuti);
    audioData = mergeById(base.audio, o.audio);
    giochi = mergeById(base.giochi, o.giochi) as any;
    settings = (o.impostazioni ?? {}) as Settings;
    applySettings(settings);
    rebuild();
  });
  if (await store.canEdit()) {
    editor = new Editor({
      store,
      data: () => ({ localita, contenuti, audio: audioData, giochi: giochi as unknown as GiocoRec[], settings }),
      defaults: DEFAULTS,
      monumenti: monuments.items.map((m) => m.m.nome),
      itinerari: routes.itinerari.map((i) => ({ id: i.data.id, nome: i.data.nome })),
      pickPoint, focusUV,
    });
  }
})();

// ---------- tocco sul plastico ----------
const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (pickResolve) {
    ray.setFromCamera(ndc, camera);
    const hp = ray.intersectObject(plastico.terrainMesh, false)[0];
    if (hp) { const uv = map.toUV(hp.point.x, hp.point.z); marker.position.copy(hp.point); marker.visible = true; setTimeout(() => (marker.visible = debug), 2500); endPick(uv); }
    return;
  }
  const picked = content.group.visible ? content.pick(ndc, camera) : null;
  if (picked) { openContent(picked); return; }
  if (mode !== 'aerea') return;
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(plastico.terrainMesh, false)[0];
  if (!hit) return;
  if (debug) showCoords(hit.point);
  else if (CONFIG.firstPerson.enabled) enterFirstPerson(hit.point);   // dalla veduta aerea: atterraggio in prima persona
});

// "vicino a te" in prima persona
let nearTimer = 0;
let nearContent: Contenuto | null = null;
near.querySelector('button')!.addEventListener('click', () => nearContent && openContent(nearContent));
function updateNear(dt: number) {
  if (mode !== 'persona' || (nearTimer += dt) < 0.25) return;
  nearTimer = 0;
  const p = fp.pos;
  let best: { c: Contenuto; d: number } | null = null;
  for (const it of content.items) {
    const d = Math.hypot(it.anchor().x - p.x, it.anchor().z - p.z);
    if (d < CONFIG.firstPerson.nearDistance && (!best || d < best.d)) best = { c: it.c, d };
  }
  let place: Poi | null = null, pd = 700;
  for (const q of pois) { const g = q.ground(); const d = Math.hypot(g.x - p.x, g.z - p.z); if (d < pd) { pd = d; place = q; } }
  nearContent = best?.c ?? null;
  near.hidden = !best && !place;
  near.querySelector('span')!.textContent = best ? `${t('near')}: ${best.c.titolo}` : place ? `${t('youAreIn')} ${place.nome}` : '';
  (near.querySelector('button') as HTMLButtonElement).hidden = !best;
  near.querySelector('button')!.textContent = t('open');
}

// ---------- pannello di prova (solo con #debug) ----------
const dbg = document.getElementById('debug')!;
const marker = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3366 }));
marker.visible = false;
scene.add(marker);
function showCoords(pt: THREE.Vector3) {
  const quota = pt.y / CONFIG.verticalExaggeration / CONFIG.unitsPerMeter;
  const uv = map.toUV(pt.x, pt.z);
  document.getElementById('coords')!.innerHTML = `x <b>${Math.round(pt.x)}</b> · z <b>${Math.round(pt.z)}</b> · quota ≈ <b>${Math.round(quota)} m</b><br>` +
    `pixel mappa: ${Math.round(uv.u * 12292)}, ${Math.round(uv.v * 7898)}`;
  marker.position.copy(pt); marker.visible = true;
}
if (debug) {
  dbg.hidden = false;
  const addToggle = (list: HTMLElement, label: string, onChange: (v: boolean) => void) => {
    const row = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = true;
    input.addEventListener('change', () => onChange(input.checked));
    row.append(input, document.createTextNode(label));
    list.appendChild(row);
  };
  const L = document.getElementById('layers')!;
  addToggle(L, 'Territorio', (v) => { plastico.terreno.visible = v; });
  addToggle(L, 'Monumenti', (v) => { plastico.monumenti.visible = v; });
  addToggle(L, 'Nomi delle località', (v) => labels.setVisible(v));
  addToggle(L, 'Immagini e foto 360', (v) => { content.group.visible = v; });
  const size = plastico.bounds.getSize(new THREE.Vector3());
  document.getElementById('dims')!.textContent =
    `Area ≈ ${(size.x / 1000).toFixed(1)} × ${(size.z / 1000).toFixed(1)} km · quota max ≈ ${Math.round(plastico.bounds.max.y / CONFIG.verticalExaggeration)} m`;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  routes.resize(innerWidth, innerHeight);
  viewer360.resize();
});

// link diretto all'apertura (#localita-conegliano, #itinerario-2, #foto-…)
if (location.hash.length > 1 && !debug) { lastHash = location.hash.slice(1); navigate(lastHash, true); }

const clock = new THREE.Timer();
renderer.setAnimationLoop(() => {
  clock.update();
  // passo massimo 0,5 s: le transizioni finiscono in tempo anche su dispositivi lenti
  const dt = Math.min(clock.getDelta(), 0.5);
  if (viewer360.isOpen) { viewer360.render(); return; }
  if (anim && mode === 'aerea') {
    anim.t = Math.min(1, anim.t + dt / anim.dur);
    const k = anim.t < 0.5 ? 4 * anim.t ** 3 : 1 - (-2 * anim.t + 2) ** 3 / 2;
    camera.position.lerpVectors(anim.from, anim.to, k);
    controls.target.lerpVectors(anim.tFrom, anim.tTo, k);
    if (anim.t >= 1) anim = null;
  }
  // campo visivo: stretto in veduta aerea (assonometria), ampio vicino al suolo
  const fovT = mode === 'aerea' ? CONFIG.aerial.fov : CONFIG.groundFov;
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  if (mode === 'aerea') {
    controls.update();
    // niente zoom eccessivo: la camera resta sempre almeno a CONFIG.aerial.minHeight sopra il terreno
    const g = H(camera.position.x, camera.position.z);
    if (g !== null && camera.position.y < g + CONFIG.aerial.minHeight) camera.position.y = g + CONFIG.aerial.minHeight;
  }
  fp.update(dt, camera);
  flight.update(dt, camera);
  updateNear(dt);
  monuments.boost = mode === 'volo' ? CONFIG.flight.monumentBoost : 1;
  monuments.update(camera);
  content.update(camera, dt);
  routes.update(dt, camera);
  renderer.render(scene, camera);
  labels.update(camera);
});

// per la verifica da console (valori sempre aggiornati dopo le modifiche della redazione)
// protezione delle foto: niente menu del tasto destro né trascinamento sulle immagini e sulla mappa
for (const ev of ['contextmenu', 'dragstart'] as const) {
  document.addEventListener(ev, (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'IMG' || t.tagName === 'CANVAS')) e.preventDefault();
  });
}
if (import.meta.env.VITE_EXPORT) {
  import('./tools/exportModel').then((m) => {
    (window as any).exportModel = async () => {
      const blob = await m.exportModel(plastico, monuments, routes);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'plastico.glb'; document.body.appendChild(a); a.click();
    };
  });
}
Object.assign(window as any, { plastico, camera, controls, scene, routes, monuments, openContent, flyTo, navigate, fp, flight, setMode });
Object.defineProperties(window, {
  labels: { get: () => labels }, content: { get: () => content }, pois: { get: () => pois }, contenuti: { get: () => contenuti },
});
