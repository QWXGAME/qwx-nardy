// Нарды: длинные и короткие (бэкгаммон). Правила, допустимые ходы, итог партии.
//
// Доска — 24 пункта (индексы 0..23), счёт со знаком: + фишки места 0 (белые), − места 1 (чёрные).
// Каждый игрок считает свой путь «шагами» 0..23 (0 — начало, 18..23 — дом), 24 — фишка снята с доски, −1 — на баре.
//   короткие: белые шаг s → пункт 23−s, чёрные шаг s → пункт s (идут навстречу, можно бить)
//   длинные:  белые шаг s → пункт 23−s, чёрные шаг s → пункт (11−s+24)%24 (идут в одну сторону, бить нельзя)

export type Variant = 'long' | 'short';
export type Side = 0 | 1;
export interface Move { from: number; to: number; die: number; hit?: boolean }
export type Result = 'oin' | 'mars' | 'koks';

export const CHECKERS = 15;
export const VARIANT_NAME: Record<Variant, string> = { long: 'Длинные нарды', short: 'Короткие нарды' };

/** пункт доски для шага игрока */
export function pointOf(v: Variant, p: Side, step: number): number {
  if (p === 0) return 23 - step;
  return v === 'short' ? step : (11 - step + 24) % 24;
}
/** шаг игрока для пункта доски */
export function stepOf(v: Variant, p: Side, point: number): number {
  if (p === 0) return 23 - point;
  return v === 'short' ? point : (11 - point + 24) % 24;
}

export interface NardyState {
  variant: Variant;
  board: number[];
  bar: [number, number];
  off: [number, number];
  turn: Side;
  dice: number[];
  left: number[];
  headUsed: number;
  /** игрок ещё не сделал ни одного хода (первый бросок: 6-6, 4-4, 3-3 — две фишки с головы) */
  fresh: [boolean, boolean];
}

export class Nardy implements NardyState {
  variant: Variant = 'long';
  board: number[] = new Array(24).fill(0);
  bar: [number, number] = [0, 0];
  off: [number, number] = [0, 0];
  turn: Side = 0;
  dice: number[] = [];
  left: number[] = [];
  headUsed = 0;
  fresh: [boolean, boolean] = [true, true];
  /** ходы этого броска (для отмены) */
  history: { m: Move; snap: string }[] = [];
  private memo = new Map<string, number>();

  constructor(v: Variant = 'long') { this.reset(v, 0); }

  static from(s: NardyState): Nardy {
    const n = new Nardy(s.variant);
    n.board = [...s.board]; n.bar = [...s.bar] as [number, number]; n.off = [...s.off] as [number, number];
    n.turn = s.turn; n.dice = [...s.dice]; n.left = [...s.left]; n.headUsed = s.headUsed; n.fresh = [...s.fresh] as [boolean, boolean];
    return n;
  }

  reset(v: Variant, first: Side) {
    this.variant = v;
    this.board = new Array(24).fill(0);
    this.bar = [0, 0]; this.off = [0, 0];
    this.turn = first;
    this.dice = []; this.left = [];
    this.headUsed = 0;
    this.fresh = [true, true];
    this.history = [];
    for (const p of [0, 1] as Side[]) {
      const sign = p === 0 ? 1 : -1;
      if (v === 'long') this.board[pointOf(v, p, 0)] += sign * 15;
      else for (const [st, n] of [[0, 2], [11, 5], [16, 3], [18, 5]]) this.board[pointOf(v, p, st)] += sign * n;
    }
  }

  // ───────────── доступ ─────────────

