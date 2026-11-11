// Партия на экране: игроки, кости, выбор фишки и хода (касанием или перетаскиванием), отмена, итог.

import type { MatchView } from '../../shared/Match';
import { RESULT_NAME, MULT } from '../../shared/Match';
import { Nardy, pointOf, stepOf, VARIANT_NAME } from '../../shared/Nardy';
import type { Move } from '../../shared/Nardy';
import type { ClientMsg, Profile } from '../../shared/Catalog';
import { BOT_LEVELS, BOT_PRIZE } from '../../shared/Catalog';
import type { Renderer } from '../view';
import type { Spot } from '../layout';
import type { Audio } from '../audio';
import { Telegram } from '../telegram';
import { Identity } from '../identity';
import { diceIcon } from '../art';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const I = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  exit: I('<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 16l4-4-4-4M18 12H8"/>'),
  undo: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  dice: I('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
};

export interface GameHandlers {
  send(m: ClientMsg): void;
  audio: Audio;
  toast(t: string, ok?: boolean): void;
  home(): void;
}

/** путь одной фишки к цели: несколько ходов подряд (сумма костей) */
type Path = { from: number; die: number }[];

export class Game {
  readonly el = h('div', 'ng');
  private v: MatchView | null = null;
  profile: Profile | null = null;
  private sel: Spot | null = null;
  private targets = new Map<Spot, Path>();
  private movable: Spot[] = [];
  private lastEv = -1;
  private sentAt = 0;
  private overShown = -1;
  private oppName = '';
  private dragFrom: Spot | null = null;
  private down: { x: number; y: number } | null = null;

  private opp = h('div', 'n-pl opp');
  private mine = h('div', 'n-pl mine');
  private exitBtn = h('button', 'n-exit', IC.exit);
  private msg = h('div', 'n-msg');
  private bar = h('div', 'n-bar');
  private diceEl = h('div', 'n-dice');
  private rollBtn = h('button', 'n-roll', `${IC.dice}<b>Бросить кости</b>`) as HTMLButtonElement;
  private undoBtn = h('button', 'n-undo', `${IC.undo}<span>Отменить</span>`) as HTMLButtonElement;
  private hint = h('div', 'n-hint');
  private over = h('div', 'g-over');
  private banner = h('div', 'n-banner');

