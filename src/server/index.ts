// Сервер QWX NARDY: раздаёт собранный клиент и держит партии в нарды по WebSocket.
//
//   PUBLIC_URL — адрес сайта с игрой (для ссылок-приглашений)
//   PORT       — порт (по умолчанию 3000)
//
// Вход: аккаунт Telegram (бот задан — гостей нет). Без бота — режим разработки:
// браузер хранит секретный токен, сервер узнаёт игрока по его хэшу.

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Match, RESULT_NAME } from '../shared/Match';
import type { Variant } from '../shared/Nardy';
import { VARIANT_NAME } from '../shared/Nardy';
import { BOT_NAMES } from '../shared/Bot';
import type { ClientMsg, ServerMsg, OpenTable } from '../shared/Catalog';
import { UNLOCKS, UNLOCK_IDS, REFILL, STAKES, BOT_LEVELS, BOT_PRIZE, SHOP_IDS, shopName } from '../shared/Catalog';
import { store, ladder, isAdmin } from './db';
import { stats } from './stats';
import { startBot } from './tgbot';
import { BOT_TEXTS } from './botTexts';
import type { AdminOverview, AdminTable } from '../shared/Catalog';
import { GOOGLE_CLIENT_ID, TELEGRAM_BOT_NAME, LOGIN_REQUIRED, verifyGoogle, verifyTelegram, verifyTelegramWebApp, issueSession, checkSession } from './auth';

/** как показывать игрока в журнале: @username или имя */
const nick = (u: { username?: string; name: string } | undefined) => !u ? '?' : u.username ? '@' + u.username : u.name;
const fmtN = (n: number) => Math.round(n).toLocaleString('ru-RU');

const PORT = Number(process.env.PORT) || 3000;
let PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
let originKnown = !!process.env.PUBLIC_URL;
function learnOrigin(req: http.IncomingMessage) {
  if (originKnown) return;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  if (!host || /^(localhost|127\.|0\.0\.0\.0)/.test(host)) return;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  PUBLIC_URL = `${proto}://${host}`;
  originKnown = true;
}

const cleanName = (n: string) => n.replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);

function identify(token: string, name: string): { id: string; name: string } | null {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return null;
  const id = 'u_' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 20);
  return { id, name: cleanName(name) || 'Гость' };
}

// ───────────────────────── столы ─────────────────────────

const rooms = new Map<string, Match>();

export function inviteLink(roomId: string): string {
  return `${PUBLIC_URL}/?room=${roomId}`;
}

/** Новый стол на двоих. open — виден в списке «Открытые столы». */
const variantOf = (v: unknown): Variant => v === 'short' ? 'short' : 'long';

function createRoom(owner: string, stake: number, open: boolean, variant: Variant): Match {
  let id: string;
  do id = crypto.randomBytes(3).toString('hex').toUpperCase(); while (rooms.has(id));
  const m: Match = new Match({
    id, stake, open, variant,
    fast: !!process.env.NARDY_FAST,
    turnMs: process.env.NARDY_FAST ? 4000 : undefined,
    rnd: () => crypto.randomInt(0, 1 << 30) / (1 << 30),
    onStart: ids => {
      if (m.vsBot) return true;
      // ставки обоих — в банк стола
      const users = ids.map(i => store.get(i)!).filter(Boolean);
      const poor = users.find(x => x.balance < stake);
      if (poor) {
        const s = sessions.get(poor.id);
        if (s) { toast(s.ws, `Для этого стола нужна ставка ${fmtN(stake)} фишек`, false); leaveRoom(s); }
        else m.leave(poor.id);
        return false;
      }
      for (const x of users) { store.stake(x, stake); pushProfile(x.id); }
      stats.add('tables');
      return true;
    },
    onEnd: r => {
      const prize = r.vsBot && r.winner && r.botLevel !== undefined ? BOT_PRIZE[BOT_LEVELS.findIndex(b => b.level === r.botLevel)] || 0 : 0;
      const w = r.winner ? store.get(r.winner) : null, l = r.loser ? store.get(r.loser) : null;
      // марс — ×2, кокс — ×3: проигравший доплачивает сверх ставки, сколько есть на балансе
      let extra = 0;
      if (!r.vsBot && w && l && r.stake && r.mult > 1) extra = store.penalty(l, r.stake * (r.mult - 1));
      const pot = r.pot + extra;
      const msgs = store.recordMatch(r.ids, r.winner, pot, r.mult, prize);
      stats.hand(pot, r.ids.map(id => id === r.winner ? pot - r.stake : -(r.stake + extra)));
      if (!r.vsBot && w && l) stats.event('win', `${nick(w)} обыграл ${nick(l)} · ${VARIANT_NAME[r.variant].toLowerCase()}${r.mult > 1 ? ' · ' + RESULT_NAME[r.result].replace('!', '') : ''}${r.stake ? ` · банк ${fmtN(pot)}` : ''}${r.resign ? ' (сдался)' : ''}`, w.id);
      if (extra) { const ls = sessions.get(l!.id); if (ls) toast(ls.ws, `${RESULT_NAME[r.result]} Доплата сверх ставки: ${fmtN(extra)}`, false); }
      for (const id of r.ids) {
        pushProfile(id);
        const u = store.get(id);
        if (u && !r.vsBot) ladder.record(id, u.name, id === r.winner ? r.stake + extra : -(r.stake + extra));
        const s = sessions.get(id);
        if (s && prize && id === r.winner) toast(s.ws, `Победа над ботом: +${fmtN(prize)} фишек`, true);
      }
      seasonToasts(msgs);
    },
  });
  rooms.set(id, m);
  if (!open || stake >= 0) stats.event('table', `${nick(store.get(owner))} открыл стол ${id} · ${VARIANT_NAME[variant].toLowerCase()}${stake ? ' · ставка ' + fmtN(stake) : ''}`, owner);
  return m;
}

