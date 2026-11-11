// Лёгкая 2D-доска: вид сверху на canvas. В портрете доска повёрнута вдоль экрана.

import type { Renderer, Position, Highlight } from '../view';
import { L, slot, barSlot, traySlot, pickSpot, pointBase } from '../layout';
import type { Spot } from '../layout';
import { fieldCanvas, checkerTop, diceFace, woodFill } from '../art';
import { boardLook } from '../looks';

interface C2 { side: 0 | 1; spot: Spot | null; k: number; x: number; v: number; fx: number; fv: number; tx: number; tv: number; t: number; dur: number; layer: number; tray: boolean }
interface D2 { v: number; x: number; y: number; fx: number; fy: number; tx: number; ty: number; t: number; dur: number; rot: number; used: boolean; set: string }

export class Table2D implements Renderer {
  readonly kind = '2d' as const;
  private cv = document.createElement('canvas');
  private c = this.cv.getContext('2d')!;
  private chks: C2[] = [];
  private dice: D2[] = [];
  private side = 0;
  private variant: 'long' | 'short' = 'long';
  private checkers = 'classic';
  private boardId = 'walnut';
  private frameImg: HTMLCanvasElement | null = null;
  private hl: Highlight = { from: [], sel: null, to: [] };
  private frameCbs: ((dt: number) => void)[] = [];
  private soundCbs: ((k: 'checker' | 'dice' | 'hit', v: number) => void)[] = [];
  private last = performance.now();
  private t = 0;
  private dpr = Math.min(3, devicePixelRatio || 1);
  private w = 0; private h = 0;

