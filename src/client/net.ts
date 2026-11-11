// Подключение к игре. Онлайн — WebSocket к серверу клуба; офлайн — тот же движок прямо в браузере
// (партия с ботом: для превью и при обрыве связи).

import type { ClientMsg, Profile, ServerMsg, TransferRecord, OpenTable } from '../shared/Catalog';
import { WHEEL, WHEEL_COOLDOWN, REFILL, SEASON, UNLOCKS, levelOf, seasonId, BOT_LEVELS, BOT_PRIZE, CHECKER, DICE, SHOP_IDS, shopPrice, shopName } from '../shared/Catalog';
import type { MatchView } from '../shared/Match';
import type { Variant } from '../shared/Nardy';
import { Match } from '../shared/Match';
import { BOT_NAMES } from '../shared/Bot';
import { Identity } from './identity';

export type Status = 'connecting' | 'online' | 'offline';
export interface HomeInfo { resume?: string; invite?: string }
export interface WheelResult { ok: boolean; index?: number; prize?: number; wheelAt?: number; text?: string }
export interface TablesInfo { online: number; tables: OpenTable[] }
export type AdminReply = Omit<Extract<ServerMsg, { t: 'ADMIN' }>, 't'>;

export interface Conn {
  readonly online: boolean;
  send(m: ClientMsg): void;
  onState(cb: (v: MatchView) => void): void;
  onProfile(cb: (p: Profile) => void): void;
  onToast(cb: (text: string, ok?: boolean) => void): void;
  onStatus(cb: (s: Status) => void): void;
  onHome(cb: (h: HomeInfo) => void): void;
  onQueue(cb: (stake: number | null, since?: number) => void): void;
  onAuth(cb: () => void): void;
  onKicked(cb: () => void): void;
  onHistory(cb: (h: TransferRecord[]) => void): void;
  onTop(cb: (t: { name: string; profit: number }[]) => void): void;
  onWheel(cb: (w: WheelResult) => void): void;
  onTables(cb: (t: TablesInfo) => void): void;
  onAdmin(cb: (a: AdminReply) => void): void;
}

class Emitter {
  state: ((v: MatchView) => void)[] = [];
  profile: ((p: Profile) => void)[] = [];
  toast: ((t: string, ok?: boolean) => void)[] = [];
  status: ((s: Status) => void)[] = [];
  home: ((h: HomeInfo) => void)[] = [];
  queue: ((s: number | null, since?: number) => void)[] = [];
  auth: (() => void)[] = [];
  kicked: (() => void)[] = [];
  history: ((h: TransferRecord[]) => void)[] = [];
  top: ((t: { name: string; profit: number }[]) => void)[] = [];
  wheel: ((w: WheelResult) => void)[] = [];
  tables: ((t: TablesInfo) => void)[] = [];
  admin: ((a: AdminReply) => void)[] = [];
}

abstract class Base implements Conn {
  abstract readonly online: boolean;
  protected e = new Emitter();
  abstract send(m: ClientMsg): void;
  onState(cb: (v: MatchView) => void) { this.e.state.push(cb); }
  onProfile(cb: (p: Profile) => void) { this.e.profile.push(cb); }
  onToast(cb: (t: string, ok?: boolean) => void) { this.e.toast.push(cb); }
  onStatus(cb: (s: Status) => void) { this.e.status.push(cb); }
  onHome(cb: (h: HomeInfo) => void) { this.e.home.push(cb); }
  onQueue(cb: (s: number | null, since?: number) => void) { this.e.queue.push(cb); }
  onAuth(cb: () => void) { this.e.auth.push(cb); }
  onKicked(cb: () => void) { this.e.kicked.push(cb); }
  onHistory(cb: (h: TransferRecord[]) => void) { this.e.history.push(cb); }
  onTop(cb: (t: { name: string; profit: number }[]) => void) { this.e.top.push(cb); }
  onWheel(cb: (w: WheelResult) => void) { this.e.wheel.push(cb); }
  onTables(cb: (t: TablesInfo) => void) { this.e.tables.push(cb); }
  onAdmin(cb: (a: AdminReply) => void) { this.e.admin.push(cb); }
}

// ───────────────────────── онлайн ─────────────────────────

