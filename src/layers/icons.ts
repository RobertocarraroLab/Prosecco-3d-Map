/**
 * Icone a bullet point (disco con bordo bianco e asta sottile, come "bullet point immagini.fbx").
 * Le icone delle foto sono generate dalla foto; gli altri tipi di contenuto usano un'icona generica.
 */
export const ICON = { d: 192, ring: 9, stick: 1.46 };
export const iconSize = () => ({ w: ICON.d + 16, h: ICON.d + Math.round(ICON.d * ICON.stick) + 8 });

/** Disegna l'icona: `paint` riempie il disco (ctx già ritagliato al cerchio interno). */
export function drawBullet(paint: (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => void): HTMLCanvasElement {
  const { d, ring } = ICON;
  const { w, h } = iconSize();
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const cx = w / 2;
  // ombra
  ctx.save(); ctx.filter = 'blur(5px)'; ctx.fillStyle = 'rgba(0,0,0,.43)';
  ctx.beginPath(); ctx.arc(cx, 10 + d / 2, d / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  // asta
  ctx.fillStyle = 'rgba(38,52,59,.9)'; ctx.fillRect(cx - 3, 8 + d - 4, 6, h - (8 + d - 4));
  ctx.fillStyle = '#fff'; ctx.fillRect(cx - 1, 8 + d - 4, 2, h - (8 + d - 4) - 1);
  // disco bianco
  ctx.beginPath(); ctx.arc(cx, 4 + d / 2, d / 2, 0, Math.PI * 2); ctx.fill();
  // contenuto ritagliato
  const s = d - 2 * ring;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, 4 + d / 2, s / 2, 0, Math.PI * 2); ctx.clip();
  paint(ctx, cx - s / 2, 4 + ring, s);
  ctx.restore();
  return cv;
}

const GENERIC: Record<string, { color: string; glyph: string }> = {
  testo: { color: '#4a6b7a', glyph: 'T' },
  video: { color: '#b3362b', glyph: '▶' },
  link: { color: '#2f6f9f', glyph: '↗' },
  pdf: { color: '#7a4a9a', glyph: 'PDF' },
  audio: { color: '#3a8a5a', glyph: '♪' },
};
const cache = new Map<string, string>();

/** Icona generica per i contenuti senza foto (testo, video, link, PDF, audio). */
export function genericIcon(tipo: string): string {
  if (cache.has(tipo)) return cache.get(tipo)!;
  const g = GENERIC[tipo] ?? GENERIC.testo;
  const url = drawBullet((ctx, x, y, s) => {
    ctx.fillStyle = g.color; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${g.glyph.length > 1 ? s * 0.3 : s * 0.48}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g.glyph, x + s / 2, y + s / 2 + s * 0.03);
  }).toDataURL('image/png');
  cache.set(tipo, url);
  return url;
}
