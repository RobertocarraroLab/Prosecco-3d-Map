import { drawBullet, iconSize } from '../layers/icons';

/** Elaborazione delle immagini caricate dalla redazione, nel browser (stesse regole di prepara_contenuti.py). */

const toBlob = (cv: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Conversione immagine non riuscita'))), type, q));

function canvasOf(w: number, h: number) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(w); cv.height = Math.round(h);
  return cv;
}

/** Ritaglio centrale "cover" della bitmap nel rettangolo (x, y, s, s). */
function cover(ctx: CanvasRenderingContext2D, bmp: ImageBitmap, x: number, y: number, s: number) {
  const k = Math.max(s / bmp.width, s / bmp.height);
  const w = bmp.width * k, h = bmp.height * k;
  ctx.drawImage(bmp, x + (s - w) / 2, y + (s - h) / 2, w, h);
}

export async function processImage(file: File) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  // anteprima: lato lungo 1600 px
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = canvasOf(bmp.width * k, bmp.height * k);
  const c = cv.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(bmp, 0, 0, cv.width, cv.height);
  const preview = await toBlob(cv, 'image/webp', 0.8);
  const icon = await toBlob(drawBullet((ctx, x, y, s) => cover(ctx, bmp, x, y, s)), 'image/webp', 0.88);
  return { preview, icon, iconDim: { ...iconSize(), disco: 200 } };
}

export async function process360(file: File) {
  const bmp = await createImageBitmap(file);
  if (Math.abs(bmp.width / bmp.height - 2) > 0.05) {
    throw new Error(`La foto 360 deve essere equirettangolare 2:1 (questa è ${bmp.width}×${bmp.height})`);
  }
  const big = canvasOf(4000, 2000);
  const bc = big.getContext('2d')!;
  bc.imageSmoothingQuality = 'high';
  bc.drawImage(bmp, 0, 0, 4000, 2000);
  const tiny = canvasOf(100, 50);
  tiny.getContext('2d')!.drawImage(bmp, 0, 0, 100, 50);
  return { full: await toBlob(big, 'image/jpeg', 0.82), thumb: await toBlob(tiny, 'image/jpeg', 0.85) };
}