// пустые столы закрываем
setInterval(() => {
  for (const [id, m] of rooms) {
    const online = m.seats.some(s => s && !s.bot && sessions.has(s.id));
    if (m.humans === 0 || (!online && m.phase !== 'ROLL' && m.phase !== 'MOVE')) {
      for (const s of m.seats) if (s && !s.bot) { const u = store.get(s.id); if (u) store.unstake(u); }
      m.destroy(); rooms.delete(id);
    }
  }
}, 60_000);

// ───────────────────────── сессии ─────────────────────────

interface Session { ws: WebSocket; userId: string; room: Match | null; unsub: () => void; queue: number | null; qv: Variant; queuedAt: number }
const sessions = new Map<string, Session>();
const leaveTimers = new Map<string, NodeJS.Timeout>();

const send = (ws: WebSocket, m: ServerMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
const toast = (ws: WebSocket, text: string, ok?: boolean) => send(ws, { t: 'TOAST', text, ok });

function pushProfile(userId: string) {
  const s = sessions.get(userId);
  const u = store.get(userId);
  if (s && u) send(s.ws, { t: 'PROFILE', profile: store.profile(u) });
}

function roomOf(userId: string) {
  return [...rooms.values()].find(r => r.has(userId));
}

/** сесть за стол и подписаться на партию */
function enter(s: Session, m: Match): boolean {
  const u = store.get(s.userId)!;
  if (!m.has(u.id)) {
    if (m.stake > 0 && u.balance < m.stake) {
      checkRefill(u.id);
      toast(s.ws, u.brokeAt ? brokeText(u.id) : `Для этого стола нужна ставка ${fmtN(m.stake)} фишек`, false);
      return false;
    }
    if (m.join(u.id, u.name, store.diceOf(u), u.username) < 0) { toast(s.ws, 'За столом уже двое', false); return false; }
  } else m.setOnline(u.id, true);
  s.unsub();
  s.room = m;
  s.unsub = m.subscribe(u.id, msg => send(s.ws, msg));
  return true;
}

function brokeText(id: string) {
  const u = store.get(id);
  const left = u?.brokeAt ? Math.max(1, Math.ceil((u.brokeAt + REFILL.WAIT - Date.now()) / 60_000)) : 0;
  return left ? `Фишки кончились. Через ${left} мин. заведение угостит ${REFILL.AMOUNT.toLocaleString('ru-RU')} фишками — или покрути колесо фортуны` : 'Не хватает фишек — покрути колесо фортуны в меню';
}

function leaveRoom(s: Session) {
  if (!s.room) return;
  const m = s.room;
  s.unsub();
  s.unsub = () => {};
  m.leave(s.userId);
  s.room = null;
  if (m.humans === 0) rooms.delete(m.id);
  const u = store.get(s.userId);
  if (u && m.phase === 'WAIT') store.unstake(u);
  pushProfile(s.userId);
  send(s.ws, { t: 'HOME' });
}

function seasonToasts(msgs: Map<string, string[]>) {
  for (const [pid, list] of msgs) {
    const s = sessions.get(pid);
    if (s) list.forEach((t, i) => setTimeout(() => toast(s.ws, t, true), 2500 + i * 1800));
  }
}

// ───────────────────────── быстрая игра: подбор соперника ─────────────────────────

function leaveQueue(s: Session, notify = true) {
  if (s.queue === null) return;
  s.queue = null;
  if (notify) send(s.ws, { t: 'QUEUE', stake: null });
}

function matchmake() {
  const waiting = [...sessions.values()].filter(s => s.queue !== null && !s.room).sort((a, b) => a.queuedAt - b.queuedAt);
  const used = new Set<string>();
  for (const a of waiting) {
    if (used.has(a.userId)) continue;
    const b = waiting.find(x => x !== a && !used.has(x.userId) && x.queue === a.queue && x.qv === a.qv);
    if (!b) continue;
    used.add(a.userId); used.add(b.userId);
    const stake = a.queue!;
    leaveQueue(a, false); leaveQueue(b, false);
    const m = createRoom(a.userId, stake, false, a.qv);
    send(a.ws, { t: 'QUEUE', stake: null }); send(b.ws, { t: 'QUEUE', stake: null });
    if (!enter(a, m) || !enter(b, m)) { if (a.room === m) leaveRoom(a); if (b.room === m) leaveRoom(b); }
  }
}
setInterval(matchmake, 1500);

// ───────────────────────── фишки кончились ─────────────────────────

function checkRefill(userId: string) {
  const u = store.get(userId);
  if (!u) return;
  const was = u.brokeAt;
  if (store.refill(u)) {
    const s = sessions.get(userId);
    if (s) toast(s.ws, `Заведение угощает: +${REFILL.AMOUNT.toLocaleString('ru-RU')} фишек`, true);
    stats.add('refill', REFILL.AMOUNT);
    stats.event('refill', `${nick(u)} получил ${fmtN(REFILL.AMOUNT)} после перерыва`, u.id);
    pushProfile(userId);
  } else if (u.brokeAt !== was) pushProfile(userId);
}
setInterval(() => { for (const id of sessions.keys()) checkRefill(id); }, 30_000);

// ───────────────────────── HTTP ─────────────────────────

const DIST = path.join(process.cwd(), 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  learnOrigin(req);
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') { res.end('ok'); return; }
  if (url.startsWith('/auth/')) { authRoute(req, res, url); return; }
  const root = DIST;
  const rel = url;
  let file = path.normalize(path.join(root, decodeURIComponent(rel === '/' ? '/index.html' : rel)));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (path.extname(url)) { res.writeHead(404); res.end(); return; }
    file = path.join(root, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(500); res.end('Сначала соберите клиент: npm run build'); return; }
  const ext = path.extname(file);
  const stat = fs.statSync(file);
  const headers: Record<string, string | number> = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': url.startsWith('/assets/') || ext === '.mp3' ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Accept-Ranges': 'bytes',
  };
  // перемотка/потоковое воспроизведение музыки
  const range = req.headers.range;
  if (range && ext === '.mp3') {
    const [a, b] = range.replace('bytes=', '').split('-');
    const start = Number(a) || 0, end = b ? Number(b) : stat.size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  // index.html: конфиг входа вшиваем прямо в страницу — клиенту не нужно ждать отдельный запрос
  if (ext === '.html') {
    const cfg = JSON.stringify({ google: GOOGLE_CLIENT_ID, telegram: LOGIN_REQUIRED ? TELEGRAM_BOT_NAME : '', required: LOGIN_REQUIRED }).replace(/</g, '\\u003c');
    const html = fs.readFileSync(file, 'utf8').replace('</head>', `<script>window.__QWX_CFG=${cfg}</script></head>`);
    res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
});

/** Столы, где ждут соперника, и сколько людей сейчас в клубе. */
function openTables(): { online: number; tables: OpenTable[] } {
  const tables = [...rooms.values()]
    .filter(m => m.o.open && !m.vsBot)
    .map(m => {
      const owner = m.seats.find(s => s && !s.bot);
      return { id: m.id, stake: m.stake, owner: owner?.id || '', ownerName: owner?.name || 'Клуб', players: m.humans, playing: m.phase !== 'WAIT', variant: m.variant };
    })
    .sort((a, b) => Number(a.playing) - Number(b.playing) || b.stake - a.stake)
    .slice(0, 30);
  return { online: sessions.size, tables };
}

// ───────────────────────── вход через Google ─────────────────────────

function cors(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = String(req.headers.origin || '');
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function authRoute(req: http.IncomingMessage, res: http.ServerResponse, url: string) {
  cors(req, res);
  const json = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (url === '/auth/config') { json(200, { google: GOOGLE_CLIENT_ID, telegram: LOGIN_REQUIRED ? TELEGRAM_BOT_NAME : '', required: LOGIN_REQUIRED }); return; }
  if (url === '/auth/google' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', async () => {
      let cred = '';
      try { cred = String(JSON.parse(body).credential || ''); } catch { /* */ }
      const g = await verifyGoogle(cred);
      if (!g) { json(401, { error: 'Не удалось подтвердить вход Google' }); return; }
      const id = 'g_' + crypto.createHash('sha256').update(g.sub).digest('hex').slice(0, 20);
      const u = store.getOrCreate(id, store.get(id)?.name || cleanName(g.name) || 'Игрок', '');
      json(200, { session: issueSession(id), name: u.name });
    });
    return;
  }
  if (url === '/auth/telegram' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(body) || {}; } catch { /* */ }
      const t = verifyTelegram(data);
      if (!t) { json(401, { error: 'Не удалось подтвердить вход Telegram' }); return; }
      const id = 't_' + crypto.createHash('sha256').update('tg:' + t.id).digest('hex').slice(0, 20);
      const u = store.getOrCreate(id, store.get(id)?.name || cleanName(t.name) || 'Игрок', String(data.username || ''));
      json(200, { session: issueSession(id), name: u.name });
    });
    return;
  }
  // мини-приложение Telegram: вход без кнопок, по подписанным данным от Telegram (тот же аккаунт, что и через виджет)
  if (url === '/auth/tma' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let initData = '';
      try { initData = String(JSON.parse(body).initData || ''); } catch { /* */ }
      const t = verifyTelegramWebApp(initData);
      if (!t) { json(401, { error: 'Не удалось подтвердить вход Telegram' }); return; }
      const id = 't_' + crypto.createHash('sha256').update('tg:' + t.id).digest('hex').slice(0, 20);
      const u = store.getOrCreate(id, store.get(id)?.name || cleanName(t.name) || 'Игрок', t.username);
      json(200, { session: issueSession(id), name: u.name });
    });
    return;
  }
  json(404, { error: 'not found' });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  const q = new URLSearchParams((req.url || '').split('?')[1] || '');
  let u;
  if (LOGIN_REQUIRED) {
    const id = checkSession(q.get('session') || '');
    const known = id ? store.get(id) : undefined;
    if (!known) { send(ws, { t: 'AUTH' }); ws.close(); return; }
    u = known;
  } else if (q.get('session') && store.get(checkSession(q.get('session') || '') || '')) {
    u = store.get(checkSession(q.get('session') || '')!)!;
  } else {
    const user = identify(q.get('token') || '', q.get('name') || '');
    if (!user) { send(ws, { t: 'ERROR', text: 'Не удалось войти' }); ws.close(); return; }
    u = store.getOrCreate(user.id, user.name, '');
  }
  clearTimeout(leaveTimers.get(u.id));
  leaveTimers.delete(u.id);
  {
    const now = Date.now();
    const isNew = !u.lastSeen && u.handsPlayed === 0 && now - u.createdAt < 30 * 60_000;
    if (isNew) stats.event('new', `Новый игрок: ${nick(u)}`, u.id);
    else if (now - (u.lastSeen || 0) > 10 * 60_000) stats.event('join', `${nick(u)} зашёл в игру`, u.id);
    u.lastSeen = now;
    stats.visit(u.id, isNew);
    store.save();
  }

  // один аккаунт — одна активная вкладка
  const old = sessions.get(u.id);
  if (old) { old.unsub(); send(old.ws, { t: 'KICKED' }); old.ws.close(); }

  const session: Session = { ws, userId: u.id, room: null, unsub: () => {}, queue: null, qv: 'long', queuedAt: 0 };
  sessions.set(u.id, session);
  stats.max('peakOnline', sessions.size);
  checkRefill(u.id);
  send(ws, { t: 'PROFILE', profile: store.profile(u) });

  // связь прервалась, а место за столом держится — сразу возвращаем за стол
  const want = (q.get('room') || '').toUpperCase();
  const current = roomOf(u.id);
  if (want && !rooms.has(want) && !current) toast(ws, 'Этот стол уже закрыт', false);
  if (current && (!want || rooms.get(want) === current)) enter(session, current);
  else send(ws, { t: 'HOME', resume: current?.id, invite: want && rooms.has(want) && rooms.get(want) !== current ? want : undefined });

  let last = 0;
  let bucket = 30;
  ws.on('message', raw => {
    // защита от спама: «ведро» на 30 сообщений, пополняется 25 в секунду (прицел шлётся часто)
    const now = Date.now();
    bucket = Math.min(30, bucket + (now - last) * 0.025);
    last = now;
    if (bucket < 1) return;
    bucket -= 1;
    let m: ClientMsg;
    try { m = JSON.parse(String(raw)); } catch { return; }
    const room = session.room;

    switch (m.t) {
      case 'ROLL':
        if (room && !room.roll(u.id)) send(ws, { t: 'STATE', view: room.view(u.id) });
        break;
      case 'MOVE':
        if (room && !room.move(u.id, Number(m.from), Number(m.die))) send(ws, { t: 'STATE', view: room.view(u.id) });
        break;
      case 'UNDO':
        room?.undo(u.id);
        break;
      case 'REMATCH':
        if (room) {
          if (room.stake > 0 && !room.vsBot && u.balance < room.stake) { toast(ws, `Для реванша нужна ставка ${fmtN(room.stake)}`, false); break; }
          room.rematch(u.id);
        }
        break;
      case 'CREATE': {
        leaveQueue(session);
        if (room) leaveRoom(session); else roomOf(u.id)?.leave(u.id);
        const stake = STAKES.includes(Number(m.stake)) ? Number(m.stake) : 0;
        if (u.balance < stake) { checkRefill(u.id); toast(ws, u.brokeAt ? brokeText(u.id) : `Для ставки ${fmtN(stake)} не хватает фишек`, false); send(ws, { t: 'HOME' }); break; }
        enter(session, createRoom(u.id, stake, true, variantOf(m.variant)));
        break;
      }
      case 'QUICK': {
        if (room) leaveRoom(session); else roomOf(u.id)?.leave(u.id);
        const stake = STAKES.includes(Number(m.stake)) ? Number(m.stake) : 0;
        if (u.balance < stake) { checkRefill(u.id); toast(ws, u.brokeAt ? brokeText(u.id) : `Для ставки ${fmtN(stake)} не хватает фишек`, false); break; }
        // есть открытый стол с такой ставкой — садимся сразу
        const variant = variantOf(m.variant);
        const open = [...rooms.values()].find(r => r.o.open && !r.vsBot && r.phase === 'WAIT' && r.stake === stake && r.variant === variant && r.humans === 1 && !r.has(u.id));
        if (open) { leaveQueue(session, false); send(ws, { t: 'QUEUE', stake: null }); enter(session, open); break; }
        session.queue = stake;
        session.qv = variant;
        session.queuedAt = Date.now();
        send(ws, { t: 'QUEUE', stake, since: session.queuedAt, variant });
        matchmake();
        break;
      }
      case 'CANCEL':
        leaveQueue(session);
        break;
      case 'BOT': {
        leaveQueue(session);
        if (room) leaveRoom(session); else roomOf(u.id)?.leave(u.id);
        const lv = BOT_LEVELS[Math.max(0, Math.min(BOT_LEVELS.length - 1, Math.floor(Number(m.level) || 0)))];
        const r = createRoom(u.id, 0, false, variantOf(m.variant));
        if (!enter(session, r)) break;
        r.addBot(lv.id === 3 ? 'Аксакал' : BOT_NAMES[crypto.randomInt(0, BOT_NAMES.length)], lv.level, ['ebony', 'bone', 'emerald', 'royal'][lv.id]);
        break;
      }
      case 'JOIN': {
        leaveQueue(session);
        const target = rooms.get(String(m.room || '').toUpperCase().trim());
        if (!target) { toast(ws, 'Стол с таким кодом не найден', false); send(ws, { t: 'HOME' }); break; }
        if (room && room !== target) leaveRoom(session);
        else if (!room) { const cur = roomOf(u.id); if (cur && cur !== target) cur.leave(u.id); }
        if (target.full && !target.has(u.id)) { toast(ws, 'За этим столом уже играют двое', false); send(ws, { t: 'HOME' }); break; }
        if (!enter(session, target)) send(ws, { t: 'HOME' });
        break;
      }
      case 'DICE':
        if (store.setDice(u, String(m.id || ''))) { room?.setDice(u.id, store.diceOf(u)); pushProfile(u.id); }
        else toast(ws, 'Эти кости пока закрыты', false);
        break;
      case 'CHECKERS':
        if (store.setCheckers(u, String(m.id || ''))) pushProfile(u.id); else toast(ws, 'Эти фишки пока закрыты', false);
        break;
      case 'BUY': {
        const r = store.buy(u, String(m.item || ''));
        toast(ws, r.text, r.ok);
        if (r.ok) {
          stats.event('shop', `${nick(u)} купил: ${shopName(String(m.item))} за ${fmtN(r.price || 0)}`, u.id);
          const kind = String(m.item).split(':')[0];
          if (kind === 'dice') room?.setDice(u.id, store.diceOf(u));
        }
        pushProfile(u.id);
        break;
      }
      case 'TOP':
        send(ws, { t: 'TOP', top: ladder.top().map(e => ({ name: e.name, profit: e.profit })) });
        break;
      case 'RENAME': {
        const n = cleanName(String(m.name || ''));
        if (n) { store.getOrCreate(u.id, n, ''); pushProfile(u.id); }
        break;
      }
      case 'WHEEL': {
        const r = store.spinWheel(u.id);
        if (r.ok && r.prize) { stats.add('wheel', r.prize); stats.event('wheel', `${nick(u)} выиграл на колесе ${fmtN(r.prize)}`, u.id); }
        send(ws, { t: 'WHEEL', ok: r.ok, index: r.index, prize: r.prize, wheelAt: r.wheelAt, text: r.text });
        if (r.ok) setTimeout(() => pushProfile(u.id), 5200);
        break;
      }
      case 'TABLES':
        send(ws, { t: 'TABLES', ...openTables() });
        break;
      case 'REF': {
        const r = store.applyRef(u.id, String(m.code || ''));
        if (r.text) toast(ws, r.text, r.ok);
        if (r.ok) {
          stats.event('ref', `${nick(u)} пришёл по ссылке ${nick(store.get(r.inviter || ''))}`, u.id);
          pushProfile(u.id);
          if (r.inviter) { pushProfile(r.inviter); const peer = sessions.get(r.inviter); if (peer) toast(peer.ws, `Ваш друг пришёл по ссылке: +5 000 фишек`, true); }
        }
        break;
      }
      case 'HISTORY':
        send(ws, { t: 'HISTORY', items: store.history(u.id) });
        break;
      case 'TRANSFER': {
        const r = store.transfer(u.id, String(m.to || ''), Math.floor(Number(m.amount) || 0));
        toast(ws, r.text, r.ok);
        pushProfile(u.id);
        if (r.ok && r.to) {
          const amt = Math.floor(Number(m.amount) || 0), fee = Math.floor(amt * 0.05);
          stats.add('transfers', amt); stats.add('fees', fee);
          stats.event('transfer', `${nick(u)} → ${nick(store.get(r.to))}: ${fmtN(amt)} (комиссия ${fmtN(fee)})`, u.id);
          pushProfile(r.to);
          const peer = sessions.get(r.to);
          if (peer) { toast(peer.ws, `Вам перевели фишки: ${u.username ? '@' + u.username : u.name}`, true); send(peer.ws, { t: 'HISTORY', items: store.history(r.to) }); }
          send(ws, { t: 'HISTORY', items: store.history(u.id) });
        }
        break;
      }
      case 'PING':
        send(ws, { t: 'PONG' });
        break;
      case 'ADMIN':
        adminOp(session, m);
        break;
      case 'LEAVE':
        leaveQueue(session);
        if (room) leaveRoom(session); else { roomOf(u.id)?.leave(u.id); send(ws, { t: 'HOME' }); }
        break;
    }
  });

  ws.on('close', () => {
    if (sessions.get(u.id)?.ws !== ws) return;
    session.unsub();
    sessions.delete(u.id);
    const room = session.room;
    if (!room) return;
    room.setOnline(u.id, false);
    // три минуты на переподключение, потом встаём из-за стола (в партии — поражение)
    leaveTimers.set(u.id, setTimeout(() => {
      leaveTimers.delete(u.id);
      if (sessions.has(u.id) || !room.has(u.id)) return;
      room.leave(u.id);
      if (room.humans === 0) rooms.delete(room.id);
      const x = store.get(u.id);
      if (x && room.phase === 'WAIT') store.unstake(x);
    }, 180_000));
  });
});