export class OnlineConn extends Base {
  readonly online = true;
  private ws: WebSocket | null = null;
  private retry = 0;
  private outbox: ClientMsg[] = [];
  private authFailed = false;
  private lastMsg = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private url: string, private failed?: () => void) {
    super();
    this.open();
    const now = () => { if (this.authFailed) return; const st = this.ws?.readyState; if (st === WebSocket.CLOSED || st === WebSocket.CLOSING || (st === WebSocket.OPEN && Date.now() - this.lastMsg > 25_000)) this.reopen(); };
    addEventListener('online', now);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) now(); });
    setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMsg > 25_000) { this.reopen(); return; }
      this.ws.send(JSON.stringify({ t: 'PING' }));
    }, 10_000);
  }

  private reopen() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const old = this.ws;
    if (old) { old.onclose = null; old.onmessage = null; try { old.close(); } catch { /* */ } }
    this.retry = 0;
    this.open();
  }

  private open() {
    this.timer = null;
    this.e.status.forEach(f => f('connecting'));
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.retry = 0;
      this.lastMsg = Date.now();
      this.e.status.forEach(f => f('online'));
      for (const m of this.outbox.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (ev) => {
      this.lastMsg = Date.now();
      const m = JSON.parse(ev.data) as ServerMsg;
      switch (m.t) {
        case 'PONG': return;
        case 'STATE': this.e.state.forEach(f => f(m.view)); break;
        case 'PROFILE': this.e.profile.forEach(f => f(m.profile)); break;
        case 'TOAST': this.e.toast.forEach(f => f(m.text, m.ok)); break;
        case 'ERROR': this.e.toast.forEach(f => f(m.text, false)); break;
        case 'HOME': this.e.home.forEach(f => f({ resume: m.resume, invite: m.invite })); break;
        case 'QUEUE': this.e.queue.forEach(f => f(m.stake, m.since)); break;
        case 'AUTH': this.authFailed = true; this.e.auth.forEach(f => f()); break;
        case 'KICKED': this.authFailed = true; this.e.kicked.forEach(f => f()); break;
        case 'HISTORY': this.e.history.forEach(f => f(m.items)); break;
        case 'TOP': this.e.top.forEach(f => f(m.top)); break;
        case 'WHEEL': this.e.wheel.forEach(f => f(m)); break;
        case 'TABLES': this.e.tables.forEach(f => f({ online: m.online, tables: m.tables })); break;
        case 'ADMIN': this.e.admin.forEach(f => f(m)); break;
      }
    };
    ws.onclose = () => {
      if (this.authFailed) return;
      this.e.status.forEach(f => f('offline'));
      if (!opened && this.retry >= 2 && this.failed) { this.failed(); this.failed = undefined; return; }
      const delay = [150, 500, 1200, 2500][this.retry++] ?? 4000;
      this.timer = setTimeout(() => this.open(), delay);
    };
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (m.t !== 'MOVE' && m.t !== 'ROLL' && m.t !== 'UNDO') this.outbox.push(m);
  }
}

// ───────────────────────── офлайн ─────────────────────────

const LS = 'qn.offline.v1';

export class OfflineConn extends Base {
  readonly online = false;
  private match: Match | null = null;
  private unsub: () => void = () => {};
  private profile: Profile;
  private lastWheel = 0;
  private brokeAt = 0;
  private seasonClaimed = 1;

  constructor() {
    super();
    this.profile = this.load();
    setInterval(() => { if (this.refill()) this.pushProfile(); }, 30_000);
    queueMicrotask(() => {
      this.e.status.forEach(f => f('offline'));
      this.pushProfile();
      this.e.home.forEach(f => f({}));
    });
  }

  private load(): Profile {
    try {
      const raw = JSON.parse(localStorage.getItem(LS) || 'null');
      if (raw?.profile) { this.lastWheel = raw.lastWheel || 0; this.brokeAt = raw.brokeAt || 0; this.seasonClaimed = raw.seasonClaimed || 1; return raw.profile; }
    } catch { /* */ }
    return {
      id: 'me', name: Identity.name || 'Вы', balance: 10000, refCode: 'TRAIN', code: 'QWX-TRAIN1', checkers: 'classic', dice: 'ivory',
      stats: { games: 0, wins: 0, mars: 0, biggestWin: 0, refs: 0, streak: 0 },
    };
  }
  private save() {
    try { localStorage.setItem(LS, JSON.stringify({ profile: this.profile, lastWheel: this.lastWheel, brokeAt: this.brokeAt, seasonClaimed: this.seasonClaimed })); } catch { /* */ }
  }
  private toast(t: string, ok?: boolean) { this.e.toast.forEach(f => f(t, ok)); }

  private refill(): boolean {
    if (this.profile.balance >= REFILL.BELOW) { this.brokeAt = 0; return false; }
    if (!this.brokeAt) { this.brokeAt = Date.now(); this.save(); return false; }
    if (Date.now() - this.brokeAt < REFILL.WAIT) return false;
    this.profile.balance += REFILL.AMOUNT;
    this.brokeAt = 0;
    this.save();
    this.toast(`Заведение угощает: +${REFILL.AMOUNT.toLocaleString('ru-RU')} фишек`, true);
    return true;
  }