  constructor(private el: HTMLElement, boardId: string, checkers: string) {
    this.boardId = boardId;
    this.checkers = checkers;
    this.cv.className = 'table2d';
    el.appendChild(this.cv);
    for (const side of [0, 1] as const) for (let k = 0; k < 15; k++) this.chks.push({ side, spot: null, k: 0, x: 0, v: 0, fx: 0, fv: 0, tx: 0, tv: 0, t: 1, dur: 0.3, layer: 0, tray: false });
    for (let i = 0; i < 2; i++) this.dice.push({ v: 1, x: 0, y: 0, fx: 0, fy: 0, tx: 0, ty: 0, t: 1, dur: 1, rot: 0, used: false, set: 'ivory' });
    addEventListener('resize', () => this.resize());
    this.resize();
    const loop = () => { this.tick(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  private resize() {
    this.w = this.el.clientWidth || innerWidth;
    this.h = this.el.clientHeight || innerHeight;
    this.cv.width = Math.round(this.w * this.dpr);
    this.cv.height = Math.round(this.h * this.dpr);
    this.cv.style.width = this.w + 'px';
    this.cv.style.height = this.h + 'px';
  }

  private get portrait() { return this.h > this.w; }
  /** масштаб: пикселей на единицу доски, центр, поворот */
  private geo() {
    const totalW = L.W + 2 * L.FRAME + 2 * (L.TRAY + L.FRAME), totalH = L.H + 2 * L.FRAME;
    const top = 70, bottom = this.portrait ? 170 : 120;
    const availW = this.w - 24, availH = this.h - top - bottom;
    const k = this.portrait ? Math.min(availW / totalH, availH / totalW) : Math.min(availW / totalW, availH / totalH);
    return { k, cx: this.w / 2, cy: top + availH / 2 };
  }
  /** единицы доски (с учётом стороны) → экран */
  private toPx(x: number, v: number) {
    const { k, cx, cy } = this.geo();
    if (this.side === 1) { x = -x; v = -v; }
    return this.portrait ? { x: cx - v * k, y: cy + x * k } : { x: cx + x * k, y: cy + v * k };
  }
  private fromPx(px: number, py: number) {
    const { k, cx, cy } = this.geo();
    let x: number, v: number;
    if (this.portrait) { v = -(px - cx) / k; x = (py - cy) / k; } else { x = (px - cx) / k; v = (py - cy) / k; }
    if (this.side === 1) { x = -x; v = -v; }
    return { x, v };
  }

  setSide(side: number) { this.side = side; }
  setLooks(checkers: string, boardId: string) { this.checkers = checkers; if (boardId !== this.boardId) { this.boardId = boardId; this.frameImg = null; } }

  private place(side: number, spot: Spot, k: number) {
    const s = spot === 24 ? traySlot(side, k, this.variant) : spot === -1 ? barSlot(side, k) : slot(spot, k);
    return { x: s.x, v: s.v, layer: s.layer };
  }

  setPosition(pos: Position, instant = false) {
    this.variant = pos.variant;
    let moved = 0, hit = false;
    for (const side of [0, 1] as const) {
      const need = new Map<Spot, number>();
      pos.board.forEach((v, i) => { const n = side === 0 ? Math.max(0, v) : Math.max(0, -v); if (n) need.set(i, n); });
      if (pos.bar[side]) need.set(-1, pos.bar[side]);
      if (pos.off[side]) need.set(24, pos.off[side]);
      const mine = this.chks.filter(c => c.side === side);
      const have = new Map<Spot, C2[]>();
      for (const c of mine) if (c.spot !== null) { const a = have.get(c.spot) || []; a.push(c); have.set(c.spot, a); }
      const free = mine.filter(c => c.spot === null);
      for (const [spot, list] of have) { list.sort((a, b) => a.k - b.k); const n = need.get(spot) || 0; while (list.length > n) free.push(list.pop()!); }
      for (const [spot, n] of need) {
        const list = have.get(spot) || [];
        while (list.length < n && free.length) { const c = free.shift()!; if (c.spot !== null) { moved++; if (spot === -1) hit = true; } c.spot = spot; list.push(c); }
        have.set(spot, list);
      }
      for (const c of free) c.spot = null;
      for (const [spot, list] of have) list.forEach((c, k) => {
        const p = this.place(side, spot, k);
        const fresh = c.tx === 0 && c.tv === 0 && c.t >= 1 && c.x === 0;
        c.k = k; c.layer = p.layer; c.tray = spot === 24;
        if (instant || fresh) { c.x = c.fx = c.tx = p.x; c.v = c.fv = c.tv = p.v; c.t = 1; return; }
        if (Math.abs(c.tx - p.x) + Math.abs(c.tv - p.v) < 1e-6) return;
        c.fx = c.x; c.fv = c.v; c.tx = p.x; c.tv = p.v; c.t = 0;
        c.dur = Math.min(0.6, 0.18 + Math.hypot(c.fx - p.x, c.fv - p.v) * 0.7);
      });
    }
    if (moved && !instant) setTimeout(() => this.soundCbs.forEach(f => f(hit ? 'hit' : 'checker', 1)), 300);
  }

  setDice(values: number[], left: number[], side: number, set: string, throwIt: boolean) {
    const rem = [...left];
    this.dice.forEach((d, i) => {
      if (!values.length) { d.v = 0; return; }
      const v = values[i];
      d.set = set;
      const ix = rem.indexOf(v);
      d.used = ix < 0; if (ix >= 0) rem.splice(ix, 1);
      if (values[0] === values[1]) d.used = i === 0 ? left.length <= 2 : left.length === 0;
      const sgn = side === 0 ? 1 : -1;
      const tx = sgn * (L.W / 4 + (i - 0.5) * 0.1), ty = sgn * (i - 0.5) * 0.05;
      if (throwIt) {
        d.fx = sgn * (L.W / 2); d.fy = sgn * 0.25; d.t = 0; d.dur = 0.8 + i * 0.1; d.rot = (Math.random() - 0.5) * 12;
        setTimeout(() => this.soundCbs.forEach(f => f('dice', 1)), 250);
      } else if (d.v !== v) { d.t = 1; d.x = tx; d.y = ty; }
      d.v = v; d.tx = tx; d.ty = ty;
    });
  }

  highlight(h: Highlight) { this.hl = h; }
  pick(sx: number, sy: number): Spot | null {
    const r = this.cv.getBoundingClientRect();
    const p = this.fromPx(sx - r.left, sy - r.top);
    return pickSpot(p.x, p.v, this.variant, this.side);
  }
  toScreen(spot: Spot, side: number) {
    const p = this.place(side, spot, 0);
    const q = this.toPx(p.x, p.v);
    const r = this.cv.getBoundingClientRect();
    return { x: r.left + q.x, y: r.top + q.y };
  }
  setLobby(_on: boolean) { /* */ }
  onFrame(cb: (dt: number) => void) { this.frameCbs.push(cb); }
  onLowPower(_cb: (low: boolean) => void) { /* 2D всегда лёгкий */ }
  onSound(cb: (k: 'checker' | 'dice' | 'hit', v: number) => void) { this.soundCbs.push(cb); }

  /** рамка короба (дерево) один раз в холст */
  private frame(k: number) {
    if (this.frameImg && this.frameImg.width === Math.round(k * 2)) return this.frameImg;
    const b = boardLook(this.boardId);
    const c = document.createElement('canvas');
    c.width = Math.round(k * 2); c.height = 256;
    woodFill(c.getContext('2d')!, 0, 0, c.width, 256, b.wood, b.woodDark);
    this.frameImg = c;
    return c;
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const c = this.c, D = this.dpr;
    c.setTransform(D, 0, 0, D, 0, 0);
    // фон
    const bg = c.createRadialGradient(this.w / 2, this.h * 0.45, 20, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    bg.addColorStop(0, '#3a2418'); bg.addColorStop(1, '#070405');
    c.fillStyle = bg; c.fillRect(0, 0, this.w, this.h);
    const { k, cx, cy } = this.geo();
    c.save();
    c.translate(cx, cy);
    if (this.portrait) c.rotate(Math.PI / 2);
    if (this.side === 1) c.rotate(Math.PI);
    // короб
    const outerW = (L.W + 2 * L.FRAME + 2 * (L.TRAY + L.FRAME)) * k, outerH = (L.H + 2 * L.FRAME) * k;
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 40; c.shadowOffsetY = 16;
    c.fillStyle = '#2a1408';
    c.beginPath(); c.roundRect(-outerW / 2, -outerH / 2, outerW, outerH, 10); c.fill();
    c.restore();
    c.save();
    c.beginPath(); c.roundRect(-outerW / 2, -outerH / 2, outerW, outerH, 10); c.clip();
    c.drawImage(this.frame(outerW / 2), -outerW / 2, -outerH / 2, outerW, outerH);
    const sh = c.createLinearGradient(0, -outerH / 2, 0, outerH / 2);
    sh.addColorStop(0, 'rgba(255,230,190,0.18)'); sh.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = sh; c.fillRect(-outerW / 2, -outerH / 2, outerW, outerH);
    c.restore();
    // поле
    c.drawImage(fieldCanvas(this.boardId), -L.W / 2 * k, -L.H / 2 * k, L.W * k, L.H * k);
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 2; c.strokeRect(-L.W / 2 * k, -L.H / 2 * k, L.W * k, L.H * k);
    // лотки
    const b = boardLook(this.boardId);
    for (const sx of [-1, 1]) {
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect((sx > 0 ? L.W / 2 + L.FRAME : -(L.W / 2 + L.FRAME + L.TRAY)) * k, -L.H / 2 * k, L.TRAY * k, L.H * k);
    }
    void b;
    // подсветка
    const h = this.hl, t = this.t;
    for (let i = 0; i < 24; i++) {
      const to = h.to.includes(i), sel = h.sel === i, from = h.from.includes(i);
      if (!to && !sel && !from) continue;
      const p = pointBase(i);
      const baseV = p.dir < 0 ? L.H / 2 : -L.H / 2, tipV = baseV + p.dir * L.TRI;
      c.fillStyle = to ? `rgba(120,255,170,${0.35 + Math.sin(t * 5) * 0.12})` : sel ? 'rgba(255,214,110,0.45)' : `rgba(255,214,110,${0.14 + Math.sin(t * 3 + i) * 0.05})`;
      c.beginPath(); c.moveTo((p.x - L.PW / 2) * k, baseV * k); c.lineTo((p.x + L.PW / 2) * k, baseV * k); c.lineTo(p.x * k, tipV * k); c.closePath(); c.fill();
    }
    if (h.to.includes(24)) {
      const right = this.side === 0 || this.variant === 'short';
      c.fillStyle = `rgba(120,255,170,${0.3 + Math.sin(t * 5) * 0.12})`;
      c.fillRect((right ? L.W / 2 + L.FRAME : -(L.W / 2 + L.FRAME + L.TRAY)) * k, (this.side === 0 ? 0 : -L.H / 2) * k, L.TRAY * k, L.H / 2 * k);
    }
    if (h.from.includes(-1) || h.sel === -1) { c.fillStyle = `rgba(255,214,110,${0.2 + Math.sin(t * 4) * 0.08})`; c.fillRect(-L.B / 2 * k, -L.H / 2 * k, L.B * k, L.H * k); }
    // фишки: сначала нижние слои
    const r = L.R * k * 0.97;
    const list = this.chks.filter(x => x.spot !== null).sort((a, b) => a.layer - b.layer || (a.t < 1 ? 1 : 0) - (b.t < 1 ? 1 : 0));
    for (const ch of list) {
      if (ch.t < 1) {
        ch.t = Math.min(1, ch.t + dt / ch.dur);
        const e = ch.t < 0.5 ? 4 * ch.t ** 3 : 1 - (-2 * ch.t + 2) ** 3 / 2;
        ch.x = ch.fx + (ch.tx - ch.fx) * e; ch.v = ch.fv + (ch.tv - ch.fv) * e;
      }
      const lift = ch.t < 1 ? Math.sin(Math.PI * ch.t) * 0.25 : 0;
      const sel = ch.side === this.side && ch.spot === h.sel && this.isTop(ch);
      const px = ch.x * k, py = ch.v * k;
      const mine = ch.side === this.side;
      if (ch.tray) {
        // снятые — «монетки» на ребре
        c.fillStyle = mine ? '#efe4c8' : '#1a1412';
        c.strokeStyle = 'rgba(0,0,0,0.5)';
        c.beginPath(); c.roundRect(px - r * 0.95, py - k * 0.0055, r * 1.9, k * 0.011, 2); c.fill(); c.stroke();
        continue;
      }
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 6 + lift * 30; c.shadowOffsetY = 2 + lift * 14;
      const s = 1 + lift * 0.25 + (sel ? 0.1 : 0);
      c.drawImage(checkerTop(this.checkers, !mine), px - r * s, py - r * s - (sel ? 3 : 0), r * 2 * s, r * 2 * s);
      c.restore();
      if (sel) { c.strokeStyle = 'rgba(255,214,110,0.9)'; c.lineWidth = 2; c.beginPath(); c.arc(px, py - 3, r * 1.12, 0, 7); c.stroke(); }
    }
    // кости
    for (const d of this.dice) {
      if (!d.v) continue;
      if (d.t < 1) {
        d.t = Math.min(1, d.t + dt / d.dur);
        const e = 1 - (1 - d.t) ** 3;
        d.x = d.fx + (d.tx - d.fx) * e; d.y = d.fy + (d.ty - d.fy) * e;
      }
      const tumble = d.t < 1 ? (1 - d.t) : 0;
      const size = 0.045 * k * (1 + Math.abs(Math.sin(d.t * Math.PI * 3)) * tumble * 0.5);
      c.save();
      c.translate(d.x * k, d.y * k);
      c.rotate(d.rot * tumble + 0.15);
      c.globalAlpha = d.used ? 0.4 : 1;
      c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 8; c.shadowOffsetY = 3;
      c.beginPath(); c.roundRect(-size / 2, -size / 2, size, size, size * 0.18); c.clip();
      const face = tumble > 0.15 ? 1 + Math.floor(this.t * 20) % 6 : d.v;
      c.drawImage(diceFace(d.set, face), -size / 2, -size / 2, size, size);
      c.restore();
    }
    c.restore();
    for (const cb of this.frameCbs) cb(dt);
  }

  private isTop(ch: C2) {
    let max = -1;
    for (const o of this.chks) if (o.side === ch.side && o.spot === ch.spot) max = Math.max(max, o.k);
    return ch.k === max;
  }
}
