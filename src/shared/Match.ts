// Партия в нарды на двоих: розыгрыш первого хода, броски, ходы, отмена, таймер, бот, реванш.
// Работает и на сервере, и в офлайн-режиме в браузере.

import { Nardy, VARIANT_NAME, pointOf } from './Nardy';
import type { Variant, Side, Move, Result, NardyState } from './Nardy';
import { planTurn } from './Bot';

export interface SeatView { id: string; name: string; bot: boolean; online: boolean; dice: string; username?: string; pips: number; off: number; bar: number }

/** одно событие на доске — клиент его анимирует */
export interface BoardEvent {
  seq: number;
  kind: 'move' | 'undo' | 'roll' | 'rolloff' | 'pass' | 'start' | 'over';
  by: Side;
  /** пункты доски: −1 — бар, 24 — снята */
  from?: number; to?: number; hit?: boolean;
  dice?: number[];
}

export interface MatchView {
  id: string;
  stake: number;
  open: boolean;
  variant: Variant;
  phase: 'WAIT' | 'ROLL' | 'MOVE' | 'OVER';
  seats: (SeatView | null)[];
  /** мой номер места: 0 — белые, 1 — чёрные, −1 — зритель */
  me: number;
  state: NardyState;
  /** можно ли отменить ход в этом броске */
  undo: boolean;
  deadline: number;
  turnMs: number;
  now: number;
  ev: BoardEvent | null;
  /** розыгрыш первого хода: кость каждого */
  rolloff: number[] | null;
  text: string;
  winner: number;
  result: Result | null;
  pot: number;
  rematch: string[];
  vsBot: boolean;
  botLevel?: number;
  games: number;
}

export type MatchMsg = { t: 'STATE'; view: MatchView };

export interface MatchOptions {
  id: string;
  stake: number;
  variant: Variant;
  open?: boolean;
  turnMs?: number;
  onStart?: (ids: string[]) => boolean;
  onEnd?: (r: { winner: string | null; loser: string | null; ids: string[]; stake: number; pot: number; result: Result; mult: number; vsBot: boolean; botLevel?: number; resign?: boolean; variant: Variant }) => void;
  rnd?: () => number;
  /** скорость бота и пауз (для тестов) */
  fast?: boolean;
}

interface Seat { id: string; name: string; bot: boolean; level: number; dice: string; online: boolean; username?: string; timeouts: number }

const TURN_MS = 45_000;
export const MULT: Record<Result, number> = { oin: 1, mars: 2, koks: 3 };
export const RESULT_NAME: Record<Result, string> = { oin: 'Победа', mars: 'Марс!', koks: 'Кокс!' };

export class Match {
  readonly game: Nardy;
  seats: (Seat | null)[] = [null, null];
  phase: MatchView['phase'] = 'WAIT';
  deadline = 0;
  private subs = new Map<string, (m: MatchMsg) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private passTimer: ReturnType<typeof setTimeout> | null = null;
  private rematchIds = new Set<string>();
  private ev: BoardEvent | null = null;
  private seq = 0;
  private rolloff: number[] | null = null;
  private text = '';
  private result: Result | null = null;
  private dead = false;
  pot = 0;
  games = 0;
  readonly o: MatchOptions;

  constructor(o: MatchOptions) { this.o = o; this.game = new Nardy(o.variant); }

  get id() { return this.o.id; }
  get stake() { return this.o.stake; }
  get variant() { return this.o.variant; }
  get humans() { return this.seats.filter(s => s && !s.bot).length; }
  get vsBot() { return this.seats.some(s => s?.bot); }
  seatOf(id: string) { return this.seats.findIndex(s => s?.id === id); }
  has(id: string) { return this.seatOf(id) >= 0; }
  get full() { return !!this.seats[0] && !!this.seats[1]; }
  private rnd() { return (this.o.rnd || Math.random)(); }
  private die() { return 1 + Math.floor(this.rnd() * 6); }
  private ms(n: number) { return this.o.fast ? Math.round(n / 20) : n; }

  join(id: string, name: string, dice = 'ivory', username?: string): number {
    const have = this.seatOf(id);
    if (have >= 0) { this.seats[have]!.online = true; this.broadcast(); return have; }
    const free = this.seats.findIndex(s => !s);
    if (free < 0) return -1;
    this.seats[free] = { id, name, bot: false, level: 0, dice, online: true, username, timeouts: 0 };
    this.broadcast();
    if (this.full && this.phase === 'WAIT') this.begin();
    return free;
  }

  addBot(name: string, level: number, dice = 'ebony') {
    const free = this.seats.findIndex(s => !s);
    if (free < 0) return false;
    this.seats[free] = { id: 'bot:' + name, name, bot: true, level, dice, online: true, timeouts: 0 };
    this.broadcast();
    if (this.full && this.phase === 'WAIT') this.begin();
    return true;
  }

  setOnline(id: string, on: boolean) {
    const i = this.seatOf(id);
    if (i < 0) return;
    this.seats[i]!.online = on;
    this.broadcast();
  }
  setDice(id: string, dice: string) {
    const i = this.seatOf(id);
    if (i >= 0) { this.seats[i]!.dice = dice; this.broadcast(); }
  }