  private addXp(n: number) {
    const p = this.profile;
    const sid = seasonId();
    if (p.season !== sid) { p.season = sid; p.xp = 0; this.seasonClaimed = 1; }
    p.xp = (p.xp || 0) + n;
    const lvl = levelOf(p.xp);
    for (let l = this.seasonClaimed + 1; l <= lvl; l++) {
      const r = SEASON.REWARDS[l];
      this.toast(`Сезонный пропуск: уровень ${l}!`, true);
      if (r?.chips) { p.balance += r.chips; this.toast(`Награда: +${r.chips.toLocaleString('ru-RU')} фишек`, true); }
      if (r?.unlock && !(p.unlocks ||= []).includes(r.unlock)) { p.unlocks.push(r.unlock); this.toast(`Награда: ${UNLOCKS.find(x => x.id === r.unlock)?.name}`, true); }
    }
    this.seasonClaimed = Math.max(this.seasonClaimed, lvl);
  }

  private pushProfile() {
    this.profile.refillAt = this.brokeAt ? this.brokeAt + REFILL.WAIT : 0;
    this.profile.wheelAt = this.lastWheel ? this.lastWheel + WHEEL_COOLDOWN : 0;
    this.e.profile.forEach(f => f(JSON.parse(JSON.stringify(this.profile))));
  }

  private startBot(level: number, variant: Variant) {
    this.leave(false);
    const lv = BOT_LEVELS[Math.max(0, Math.min(BOT_LEVELS.length - 1, level))];
    const m = new Match({
      id: 'TRAIN', stake: 0, variant,
      onEnd: r => {
        const st = this.profile.stats ||= { games: 0, wins: 0, mars: 0, biggestWin: 0, refs: 0, streak: 0 };
        st.games++;
        const won = r.winner === 'me';
        if (won) {
          st.wins++; st.streak++;
          if (r.mult > 1) st.mars = (st.mars || 0) + 1;
          const prize = BOT_PRIZE[lv.id] || 0;
          this.profile.balance += prize;
          st.biggestWin = Math.max(st.biggestWin, prize);
          setTimeout(() => this.toast(`Победа над ботом: +${prize.toLocaleString('ru-RU')} фишек`, true), 1200);
        } else st.streak = 0;
        this.addXp(SEASON.XP_GAME + (won ? SEASON.XP_WIN : 0) + (won && r.mult > 1 ? SEASON.XP_MARS : 0));
        this.save();
        this.pushProfile();
      },
    });
    this.match = m;
    this.unsub = m.subscribe('me', msg => this.e.state.forEach(f => f(msg.view)));
    m.join('me', this.profile.name, this.profile.dice || 'ivory');
    m.addBot(lv.id === 3 ? 'Аксакал' : BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], lv.level, ['ebony', 'bone', 'emerald', 'royal'][lv.id]);
  }

  private leave(home = true) {
    if (this.match) { this.unsub(); this.match.leave('me'); this.match.destroy(); this.match = null; }
    if (home) this.e.home.forEach(f => f({}));
  }

  send(m: ClientMsg) {
    const p = this.profile;
    switch (m.t) {
      case 'BOT': this.startBot(Number(m.level) || 0, m.variant === 'short' ? 'short' : 'long'); break;
      case 'QUICK': case 'CREATE': case 'JOIN':
        this.toast('Игра с людьми — онлайн. Сейчас нет связи с клубом, сыграйте с ботом', false);
        this.e.home.forEach(f => f({}));
        break;
      case 'CANCEL': this.e.queue.forEach(f => f(null)); break;
      case 'ROLL': this.match?.roll('me'); break;
      case 'MOVE': this.match?.move('me', Number(m.from), Number(m.die)); break;
      case 'UNDO': this.match?.undo('me'); break;
      case 'REMATCH': this.match?.rematch('me'); break;
      case 'LEAVE': this.leave(); break;
      case 'RENAME': { const n = String(m.name || '').trim().slice(0, 20); if (n) { p.name = n; this.save(); this.pushProfile(); } break; }
      case 'CHECKERS': {
        const c = CHECKER[m.id];
        if (c && (c.free || (p.unlocks || []).includes(c.id) || (p.owned || []).includes('checkers:' + c.id))) { p.checkers = c.id; this.save(); this.pushProfile(); }
        else this.toast('Эти фишки пока закрыты', false);
        break;
      }
      case 'DICE': {
        const d = DICE[m.id];
        if (d && (d.free || (p.unlocks || []).includes(d.id) || (p.owned || []).includes('dice:' + d.id))) { p.dice = d.id; this.match?.setDice('me', d.id); this.save(); this.pushProfile(); }
        else this.toast('Эти кости пока закрыты', false);
        break;
      }
      case 'BUY': {
        const key = String(m.item);
        const price = shopPrice(key);
        if (!SHOP_IDS.has(key) || (p.owned || []).includes(key)) break;
        if (p.balance < price) { this.toast(`Не хватает фишек: нужно ${price.toLocaleString('ru-RU')}`, false); break; }
        p.balance -= price;
        (p.owned ||= []).push(key);
        const [kind, id] = key.split(':');
        if (kind === 'dice') { p.dice = id; this.match?.setDice('me', id); } else p.checkers = id;
        this.save(); this.pushProfile();
        this.toast(`Куплено: ${shopName(key)}`, true);
        break;
      }
      case 'WHEEL': {
        const next = this.lastWheel + WHEEL_COOLDOWN;
        if (next > Date.now()) { this.e.wheel.forEach(f => f({ ok: false, wheelAt: next, text: `Колесо снова через ${Math.ceil((next - Date.now()) / 3600_000)} ч.` })); break; }
        const total = WHEEL.reduce((s, x) => s + x.w, 0);
        let r = Math.random() * total, index = 0;
        for (; index < WHEEL.length; index++) { r -= WHEEL[index].w; if (r < 0) break; }
        index = Math.min(index, WHEEL.length - 1);
        this.lastWheel = Date.now();
        p.balance += WHEEL[index].v;
        this.save();
        this.e.wheel.forEach(f => f({ ok: true, index, prize: WHEEL[index].v, wheelAt: this.lastWheel + WHEEL_COOLDOWN }));
        setTimeout(() => this.pushProfile(), 5200);
        break;
      }
      case 'TABLES': this.e.tables.forEach(f => f({ online: 1, tables: [] })); break;
      case 'TOP': this.e.top.forEach(f => f([{ name: p.name, profit: 0 }])); break;
      case 'HISTORY': this.e.history.forEach(f => f([])); break;
      case 'TRANSFER': this.toast('Переводы работают онлайн', false); break;
      case 'ADMIN': this.e.admin.forEach(f => f({ ok: false, text: 'Админ-панель работает только онлайн' })); break;
      case 'REF': case 'PING': break;
    }
  }
}