// ───────────────────────── админ-панель ─────────────────────────

function withTable(x: NonNullable<ReturnType<typeof store.get>>) {
  const v = store.adminView(x, sessions.has(x.id));
  const r = roomOf(x.id);
  if (r) v.table = `${r.id}${r.vsBot ? ' (с ботом)' : ''}${r.stake ? ' · ставка ' + fmtN(r.stake) : ''}`;
  return v;
}

/** всё, что происходит в клубе: сегодня и за неделю, столы, онлайн, журнал */
function overview(): AdminOverview {
  const users = store.allUsers();
  const tables: AdminTable[] = [...rooms.values()].map(m => {
    const ss = m.seats.filter(Boolean);
    return {
      id: m.id, blinds: m.stake ? 'ставка ' + fmtN(m.stake) : (m.vsBot ? 'с ботом' : 'без ставки'), players: ss.length,
      humans: ss.map(s => s!.bot ? `${s!.name} (бот)` : nick(store.get(s!.id))), stage: `${VARIANT_NAME[m.variant].split(' ')[0].toLowerCase()} · ${({ WAIT: 'ждёт', ROLL: 'бросок', MOVE: 'ход', OVER: 'итог' } as Record<string, string>)[m.phase] || m.phase}`,
      pot: m.pot, tourney: false, hands: m.games,
    };
  }).sort((a, b) => b.humans.length - a.humans.length);
  return {
    online: sessions.size,
    users: users.length,
    chipsTotal: users.reduce((a, u) => a + u.balance + u.tableStack, 0),
    chipsOnTables: users.reduce((a, u) => a + u.tableStack, 0),
    days: stats.recent(7),
    tables,
    events: stats.lastEvents(80),
    onlineUsers: [...sessions.keys()].map(id => store.get(id)).filter(Boolean).map(x => withTable(x!)),
  };
}