  constructor(private r: Renderer, private H: GameHandlers) {
    document.body.appendChild(this.el);
    this.bar.append(this.diceEl, this.rollBtn, this.undoBtn);
    this.el.append(this.opp, this.mine, this.exitBtn, this.msg, this.hint, this.bar, this.banner, this.over);
    this.rollBtn.onclick = () => this.roll();
    this.undoBtn.onclick = () => { this.H.audio.press(); this.H.send({ t: 'UNDO' }); this.clearSel(); };
    this.exitBtn.onclick = () => this.exit();
    const stage = document.getElementById('stage')!;
    stage.addEventListener('pointerdown', e => this.onDown(e));
    addEventListener('pointerup', e => this.onUp(e));
    addEventListener('keydown', e => {
      if (!this.v || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); this.roll(); }
      if (e.code === 'Backspace' || e.code === 'KeyZ') { if (this.v.undo) this.H.send({ t: 'UNDO' }); this.clearSel(); }
      if (e.code === 'Escape') this.clearSel();
    });
    r.onSound((k, vol) => {
      if (k === 'dice') this.H.audio.clack(2.2 * vol);
      else if (k === 'hit') { this.H.audio.clack(3); this.H.audio.cushion(1.5); }
      else this.H.audio.clack(1.4);
    });
  }

  setProfile(p: Profile) { this.profile = p; }

  invite() {
    const v = this.v;
    if (!v) { this.H.toast('Сначала сядьте за стол', false); return; }
    const how = Telegram.share(Identity.inviteLink(v.id), `Сыграем в ${VARIANT_NAME[v.variant].toLowerCase()} в QWX NARDY? Код стола ${v.id}`);
    if (how === 'copied') this.H.toast('Ссылка скопирована', true);
  }

  /** ушли в лобби */
  home() {
    this.v = null;
    this.el.classList.remove('on');
    this.over.classList.remove('open');
    this.clearSel();
    this.lastEv = -1;
    this.overShown = -1;
    this.r.setDice([], [], 0, 'ivory', false);
  }

  private get side() { return this.v && this.v.me >= 0 ? this.v.me : 0; }
  private get myTurn() { const v = this.v; return !!v && v.me >= 0 && v.state.turn === v.me && (v.phase === 'ROLL' || v.phase === 'MOVE'); }

  // ───────────────────────── состояние ─────────────────────────

  apply(v: MatchView) {
    const first = !this.v || this.v.id !== v.id;
    this.v = v;
    this.el.classList.add('on');
    const opp = v.seats[1 - Math.max(0, v.me)];
    if (opp) this.oppName = opp.name;
    this.r.setSide(this.side);
    const fresh = v.ev && v.ev.seq !== this.lastEv;
    this.r.setPosition({ board: v.state.board, bar: v.state.bar, off: v.state.off, variant: v.variant }, first);
    const thrower = v.seats[v.state.turn];
    this.r.setDice(v.state.dice, v.state.left, v.state.turn, thrower?.dice || 'ivory', !!fresh && v.ev!.kind === 'roll');
    if (fresh) {
      const ev = v.ev!;
      this.lastEv = ev.seq;
      if (!first) this.onEvent(ev.kind, v);
      else if (ev.kind === 'rolloff' && v.rolloff) this.showRolloff(v);
    }
    this.renderPlates(v);
    this.renderBar(v);
    this.updateMoves();
    if (v.phase === 'OVER' && this.overShown !== v.games) { this.overShown = v.games; setTimeout(() => this.showOver(), 900); }
    if (v.phase !== 'OVER') this.over.classList.remove('open');
  }

  private onEvent(kind: string, v: MatchView) {
    if (kind === 'roll') { this.H.audio.chips(2); if (v.state.turn === v.me) Telegram.haptic('turn'); }
    if (kind === 'rolloff') this.showRolloff(v);
    if (kind === 'pass' && v.state.turn === v.me) { this.H.audio.myTurn(); Telegram.haptic('turn'); }
    if (kind === 'over') { const won = v.winner === v.me; this.H.audio.matchEnd(won); Telegram.haptic(won ? 'win' : 'error'); }
  }

  private showRolloff(v: MatchView) {
    const r = v.rolloff;
    if (!r) return;
    const set = (i: number) => v.seats[i]?.dice || 'ivory';
    const me = Math.max(0, v.me), op = 1 - me;
    this.banner.innerHTML = `<small>кто ходит первым</small>
      <div class="nb-row"><div><img src="${diceIcon(set(me), r[me])}"><span>${esc(v.seats[me]?.name || '')}</span></div><em>×</em><div><img src="${diceIcon(set(op), r[op])}"><span>${esc(v.seats[op]?.name || '')}</span></div></div>
      <b>${r[me] > r[op] ? 'Вы ходите первым' : `Первым ходит ${esc(v.seats[op]?.name || '')}`}</b>`;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.H.audio.chips(2);
    setTimeout(() => this.banner.classList.remove('show'), 2600);
  }

  private renderPlates(v: MatchView) {
    const me = Math.max(0, v.me);
    const plate = (el: HTMLElement, i: number) => {
      const s = v.seats[i];
      const turn = v.state.turn === i && (v.phase === 'ROLL' || v.phase === 'MOVE');
      el.classList.toggle('turn', turn);
      el.classList.toggle('off', !!s && !s.online);
      el.classList.toggle('w', i === 0);
      if (!s) { el.innerHTML = `<i class="chk ${i === 0 ? 'w' : 'b'}"></i><div><b>Ждём соперника…</b><small>${v.vsBot ? '' : 'позовите друга по ссылке'}</small></div>`; return; }
      const lvl = s.bot && v.botLevel !== undefined ? BOT_LEVELS.find(b => b.level === v.botLevel)?.name : '';
      el.innerHTML = `<i class="chk ${i === 0 ? 'w' : 'b'}"></i>
        <div><b>${esc(s.name)}${s.bot ? ` <em>бот${lvl ? ' · ' + esc(lvl) : ''}</em>` : ''}</b>
        <small><span>пипсы ${s.pips}</span><span>снято ${s.off}/15</span>${s.bar ? `<span class="hit">на баре ${s.bar}</span>` : ''}${!s.online ? '<span>нет связи</span>' : ''}</small></div>
        <svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16"/></svg>`;
    };
    plate(this.mine, me);
    plate(this.opp, 1 - me);
    const stakeTxt = v.vsBot ? (v.botLevel !== undefined ? `приз ${fmt(BOT_PRIZE[BOT_LEVELS.findIndex(b => b.level === v.botLevel)] || 0)}` : '') : v.stake ? `банк ${fmt(v.pot || v.stake * 2)}` : 'без ставки';
    this.msg.innerHTML = `<b>${esc(VARIANT_NAME[v.variant])}</b><span>${esc(v.text || '')}</span><em>${stakeTxt}</em>`;
  }

  private renderBar(v: MatchView) {
    const mine = this.myTurn;
    const st = v.state;
    const set = v.seats[st.turn]?.dice || 'ivory';
    // кости: при дубле — четыре
    const vals = st.dice.length ? (st.dice[0] === st.dice[1] ? [st.dice[0], st.dice[0], st.dice[0], st.dice[0]] : st.dice) : [];
    const left = [...st.left];
    this.diceEl.innerHTML = vals.map(d => { const i = left.indexOf(d); const used = i < 0; if (!used) left.splice(i, 1); return `<img class="${used ? 'used' : ''}" src="${diceIcon(set, d)}">`; }).join('');
    this.rollBtn.classList.toggle('on', mine && v.phase === 'ROLL');
    this.undoBtn.classList.toggle('on', mine && v.undo);
    this.bar.classList.toggle('mine', mine);
    let hint = '';
    if (v.phase === 'WAIT') hint = 'Ждём второго игрока…';
    else if (v.phase === 'OVER') hint = '';
    else if (!mine) hint = v.me < 0 ? '' : `Ходит ${esc(this.oppName)}…`;
    else if (v.phase === 'ROLL') hint = 'Ваш ход — бросайте кости';
    else hint = this.sel !== null ? 'Куда пойти? Подсвечено зелёным' : 'Выберите фишку';
    this.hint.textContent = hint;
    this.hint.classList.toggle('on', !!hint);
  }

  // ───────────────────────── выбор хода ─────────────────────────

  private engine(): Nardy | null {
    const v = this.v;
    if (!v || !this.myTurn || v.phase !== 'MOVE') return null;
    return Nardy.from(v.state);
  }

  /** пункт доски ↔ шаг игрока */
  private toSpot(step: number): Spot { const v = this.v!; return step < 0 ? -1 : step >= 24 ? 24 : pointOf(v.variant, v.me as 0 | 1, step); }
  private toStep(spot: Spot): number { const v = this.v!; return spot === -1 ? -1 : spot === 24 ? 24 : stepOf(v.variant, v.me as 0 | 1, spot); }

  private updateMoves() {
    const n = this.engine();
    if (!n) { this.movable = []; this.sel = null; this.targets.clear(); this.push(); return; }
    const legal = n.legal();
    this.movable = [...new Set(legal.map(m => this.toSpot(m.from)))];
    if (this.sel !== null && !this.movable.includes(this.sel)) this.sel = null;
    if (this.sel === null && this.movable.length === 1) this.sel = this.movable[0];
    this.computeTargets(n);
    this.push();
  }

  /** все места, куда выбранная фишка дойдёт одной или несколькими костями */
  private computeTargets(n: Nardy) {
    this.targets.clear();
    if (this.sel === null) return;
    const start = this.toStep(this.sel);
    const walk = (from: number, path: Path) => {
      const snap = n.save();
      for (const m of n.legal().filter((x: Move) => x.from === from)) {
        const done = n.move(m.from, m.die);
        if (!done) continue;
        const p = [...path, { from: m.from, die: m.die }];
        const spot = this.toSpot(m.to);
        const prev = this.targets.get(spot);
        if (!prev || prev.length > p.length) this.targets.set(spot, p);
        if (m.to < 24 && !m.hit) walk(m.to, p);
        n.load(snap);
        n.history = [];
      }
    };
    walk(start, []);
  }

  private push() {
    this.r.highlight({ from: this.movable, sel: this.sel, to: [...this.targets.keys()] });
    if (this.v) this.renderBar(this.v);
  }

  private clearSel() { this.sel = null; this.targets.clear(); this.push(); }

  private onDown(e: PointerEvent) {
    if (!this.v || this.over.classList.contains('open')) return;
    if (this.myTurn && this.v.phase === 'ROLL') { this.roll(); return; }
    const spot = this.r.pick(e.clientX, e.clientY);
    this.down = { x: e.clientX, y: e.clientY };
    if (spot === null) { this.clearSel(); return; }
    if (this.sel !== null && this.targets.has(spot)) { this.go(spot); return; }
    if (this.movable.includes(spot)) {
      this.sel = spot;
      this.dragFrom = spot;
      const n = this.engine();
      if (n) this.computeTargets(n);
      this.H.audio.press();
      Telegram.haptic('select');
      this.push();
      return;
    }
    if (this.sel !== null) this.clearSel();
  }

  private onUp(e: PointerEvent) {
    const from = this.dragFrom;
    this.dragFrom = null;
    if (from === null || !this.down) return;
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 12) return;
    const spot = this.r.pick(e.clientX, e.clientY);
    if (spot !== null && spot !== from && this.targets.has(spot)) this.go(spot);
  }

  private go(spot: Spot) {
    const path = this.targets.get(spot);
    if (!path) return;
    for (const m of path) this.H.send({ t: 'MOVE', from: m.from, die: m.die });
    this.sentAt = performance.now();
    Telegram.haptic('tap');
    this.sel = null;
    this.targets.clear();
    this.push();
  }

  private roll() {
    if (!this.myTurn || this.v!.phase !== 'ROLL') return;
    if (performance.now() - this.sentAt < 400) return;
    this.sentAt = performance.now();
    this.rollBtn.classList.remove('on');
    this.H.send({ t: 'ROLL' });
    Telegram.haptic('bet');
  }

  // ───────────────────────── итог ─────────────────────────

  private showOver() {
    const v = this.v;
    if (!v || v.phase !== 'OVER') return;
    const won = v.winner === v.me;
    const res = v.result || 'oin';
    const opp = v.seats[1 - Math.max(0, v.me)];
    const mult = MULT[res];
    const money = v.vsBot
      ? (won && v.botLevel !== undefined ? `+${fmt(BOT_PRIZE[BOT_LEVELS.findIndex(b => b.level === v.botLevel)] || 0)} фишек за победу` : 'Без ставки')
      : v.stake ? (won ? `+${fmt(v.stake * mult)} фишек` : `−${fmt(v.stake * mult)} фишек`) : 'Без ставки';
    const asked = !!opp && v.rematch.includes(opp.id);
    this.over.innerHTML = `<div class="go-card ${won ? 'win' : ''}">
      <small>${esc(VARIANT_NAME[v.variant])}</small>
      <h2>${won ? (res === 'oin' ? 'Победа!' : RESULT_NAME[res]) : res === 'oin' ? 'Поражение' : `${RESULT_NAME[res].replace('!', '')} вам`}</h2>
      ${res !== 'oin' ? `<div class="go-note">${res === 'mars' ? 'Соперник не снял ни одной фишки' : 'Фишка осталась в доме победителя или на баре'} — ставка ×${mult}</div>` : ''}
      <div class="go-score"><span>${esc(v.seats[Math.max(0, v.me)]?.name || 'Вы')}</span><b>${v.seats[Math.max(0, v.me)]?.off ?? 0}<i>:</i>${opp?.off ?? 0}</b><span>${esc(opp?.name || this.oppName)}</span></div>
      <div class="go-money">${money}</div>
      ${asked ? '<div class="go-note">Соперник хочет реванш</div>' : ''}
      <button class="lobby-btn gold big n-re">${v.rematch.includes(v.seats[Math.max(0, v.me)]?.id || '-') ? 'Ждём соперника…' : 'Реванш'}</button>
      <button class="lobby-btn big n-lb">В лобби</button></div>`;
    (this.over.querySelector('.n-re') as HTMLButtonElement).onclick = () => { this.H.audio.press(); this.H.send({ t: 'REMATCH' }); };
    (this.over.querySelector('.n-lb') as HTMLButtonElement).onclick = () => { this.H.audio.press(); this.H.home(); };
    this.over.classList.add('open');
  }

  private exit() {
    this.H.audio.press();
    const v = this.v;
    if (v && (v.phase === 'ROLL' || v.phase === 'MOVE') && v.me >= 0 && !v.vsBot) {
      if (!this.exitBtn.classList.contains('confirm')) {
        this.exitBtn.classList.add('confirm');
        this.H.toast('Выйти посреди партии — это поражение. Нажмите ещё раз', false);
        setTimeout(() => this.exitBtn.classList.remove('confirm'), 3500);
        return;
      }
    }
    this.H.home();
  }
}