  /** сколько фишек игрока p на его шаге s */
  own(p: Side, s: number) { const v = this.board[pointOf(this.variant, p, s)]; return p === 0 ? Math.max(0, v) : Math.max(0, -v); }
  /** сколько фишек соперника на пункте, куда игрок p попадает шагом s */
  foe(p: Side, s: number) { const v = this.board[pointOf(this.variant, p, s)]; return p === 0 ? Math.max(0, -v) : Math.max(0, v); }
  allHome(p: Side) {
    if (this.bar[p]) return false;
    for (let s = 0; s < 18; s++) if (this.own(p, s)) return false;
    return true;
  }
  /** сумма пунктов до конца (pip count) */
  pips(p: Side) {
    let n = this.bar[p] * 25;
    for (let s = 0; s < 24; s++) n += this.own(p, s) * (24 - s);
    return n;
  }
  winner(): Side | -1 { return this.off[0] >= CHECKERS ? 0 : this.off[1] >= CHECKERS ? 1 : -1; }

  result(): Result {
    const w = this.winner();
    if (w < 0) return 'oin';
    const l = (1 - w) as Side;
    if (this.off[l] > 0) return 'oin';
    if (this.variant === 'short') {
      // кокс: у проигравшего фишка на баре или в доме победителя
      if (this.bar[l]) return 'koks';
      for (let s = 0; s < 6; s++) if (this.own(l, s)) return 'koks';
    }
    return 'mars';
  }

  // ───────────── бросок ─────────────

  roll(a: number, b: number) {
    this.dice = [a, b];
    this.left = a === b ? [a, a, a, a] : [a, b];
    this.headUsed = 0;
    this.history = [];
    this.memo.clear();
  }

  private headLimit(p: Side) {
    if (this.variant !== 'long') return 99;
    const [a, b] = this.dice;
    return this.fresh[p] && a === b && (a === 6 || a === 4 || a === 3) ? 2 : 1;
  }

  // ───────────── ходы ─────────────

  /** все одиночные ходы по правилам (без учёта «надо сыграть максимум костей») */
  private raw(): Move[] {
    const p = this.turn, v = this.variant;
    const out: Move[] = [];
    const dice = [...new Set(this.left)];
    if (v === 'short' && this.bar[p]) {
      for (const d of dice) {
        const to = d - 1;
        const f = this.foe(p, to);
        if (f <= 1) out.push({ from: -1, to, die: d, hit: f === 1 });
      }
      return out;
    }
    const home = this.allHome(p);
    let back = 24;
    for (let s = 0; s < 24; s++) if (this.own(p, s)) { back = s; break; }
    for (let s = 0; s < 24; s++) {
      if (!this.own(p, s)) continue;
      if (v === 'long' && s === 0 && this.headUsed >= this.headLimit(p)) continue;
      for (const d of dice) {
        const t = s + d;
        if (t < 24) {
          const f = this.foe(p, t);
          if (v === 'long' ? f > 0 : f > 1) continue;
          const m: Move = { from: s, to: t, die: d, hit: v === 'short' && f === 1 };
          if (v === 'long' && this.makesBadBlock(m)) continue;
          out.push(m);
        } else if (home && (t === 24 || s === back)) out.push({ from: s, to: 24, die: d });
      }
    }
    return out;
  }

  /** длинные нарды: нельзя ставить 6 пунктов подряд, если впереди блока нет ни одной фишки соперника */
  private makesBadBlock(m: Move): boolean {
    const p = this.turn, q = (1 - p) as Side, v = this.variant;
    const sign = p === 0 ? 1 : -1;
    const b = [...this.board];
    if (m.from >= 0) b[pointOf(v, p, m.from)] -= sign;
    if (m.to < 24) b[pointOf(v, p, m.to)] += sign;
    const mine = (pt: number) => sign * b[pt] > 0;
    // ищем 6 подряд по ходу соперника (по его шагам)
    let run = 0;
    for (let s = 0; s < 24; s++) {
      run = mine(pointOf(v, q, s)) ? run + 1 : 0;
      if (run >= 6) {
        // блок занимает шаги соперника s−5..s; есть ли его фишка дальше блока?
        let ahead = false;
        for (let k = s + 1; k < 24; k++) if (-sign * b[pointOf(v, q, k)] > 0) { ahead = true; break; }
        if (!ahead) return true;
      }
    }
    return false;
  }

  private key() { return this.board.join(',') + '|' + this.bar + '|' + this.off + '|' + this.headUsed + '|' + [...this.left].sort().join(''); }