function adminOp(s: Session, m: Extract<ClientMsg, { t: 'ADMIN' }>) {
  const me = store.get(s.userId);
  const reply = (ok: boolean, text: string, extra: Partial<Extract<ServerMsg, { t: 'ADMIN' }>> = {}) => send(s.ws, { t: 'ADMIN', ok, text, ...extra });
  if (!me || !isAdmin(me)) { reply(false, 'Нет доступа'); return; }
  const log = (extra: Record<string, unknown>) => store.adminLog({ admin: me.username || me.id, op: m.op, ...extra });
  if (m.op === 'list') {
    const q = String(m.text || '').trim().replace(/^@/, '').toLowerCase();
    const all = store.allUsers();
    const users = all
      .filter(x => !q || x.name.toLowerCase().includes(q) || (x.username || '').toLowerCase().includes(q))
      .sort((a, b) => (sessions.has(b.id) ? 1 : 0) - (sessions.has(a.id) ? 1 : 0) || (b.lastSeen || b.createdAt) - (a.lastSeen || a.createdAt))
      .slice(0, 500).map(withTable);
    reply(true, `Игроков в клубе: ${all.length}, онлайн: ${sessions.size}`, { users });
    return;
  }
  if (m.op === 'overview') { reply(true, '', { overview: overview() }); return; }
  if (m.op === 'events') { reply(true, '', { events: stats.lastEvents(300, m.text || undefined) }); return; }
  if (m.op === 'broadcast') {
    const text = String(m.text || '').replace(/[<>]/g, '').trim().slice(0, 200);
    if (!text) { reply(false, 'Пустое сообщение'); return; }
    for (const x of sessions.values()) toast(x.ws, text, true);
    log({ text });
    reply(true, `Отправлено ${sessions.size} игрокам`);
    return;
  }
  const t = store.findAny(String(m.target || ''));
  if (!t) { reply(false, 'Игрок не найден — введите @username или код QWX-…'); return; }
  const amount = Math.trunc(Number(m.amount) || 0);
  const who = t.username ? '@' + t.username : t.name;
  const notify = (text: string) => { const x = sessions.get(t.id); if (x) toast(x.ws, text, true); pushProfile(t.id); };
  switch (m.op) {
    case 'find': reply(true, who, { user: withTable(t), userEvents: stats.lastEvents(2000).filter(e => e.who === t.id).slice(0, 40) }); return;
    case 'give': {
      if (!amount || Math.abs(amount) > 1e9) { reply(false, 'Укажите сумму'); return; }
      t.balance = Math.max(0, t.balance + amount);
      if (t.balance + t.tableStack >= REFILL.BELOW) t.brokeAt = 0;
      store.save();
      if (amount > 0) notify(`Подарок от заведения: +${amount.toLocaleString('ru-RU')} фишек`); else pushProfile(t.id);
      stats.add(amount > 0 ? 'adminGiven' : 'adminTaken', Math.abs(amount));
      stats.event('admin', `${nick(me)}: ${amount > 0 ? 'выдал' : 'забрал у'} ${who} ${fmtN(Math.abs(amount))}`, t.id);
      log({ target: t.id, amount });
      reply(true, `${who}: ${amount > 0 ? '+' : ''}${amount.toLocaleString('ru-RU')}`, { user: withTable(t) });
      return;
    }
    case 'set': {
      if (amount < 0 || amount > 1e9) { reply(false, 'Неверная сумма'); return; }
      const was = t.balance;
      t.balance = amount;
      if (amount > was) stats.add('adminGiven', amount - was); else stats.add('adminTaken', was - amount);
      stats.event('admin', `${nick(me)}: баланс ${who} ${fmtN(was)} → ${fmtN(amount)}`, t.id);
      if (t.balance + t.tableStack >= REFILL.BELOW) t.brokeAt = 0;
      store.save(); checkRefill(t.id); pushProfile(t.id);
      log({ target: t.id, amount });
      reply(true, `${who}: баланс ${amount.toLocaleString('ru-RU')}`, { user: withTable(t) });
      return;
    }
    case 'unlock': case 'lock': {
      const id = String(m.item || '');
      const shop = SHOP_IDS.has(id);
      if (!UNLOCK_IDS.has(id) && !shop) { reply(false, 'Нет такого предмета'); return; }
      const name = shop ? shopName(id) : UNLOCKS.find(x => x.id === id)!.name;
      if (m.op === 'unlock') {
        if (!(shop ? store.grant(t, id) : store.unlock(t, id))) { reply(false, 'Уже есть'); return; }
        notify(`Подарок от заведения: ${name}`);
      } else {
        if (shop) t.owned = (t.owned || []).filter(x => x !== id); else t.unlocks = (t.unlocks || []).filter(x => x !== id);
        pushProfile(t.id);
      }
      stats.event('admin', `${nick(me)}: ${m.op === 'unlock' ? 'выдал' : 'забрал у'} ${who} — ${name}`, t.id);
      store.save();
      log({ target: t.id, item: id });
      reply(true, `${who}: ${m.op === 'unlock' ? 'выдано' : 'забрано'} — ${name}`, { user: withTable(t) });
      return;
    }
    case 'xp': {
      if (!amount || amount < 0 || amount > 100000) { reply(false, 'Укажите опыт'); return; }
      const msgs = store.addXp(t, amount);
      store.save(); pushProfile(t.id);
      if (msgs.length) seasonToasts(new Map([[t.id, msgs]]));
      log({ target: t.id, amount });
      reply(true, `${who}: +${amount} опыта`, { user: withTable(t) });
      return;
    }
    case 'resetWheel':
      t.wheelAt = 0; store.save(); notify('Колесо фортуны снова доступно');
      log({ target: t.id });
      reply(true, `${who}: колесо доступно`, { user: withTable(t) });
      return;
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { store.flush(); stats.flush(); process.exit(0); });
}

// бот: приветствие на /start, команды, описание и кнопка «Играть»
startBot(BOT_TEXTS, () => PUBLIC_URL);

server.listen(PORT, () => {
  console.log(`🎲 QWX NARDY: ${PUBLIC_URL} (порт ${PORT})`);
});
