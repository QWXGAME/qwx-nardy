// Рисованные текстуры: поле доски с треугольниками, торцы фишек, грани костей. Общие для 3D и 2D.

import { L, pointBase } from './layout';
import { boardLook } from './looks';
import { CHECKER, DICE } from '../shared/Catalog';

const cv = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
};

export function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, amt: number) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}

/** волокна дерева полосами */
export function woodFill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, dark: string, vertical = false) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = base; g.fillRect(x, y, w, h);
  const n = Math.max(20, Math.round((vertical ? w : h) / 3));
  for (let i = 0; i < n; i++) {
    g.strokeStyle = Math.random() < 0.5 ? dark : shade(base, 0.25);
    g.globalAlpha = 0.08 + Math.random() * 0.18;
    g.lineWidth = 0.6 + Math.random() * 2.2;
    g.beginPath();
    if (vertical) {
      const xx = x + Math.random() * w;
      g.moveTo(xx, y);
      for (let t = 0; t <= h; t += 20) g.lineTo(xx + Math.sin(t * 0.02 + i) * 4, y + t);
    } else {
      const yy = y + Math.random() * h;
      g.moveTo(x, yy);
      for (let t = 0; t <= w; t += 20) g.lineTo(x + t, yy + Math.sin(t * 0.02 + i) * 4);
    }
    g.stroke();
  }
  g.restore();
}

/** поле доски (без рамки): px — пикселей на единицу доски */
export function fieldCanvas(boardId: string, px = 1800): HTMLCanvasElement {
  const key = boardId + px;
  const hit = fieldCache.get(key);
  if (hit) return hit;
  const b = boardLook(boardId);
  const W = Math.round(L.W * px), H = Math.round(L.H * px);
  const [c, g] = cv(W, H);
  // поле: сукно/кожа с мелкой фактурой
  g.fillStyle = b.field; g.fillRect(0, 0, W, H);
  grain(g, W, H, 10);
  const vg = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.7);
  vg.addColorStop(0, 'rgba(255,255,255,0.06)'); vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  const X = (x: number) => (x + L.W / 2) * px, V = (v: number) => (v + L.H / 2) * px;
  // треугольники
  for (let i = 0; i < 24; i++) {
    const p = pointBase(i);
    const col = i % 2 ? b.p1 : b.p2;
    const baseV = p.dir < 0 ? L.H / 2 : -L.H / 2;
    const tipV = baseV + p.dir * L.TRI;
    const x0 = X(p.x - L.PW / 2 + 0.003), x1 = X(p.x + L.PW / 2 - 0.003), xm = X(p.x);
    const grd = g.createLinearGradient(0, V(baseV), 0, V(tipV));
    grd.addColorStop(0, shade(col, 0.08)); grd.addColorStop(1, shade(col, -0.18));
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(x0, V(baseV)); g.lineTo(x1, V(baseV)); g.lineTo(xm, V(tipV)); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(212,175,55,0.55)'; g.lineWidth = px * 0.0012; g.stroke();
    // узор-инкрустация у основания
    g.fillStyle = 'rgba(212,175,55,0.5)';
    g.beginPath(); g.arc(xm, V(baseV - p.dir * 0.012), px * 0.003, 0, 7); g.fill();
  }
  // бар: деревянная полоса
  woodFill(g, X(-L.B / 2), 0, L.B * px, H, b.wood, b.woodDark, true);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(X(-L.B / 2), 0, px * 0.004, H); g.fillRect(X(L.B / 2) - px * 0.004, 0, px * 0.004, H);
  // латунные петли
  for (const v of [-L.H / 4, L.H / 4]) {
    const gg = g.createLinearGradient(X(-0.02), 0, X(0.02), 0);
    gg.addColorStop(0, '#7a5a26'); gg.addColorStop(0.5, '#f0d79a'); gg.addColorStop(1, '#7a5a26');
    g.fillStyle = gg; g.fillRect(X(-0.018), V(v) - px * 0.035, px * 0.036, px * 0.07);
  }
  fieldCache.set(key, c);
  return c;
}
const fieldCache = new Map<string, HTMLCanvasElement>();

