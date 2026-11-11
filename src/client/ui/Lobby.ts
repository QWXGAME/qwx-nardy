// Лобби клуба нард: ставка, длинные или короткие, быстрая игра (подбор соперника), стол для друга, бот.

import type { MatchView } from '../../shared/Match';
import type { Variant } from '../../shared/Nardy';
import { VARIANT_NAME } from '../../shared/Nardy';
import type { ClientMsg, Profile } from '../../shared/Catalog';
import { STAKES, BOT_LEVELS, BOT_PRIZE } from '../../shared/Catalog';
import { Telegram } from '../telegram';
import { Identity } from '../identity';
import type { HomeInfo } from '../net';
import { ICON } from './Menu';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** шарики-«масти» в шапке */
export const BALLS_ROW = '<i></i><i class="r"></i>';

export class Lobby {
  private el = h('div', 'lobby');
  private mode: 'home' | 'room' | 'queue' | 'none' = 'none';
  private stake = 0;
  private variant: Variant = 'long';
  private profile: Profile | null = null;
  private lastKey = '';
  private queueSince = 0;
  private queueTimer = 0;

  constructor(private send: (m: ClientMsg) => void, private tap: () => void, private online: () => boolean, private toast: (t: string, ok?: boolean) => void) {
    document.body.appendChild(this.el);
    try { this.stake = Number(localStorage.getItem('qn.stake') || 0) || 0; this.variant = localStorage.getItem('qn.variant') === 'short' ? 'short' : 'long'; } catch { /* */ }
    if (!STAKES.includes(this.stake)) this.stake = 0;
  }

  setProfile(p: Profile) {
    this.profile = p;
    if (this.mode === 'home') this.renderHome();
  }

  signedIn = false;
  onOpen?: (k: 'wheel' | 'tables' | 'ref' | 'season' | 'top' | 'shop') => void;
  onVisible?: (v: boolean) => void;
  onSignOut?: () => void;
  private onlineCount = 0;
  private liveEl: HTMLElement | null = null;
  setOnline(n: number) {
    this.onlineCount = n;
    const s = this.liveEl?.querySelector('span');
    if (s && this.online()) s.innerHTML = `Сейчас в клубе: <b>${fmt(n)}</b>`;
  }
  get isHome() { return this.mode === 'home'; }
  private homeInfo: HomeInfo = {};

  showHome(hi: HomeInfo = {}) {
    this.mode = 'home';
    this.lastKey = '';
    this.homeInfo = hi;
    this.el.innerHTML = '';
    this.renderHome();
  }

  /** поиск соперника: stake — ищем, null — закончили */
  queue(stake: number | null, since?: number) {
    clearInterval(this.queueTimer);
    if (stake === null) { if (this.mode === 'queue') this.showHome(this.homeInfo); return; }
    this.mode = 'queue';
    this.queueSince = since || Date.now();
    this.renderQueue(stake);
  }

  /** состояние стола: ждём соперника — экран ожидания, партия идёт — лобби прячется */
  update(v: MatchView) {
    if (v.phase !== 'WAIT') {
      if (this.mode !== 'none') { this.mode = 'none'; this.el.classList.remove('open'); this.onVisible?.(false); }
      return;
    }
    this.mode = 'room';
    const key = JSON.stringify([v.id, v.seats, v.stake]);
    if (key !== this.lastKey) { this.lastKey = key; this.renderRoom(v); }
  }

  get visible() { return this.mode !== 'none'; }