// ───────────────────────── авто: онлайн, при неудаче — офлайн ─────────────────────────

export class AutoConn extends Base {
  private inner: Conn;
  get online() { return this.inner.online; }

  constructor(url: string | null, private allowOffline = true) {
    super();
    this.inner = url ? new OnlineConn(url, allowOffline ? () => this.fallback() : undefined) : new OfflineConn();
    this.attach(this.inner);
  }

  private attach(c: Conn) {
    const is = () => c === this.inner;
    c.onState(v => { if (is()) this.e.state.forEach(f => f(v)); });
    c.onProfile(p => { if (is()) this.e.profile.forEach(f => f(p)); });
    c.onToast((t, ok) => { if (is()) this.e.toast.forEach(f => f(t, ok)); });
    c.onStatus(s => { if (is()) this.e.status.forEach(f => f(s)); });
    c.onHome(h => { if (is()) this.e.home.forEach(f => f(h)); });
    c.onQueue((s, t) => { if (is()) this.e.queue.forEach(f => f(s, t)); });
    c.onAuth(() => { if (is()) this.e.auth.forEach(f => f()); });
    c.onKicked(() => { if (is()) this.e.kicked.forEach(f => f()); });
    c.onHistory(h => { if (is()) this.e.history.forEach(f => f(h)); });
    c.onTop(t => { if (is()) this.e.top.forEach(f => f(t)); });
    c.onWheel(w => { if (is()) this.e.wheel.forEach(f => f(w)); });
    c.onTables(t => { if (is()) this.e.tables.forEach(f => f(t)); });
    c.onAdmin(a => { if (is()) this.e.admin.forEach(f => f(a)); });
  }

  private fallback() {
    if (!this.allowOffline) { this.e.toast.forEach(f => f('Сервер клуба недоступен — пробуем снова…', false)); return; }
    this.inner = new OfflineConn();
    this.attach(this.inner);
    this.e.toast.forEach(f => f('Сервер клуба недоступен — партия с ботом', false));
  }

  send(m: ClientMsg) { this.inner.send(m); }
}