  /** оба сели: взносы, розыгрыш первого хода (каждый бросает одну кость) */
  private begin() {
    const ids = this.seats.filter(s => s && !s.bot).map(s => s!.id);
    if (this.o.onStart && !this.o.onStart(ids)) { this.phase = 'WAIT'; this.broadcast(); return; }
    this.pot = this.vsBot ? 0 : this.stake * 2;
    let a = this.die(), b = this.die();
    while (a === b) { a = this.die(); b = this.die(); }
    const first: Side = a > b ? 0 : 1;
    this.rolloff = [a, b];
    this.game.reset(this.variant, first);
    this.games++;
    this.result = null;
    this.rematchIds.clear();
    for (const s of this.seats) if (s) s.timeouts = 0;
    this.text = `${this.seats[0]!.name}: ${a}, ${this.seats[1]!.name}: ${b} — первым ходит ${this.seats[first]!.name}`;
    this.event({ kind: 'rolloff', by: first, dice: [a, b] });
    this.phase = 'ROLL';
    this.deadline = 0;
    this.broadcast();
    // пауза, чтобы все увидели розыгрыш
    this.after(this.ms(2600), () => this.startTurn());
  }

  private after(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; if (!this.dead) fn(); }, ms);
  }

  private event(e: Omit<BoardEvent, 'seq'>) { this.ev = { seq: ++this.seq, ...e }; }

  private startTurn() {
    this.phase = 'ROLL';
    this.rolloff = null;
    this.deadline = Date.now() + (this.o.turnMs || TURN_MS);
    this.after(this.deadline - Date.now(), () => this.onTimeout());
    this.broadcast();
    const s = this.seats[this.game.turn];
    if (s?.bot) this.botTimer = setTimeout(() => this.roll(s.id), this.ms(700 + this.rnd() * 600));
  }

  private onTimeout() {
    if (this.dead || (this.phase !== 'ROLL' && this.phase !== 'MOVE')) return;
    const me = this.game.turn;
    const s = this.seats[me]!;
    s.timeouts++;
    if (s.timeouts >= 3 && !s.bot) { this.finish((1 - me) as Side, true, `${s.name} не ходит — техническое поражение`); return; }
    // время вышло — ход за игрока (простой бот)
    if (this.phase === 'ROLL') this.doRoll();
    const plan = planTurn(this.game, 0.4, () => this.rnd());
    for (const m of plan) this.applyMove(m.from, m.die, false);
    this.text = `${s.name}: время вышло — ход сделан автоматически`;
    this.endTurn();
  }

  private doRoll() {
    const a = this.die(), b = this.die();
    this.game.roll(a, b);
    this.event({ kind: 'roll', by: this.game.turn, dice: [a, b] });
    this.phase = 'MOVE';
  }

  roll(id: string): boolean {
    const i = this.seatOf(id);
    if (i !== this.game.turn || this.phase !== 'ROLL' || this.dead) return false;
    this.doRoll();
    const s = this.seats[i]!;
    if (!s.bot) s.timeouts = 0;
    this.text = `${s.name}: ${this.game.dice.join(' и ')}`;
    if (this.game.done()) {
      this.text += ' — ходить нечем';
      this.broadcast();
      this.passTimer = setTimeout(() => this.endTurn(), this.ms(1800));
      return true;
    }
    this.broadcast();
    if (s.bot) this.botPlay(s);
    return true;
  }

  private applyMove(from: number, die: number, broadcast = true): Move | null {
    const p = this.game.turn;
    const m = this.game.move(from, die);
    if (!m) return null;
    const v = this.variant;
    this.event({ kind: 'move', by: p, from: from < 0 ? -1 : pointOf(v, p, from), to: m.to >= 24 ? 24 : pointOf(v, p, m.to), hit: m.hit, dice: [die] });
    if (broadcast) this.broadcast();
    return m;
  }

  /** ход одной фишкой: from — шаг игрока (−1 — с бара), die — какая кость */
  move(id: string, from: number, die: number): boolean {
    const i = this.seatOf(id);
    if (i !== this.game.turn || this.phase !== 'MOVE') return false;
    if (!this.applyMove(Math.trunc(from), Math.trunc(die))) return false;
    if (this.game.winner() >= 0) { this.win(); return true; }
    if (this.game.done()) this.passTimer = setTimeout(() => { if (this.phase === 'MOVE') this.endTurn(); }, this.ms(700));
    return true;
  }

  undo(id: string): boolean {
    const i = this.seatOf(id);
    if (i !== this.game.turn || this.phase !== 'MOVE') return false;
    if (this.passTimer) { clearTimeout(this.passTimer); this.passTimer = null; }
    const p = this.game.turn;
    const m = this.game.undo();
    if (!m) return false;
    const v = this.variant;
    this.event({ kind: 'undo', by: p, from: m.to >= 24 ? 24 : pointOf(v, p, m.to), to: m.from < 0 ? -1 : pointOf(v, p, m.from), hit: m.hit });
    this.broadcast();
    return true;
  }

  private endTurn() {
    if (this.passTimer) { clearTimeout(this.passTimer); this.passTimer = null; }
    if (this.dead || this.phase === 'OVER') return;
    if (this.game.winner() >= 0) { this.win(); return; }
    this.game.pass();
    this.event({ kind: 'pass', by: this.game.turn });
    this.startTurn();
  }

  private win() {
    const w = this.game.winner() as Side;
    const r = this.game.result();
    this.result = r;
    this.finish(w, false, `${this.seats[w]!.name}: ${RESULT_NAME[r].toLowerCase().replace('!', '')}${r !== 'oin' ? ` — ×${MULT[r]}` : ''}`);
  }

  private finish(winner: Side, resign: boolean, text: string) {
    if (this.timer) clearTimeout(this.timer);
    if (this.passTimer) clearTimeout(this.passTimer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.phase = 'OVER';
    this.text = text;
    this.result ??= 'oin';
    this.event({ kind: 'over', by: winner });
    const ws = this.seats[winner], ls = this.seats[1 - winner];
    const ids = this.seats.filter(s => s && !s.bot).map(s => s!.id);
    this.o.onEnd?.({
      winner: ws && !ws.bot ? ws.id : null, loser: ls && !ls.bot ? ls.id : null, ids, stake: this.vsBot ? 0 : this.stake, pot: this.pot,
      result: this.result, mult: resign ? 1 : MULT[this.result], vsBot: this.vsBot, botLevel: this.seats.find(s => s?.bot)?.level, resign, variant: this.variant,
    });
    this.winnerSide = winner;
    this.pot = 0;
    this.broadcast();
  }
  private winnerSide = -1;

  leave(id: string) {
    const i = this.seatOf(id);
    if (i < 0) return;
    if (this.phase === 'ROLL' || this.phase === 'MOVE') {
      if (this.seats[1 - i]) this.finish((1 - i) as Side, true, `${this.seats[i]!.name} сдался`);
    }
    this.seats[i] = null;
    this.subs.delete(id);
    this.rematchIds.delete(id);
    if (this.humans === 0) { this.destroy(); return; }
    if (this.phase !== 'OVER') this.phase = 'WAIT';
    for (let k = 0; k < 2; k++) if (this.seats[k]?.bot) this.seats[k] = null;
    this.broadcast();
  }

  rematch(id: string) {
    if (this.phase !== 'OVER' || !this.has(id)) return;
    this.rematchIds.add(id);
    const need = this.seats.filter(s => s && !s.bot).length;
    if (this.rematchIds.size >= need && this.full) { this.winnerSide = -1; this.begin(); }
    else this.broadcast();
  }

  subscribe(id: string, cb: (m: MatchMsg) => void) {
    this.subs.set(id, cb);
    cb({ t: 'STATE', view: this.view(id) });
    return () => { if (this.subs.get(id) === cb) this.subs.delete(id); };
  }

  broadcast() { if (this.dead) return; for (const [id, cb] of this.subs) cb({ t: 'STATE', view: this.view(id) }); }

  view(id: string): MatchView {
    const g = this.game;
    return {
      id: this.id, stake: this.stake, open: !!this.o.open, variant: this.variant, phase: this.phase,
      seats: this.seats.map((s, k) => s ? { id: s.id, name: s.name, bot: s.bot, online: s.online, dice: s.dice, username: s.username, pips: g.pips(k as Side), off: g.off[k], bar: g.bar[k] } : null),
      me: this.seatOf(id), state: g.state(), undo: this.phase === 'MOVE' && g.history.length > 0,
      deadline: this.deadline, turnMs: this.o.turnMs || TURN_MS, now: Date.now(),
      ev: this.ev, rolloff: this.rolloff, text: this.text,
      winner: this.phase === 'OVER' ? this.winnerSide : -1, result: this.phase === 'OVER' ? this.result : null,
      pot: this.pot, rematch: [...this.rematchIds], vsBot: this.vsBot, botLevel: this.seats.find(s => s?.bot)?.level, games: this.games,
    };
  }

  // ───── бот ─────
  private botPlay(s: Seat) {
    const seat = this.seatOf(s.id);
    const plan = planTurn(this.game, s.level, () => this.rnd());
    let k = 0;
    const step = () => {
      if (this.dead || this.phase !== 'MOVE' || this.game.turn !== seat) return;
      if (k >= plan.length) { this.endTurn(); return; }
      const m = plan[k++];
      if (!this.applyMove(m.from, m.die)) { this.endTurn(); return; }
      if (this.game.winner() >= 0) { this.win(); return; }
      this.botTimer = setTimeout(step, this.ms(650 + this.rnd() * 350));
    };
    this.botTimer = setTimeout(step, this.ms(1300 + this.rnd() * 700));
  }

  destroy() {
    this.dead = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.passTimer) clearTimeout(this.passTimer);
    this.subs.clear();
  }
}

export { VARIANT_NAME };