  private renderHome() {
    const p = this.profile;
    const again = !!this.el.querySelector('.lobby-card.home');
    this.el.innerHTML = '';
    const card = h('div', 'lobby-card home' + (again ? ' static' : ''));
    const initial = (Identity.name || p?.name || 'Q').trim().charAt(0).toUpperCase();
    card.innerHTML = `
      <div class="lh-brand st">
        <div class="lh-dice"><i>⚄</i><i>⚂</i></div>
        <h1><span>Q</span><span>W</span><span>X</span><em>NARDY</em></h1>
        <p>длинные и короткие</p>
      </div>
      <div class="lh-profile st">
        <div class="lh-ava">${esc(initial)}</div>
        <div class="lh-who"><input class="lh-name" maxlength="20" placeholder="Ваше имя за столом" /><span>${p?.username ? '@' + esc(p.username) : 'игрок клуба'}</span></div>
        <div class="lh-bal"><i></i><b class="lh-num">${p ? fmt(p.balance) : '—'}</b></div>
      </div>`;
    const nameIn = card.querySelector('.lh-name') as HTMLInputElement;
    nameIn.value = Identity.name || (p && p.name !== 'Гость' && p.name !== 'Вы' ? p.name : '');
    const rename = () => { const n = nameIn.value.trim(); if (n && n !== Identity.name) { Identity.name = n; this.send({ t: 'RENAME', name: n }); } };
    nameIn.onchange = rename;

    const back = this.homeInfo.resume || this.homeInfo.invite;
    if (back) {
      const b = h('button', 'lh-cta st', `<b>${this.homeInfo.resume ? '↩ Вернуться за стол' : '● Стол друга — сыграть'}</b><small>код ${esc(back)}</small>`) as HTMLButtonElement;
      b.onclick = () => { this.tap(); this.send({ t: 'JOIN', room: back }); };
      card.append(b);
    }
    const live = h('button', 'lh-live st', `<i></i><span>${this.onlineCount ? `Сейчас в клубе: <b>${fmt(this.onlineCount)}</b>` : this.online() ? 'Клуб открыт' : 'Тренировка с ботом'}</span><small>столы →</small>`) as HTMLButtonElement;
    live.onclick = () => { this.tap(); this.onOpen?.('tables'); };
    this.liveEl = live;

    // вариант: длинные / короткие
    const vr = h('div', 'lh-variant st');
    (['long', 'short'] as Variant[]).forEach(k => {
      const b = h('button', k === this.variant ? 'on' : '', `<b>${k === 'long' ? 'Длинные' : 'Короткие'}</b><small>${k === 'long' ? 'без боя · голова' : 'бой · бар · кокс'}</small>`) as HTMLButtonElement;
      b.onclick = () => {
        if (this.variant === k) return;
        this.tap();
        this.variant = k;
        try { localStorage.setItem('qn.variant', k); } catch { /* */ }
        this.renderHome();
      };
      vr.append(b);
    });
    // ставка на партию
    const stakes = h('div', 'lh-blinds st');
    stakes.append(h('div', 'lh-label', 'Ставка на партию'));
    const row = h('div', 'lh-stakes');
    STAKES.forEach((v, i) => {
      const b = h('button', 'lh-stake s' + Math.min(4, i) + (v === this.stake ? ' on' : ''), v ? `<span>${fmt(v)}</span>` : '<span>Без ставки</span>') as HTMLButtonElement;
      b.onclick = () => {
        this.stake = v; this.tap();
        try { localStorage.setItem('qn.stake', String(v)); } catch { /* */ }
        row.querySelectorAll('.lh-stake').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      };
      row.appendChild(b);
    });
    stakes.append(row);

    const quick = h('button', 'lh-cta st', `<b>● Быстрая игра</b><small>соперник онлайн · победитель забирает банк</small>`) as HTMLButtonElement;
    quick.onclick = () => {
      this.tap(); rename();
      if (!this.online()) { this.toast('Нет связи с клубом — сыграйте с ботом', false); return; }
      this.send({ t: 'QUICK', stake: this.stake, variant: this.variant });
    };

    const friends = h('div', 'lh-friends st');
    const create = h('button', 'lh-tile', `<i>${ICON.invite}</i><b>Стол для друга</b><small>ссылка и код приглашения</small>`) as HTMLButtonElement;
    create.onclick = () => { this.tap(); rename(); this.send({ t: 'CREATE', stake: this.stake, variant: this.variant }); };
    const join = h('div', 'lh-join');
    const input = h('input') as HTMLInputElement;
    input.placeholder = 'КОД';
    input.maxLength = 6;
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    const go = h('button', 'lh-go', '→') as HTMLButtonElement;
    go.onclick = () => { if (input.value.trim()) { this.tap(); this.send({ t: 'JOIN', room: input.value.trim() }); } };
    input.onkeydown = e => { if (e.key === 'Enter') go.click(); };
    input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); join.classList.toggle('ready', input.value.length >= 4); };
    join.append(input, go);
    friends.append(create, join);

    // бот: 4 уровня
    const bots = h('div', 'lh-blinds st');
    bots.append(h('div', 'lh-label', 'Против бота · награда за победу'));
    const brow = h('div', 'lh-bots');
    BOT_LEVELS.forEach((b, i) => {
      const btn = h('button', 'lh-bot l' + i, `<b>${b.name}</b><small>+${fmt(BOT_PRIZE[i])}</small><em>${'●'.repeat(i + 1)}${'○'.repeat(3 - i)}</em>`) as HTMLButtonElement;
      btn.onclick = () => { this.tap(); rename(); this.send({ t: 'BOT', level: i, variant: this.variant }); };
      brow.append(btn);
    });
    bots.append(brow);

    const tiles = h('div', 'lh-tiles st');
    const tile = (icon: string, label: string, fn: () => void) => {
      const t = h('button', 'lh-mini', `<i>${icon}</i><span>${label}</span>`) as HTMLButtonElement;
      t.onclick = () => { this.tap(); fn(); };
      return t;
    };
    tiles.append(
      tile(ICON.shop, 'Магазин', () => this.onOpen?.('shop')),
      tile(ICON.wheel, 'Колесо', () => this.onOpen?.('wheel')),
      tile(ICON.ticket, 'Сезон', () => this.onOpen?.('season')),
      tile(ICON.top, 'Топ', () => this.onOpen?.('top')),
    );
    const note = h('div', 'lh-note st', this.online()
      ? (this.variant === 'long' ? 'Длинные: бить нельзя, на занятый пункт не встать, с головы — одна фишка за ход. Марс — ставка ×2.' : 'Короткие: одиночку бьют на бар, с бара — в первую очередь. Марс — ×2, кокс — ×3.')
      : 'Сервер клуба недоступен — играем с ботом.');
    card.append(live, vr, stakes, quick, friends, bots, tiles, note);
    if (p?.refillAt) live.after(h('div', 'qm-refill lh-refill st', ''));
    card.querySelectorAll('.st').forEach((el, i) => ((el as HTMLElement).style.animationDelay = `${0.08 + i * 0.06}s`));
    this.el.append(card);
    this.el.classList.add('open');
    this.onVisible?.(true);
    const num = card.querySelector('.lh-num') as HTMLElement;
    if (p) {
      const to = p.balance, from = this.shownBal ?? Math.max(0, to - Math.min(to, 2500));
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3);
        num.textContent = fmt(Math.round(from + (to - from) * e));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      this.shownBal = to;
    }
  }
  private shownBal: number | null = null;

  private renderQueue(stake: number) {
    this.el.innerHTML = '';
    const card = h('div', 'lobby-card queue');
    card.innerHTML = `
      <div class="q-spin"><i></i><i></i><i></i></div>
      <div class="lobby-label">Быстрая игра</div>
      <h2>Ищем соперника</h2><div class="q-var">${esc(VARIANT_NAME[this.variant])}</div>
      <div class="q-meta">${stake ? `Ставка <b>${fmt(stake)}</b> · банк <b>${fmt(stake * 2)}</b>` : 'Без ставки'} · <b class="q-time">0:00</b></div>`;
    const cancel = h('button', 'lobby-btn big', 'Отмена') as HTMLButtonElement;
    cancel.onclick = () => { this.tap(); this.send({ t: 'CANCEL' }); };
    const bot = h('button', 'lobby-link', 'Пока никого — сыграть с ботом') as HTMLButtonElement;
    bot.onclick = () => { this.tap(); this.send({ t: 'BOT', level: 1, variant: this.variant }); };
    card.append(cancel, bot);
    this.el.append(card);
    this.el.classList.add('open');
    this.onVisible?.(true);
    const t = card.querySelector('.q-time') as HTMLElement;
    this.queueTimer = window.setInterval(() => {
      const s = Math.floor((Date.now() - this.queueSince) / 1000);
      t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
  }

  private renderRoom(v: MatchView) {
    this.el.innerHTML = '';
    const card = h('div', 'lobby-card');
    const meSeat = v.seats[v.me];
    card.innerHTML = `
      <div class="lobby-head">
        <div><div class="lobby-label">Стол</div><h2>${esc(v.id)}</h2></div>
        <div class="lobby-count">${v.stake ? fmt(v.stake) : '—'}<i>${v.stake ? 'ставка' : 'без ставки'}</i></div>
      </div>
      <div class="lobby-seats">
        <div class="seat-row"><span class="dot"></span><b>${esc(meSeat?.name || 'Вы')}</b><em>вы</em></div>
        <div class="seat-row empty"><span class="dot"></span><b>Ждём друга…</b></div>
      </div>`;
    const inv = h('div', 'lobby-invite');
    const share = h('button', 'lobby-btn gold', 'Позвать друга') as HTMLButtonElement;
    share.onclick = () => {
      this.tap();
      const how = Telegram.share(Identity.inviteLink(v.id), `Сыграем в ${VARIANT_NAME[v.variant].toLowerCase()} в QWX NARDY${v.stake ? ` на ${fmt(v.stake)}` : ''}? Код стола ${v.id}`);
      if (how === 'copied') this.toast('Ссылка скопирована — отправь её другу');
    };
    const code = h('div', 'lobby-code', `Код стола <b>${esc(v.id)}</b> — друг вводит его в лобби или открывает ссылку`);
    inv.append(share, code);
    card.appendChild(inv);
    card.appendChild(h('div', 'lobby-note', 'Партия начнётся сама, как только друг сядет за стол. Кто ходит первым — решат кости.'));
    const leave = h('button', 'lobby-link', 'Закрыть стол') as HTMLButtonElement;
    leave.onclick = () => { this.tap(); this.send({ t: 'LEAVE' }); };
    card.appendChild(leave);
    this.el.append(card);
    this.el.classList.add('open');
    this.onVisible?.(true);
  }
}