  /** сколько костей ещё можно сыграть из этой позиции */
  private depth(): number {
    if (!this.left.length || this.winner() >= 0) return 0;
    const k = this.key();
    const hit = this.memo.get(k);
    if (hit !== undefined) return hit;
    let best = 0;
    for (const m of this.raw()) {
      const snap = this.save();
      this.apply(m);
      best = Math.max(best, 1 + this.depth());
      this.load(snap);
      if (best === this.left.length) break;
    }
    this.memo.set(k, best);
    return best;
  }

  /** допустимые ходы: только те, что ведут к максимальному использованию костей (и бóльшей кости, если играется одна) */
  legal(): Move[] {
    if (!this.left.length || this.winner() >= 0) return [];
    const all = this.raw();
    const max = this.depth();
    if (!max) return [];
    let ok = all.filter(m => { const s = this.save(); this.apply(m); const d = 1 + this.depth(); this.load(s); return d === max; });
    if (max === 1 && this.left.length === 2 && this.left[0] !== this.left[1]) {
      const big = Math.max(...this.left);
      if (ok.some(m => m.die === big)) ok = ok.filter(m => m.die === big);
    }
    return ok;
  }

  /** сделать ход (проверка — по legal) */
  move(from: number, die: number): Move | null {
    const m = this.legal().find(x => x.from === from && x.die === die);
    if (!m) return null;
    this.history.push({ m, snap: this.save() });
    this.apply(m);
    return m;
  }

  undo(): Move | null {
    const h = this.history.pop();
    if (!h) return null;
    this.load(h.snap);
    return h.m;
  }

  /** ход кончился: кости сыграны или ходить нечем */
  done() { return !this.left.length || this.winner() >= 0 || this.legal().length === 0; }

  /** передать ход сопернику */
  pass() {
    if (this.dice.length) this.fresh[this.turn] = false;
    this.turn = (1 - this.turn) as Side;
    this.dice = []; this.left = []; this.headUsed = 0; this.history = [];
    this.memo.clear();
  }

  private apply(m: Move) {
    const p = this.turn, q = (1 - p) as Side, v = this.variant;
    const sign = p === 0 ? 1 : -1;
    if (m.from === -1) this.bar[p]--;
    else {
      this.board[pointOf(v, p, m.from)] -= sign;
      if (v === 'long' && m.from === 0) this.headUsed++;
    }
    if (m.to >= 24) this.off[p]++;
    else {
      const pt = pointOf(v, p, m.to);
      if (v === 'short' && this.foe(p, m.to) === 1) { this.board[pt] = 0; this.bar[q]++; }
      this.board[pt] += sign;
    }
    const i = this.left.indexOf(m.die);
    this.left.splice(i, 1);
  }

  save() { return JSON.stringify([this.board, this.bar, this.off, this.left, this.headUsed]); }
  load(s: string) {
    const [b, bar, off, left, h] = JSON.parse(s);
    this.board = b; this.bar = bar; this.off = off; this.left = left; this.headUsed = h;
  }

  /** все различные итоговые позиции хода (для бота): последовательность ходов → позиция */
  turns(limit = 4000): Move[][] {
    const out: Move[][] = [];
    const seen = new Set<string>();
    const walk = (path: Move[]) => {
      if (out.length >= limit) return;
      const opts = this.legal();
      if (!opts.length) {
        const k = this.board.join(',') + '|' + this.bar + '|' + this.off;
        if (!seen.has(k)) { seen.add(k); out.push([...path]); }
        return;
      }
      for (const m of opts) {
        const s = this.save();
        this.apply(m);
        path.push(m);
        walk(path);
        path.pop();
        this.load(s);
      }
    };
    walk([]);
    return out;
  }

  state(): NardyState {
    return { variant: this.variant, board: [...this.board], bar: [...this.bar] as [number, number], off: [...this.off] as [number, number], turn: this.turn, dice: [...this.dice], left: [...this.left], headUsed: this.headUsed, fresh: [...this.fresh] as [boolean, boolean] };
  }
}