/** торец фишки: цвет, кольца, инкрустация */
export function checkerTop(setId: string, dark: boolean, size = 256): HTMLCanvasElement {
  const key = setId + dark + size;
  const hit = topCache.get(key);
  if (hit) return hit;
  const s = CHECKER[setId] || CHECKER.classic;
  const col = dark ? s.dark : s.light;
  const [c, g] = cv(size, size);
  const r = size / 2;
  g.translate(r, r);
  const base = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r);
  base.addColorStop(0, shade(col, 0.22)); base.addColorStop(0.7, col); base.addColorStop(1, shade(col, -0.3));
  g.fillStyle = base; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  if (s.pattern === 'marble') {
    g.save(); g.beginPath(); g.arc(0, 0, r, 0, 7); g.clip();
    g.strokeStyle = dark ? 'rgba(255,255,255,0.25)' : 'rgba(40,40,50,0.3)';
    for (let i = 0; i < 9; i++) { g.lineWidth = 1 + Math.random() * 2; g.beginPath(); let x = -r, y = (Math.random() - 0.5) * size; g.moveTo(x, y); while (x < r) { x += 14; y += (Math.random() - 0.5) * 18; g.lineTo(x, y); } g.stroke(); }
    g.restore();
  } else if (s.pattern === 'pearl') {
    const p = g.createLinearGradient(-r, -r, r, r);
    p.addColorStop(0, 'rgba(255,200,230,0.25)'); p.addColorStop(0.5, 'rgba(200,230,255,0.25)'); p.addColorStop(1, 'rgba(255,240,200,0.25)');
    g.fillStyle = p; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  } else if (s.pattern === 'wood') {
    for (let k = 0; k < 14; k++) { g.strokeStyle = `rgba(0,0,0,${0.06 + Math.random() * 0.08})`; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); g.arc(r * 0.4, r * 1.6, r * (0.6 + k * 0.12), 0, 7); g.stroke(); }
  }
  // кольца
  g.strokeStyle = s.rim; g.globalAlpha = 0.85;
  g.lineWidth = size * 0.025; g.beginPath(); g.arc(0, 0, r * 0.86, 0, 7); g.stroke();
  g.lineWidth = size * 0.01; g.beginPath(); g.arc(0, 0, r * 0.72, 0, 7); g.stroke();
  g.globalAlpha = 1;
  // инкрустация: восьмилучевая звезда
  g.fillStyle = dark ? s.rim : s.inlay;
  g.beginPath();
  for (let i = 0; i < 16; i++) { const rr = i % 2 ? r * 0.16 : r * 0.42, a = (i / 16) * Math.PI * 2; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(0, 0, r * 0.1, 0, 7); g.fill();
  topCache.set(key, c);
  return c;
}
const topCache = new Map<string, HTMLCanvasElement>();

/** грань кости с точками */
export function diceFace(setId: string, n: number, size = 128): HTMLCanvasElement {
  const key = setId + n + size;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const d = DICE[setId] || DICE.ivory;
  const [c, g] = cv(size, size);
  const grd = g.createLinearGradient(0, 0, size, size);
  grd.addColorStop(0, shade(d.body, 0.12)); grd.addColorStop(1, shade(d.body, -0.12));
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const P: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]], 2: [[0.27, 0.27], [0.73, 0.73]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]],
  };
  for (const [x, y] of P[n]) {
    const rr = size * (n === 1 ? 0.12 : 0.085);
    const pg = g.createRadialGradient(x * size - rr * 0.3, y * size - rr * 0.3, 1, x * size, y * size, rr);
    pg.addColorStop(0, shade(d.pip, -0.2)); pg.addColorStop(1, d.pip);
    g.fillStyle = n === 1 && d.id === 'ivory' ? '#8a1420' : pg;
    g.beginPath(); g.arc(x * size, y * size, rr, 0, 7); g.fill();
  }
  faceCache.set(key, c);
  return c;
}
const faceCache = new Map<string, HTMLCanvasElement>();

/** маленькая кость для интерфейса (data-URL) */
export function diceIcon(setId: string, n: number): string {
  const key = setId + n;
  let u = iconCache.get(key);
  if (!u) {
    const [c, g] = cv(96, 96);
    g.save();
    g.beginPath(); g.roundRect(4, 4, 88, 88, 18); g.clip();
    g.drawImage(diceFace(setId, n, 96), 0, 0, 96, 96);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.beginPath(); g.roundRect(4, 4, 88, 88, 18); g.stroke();
    u = c.toDataURL();
    iconCache.set(key, u);
  }
  return u;
}
const iconCache = new Map<string, string>();
