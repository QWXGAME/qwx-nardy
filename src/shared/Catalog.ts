// Общие для сервера и клиента: профиль, экономика, награды, протокол.

import type { MatchView } from './Match';
import type { Variant } from './Nardy';

export const GAME_NAME = 'QWX NARDY';

export interface Profile {
  id: string;
  name: string;
  balance: number;
  /** Telegram @username (без @) */
  username?: string;
  /** код аккаунта для переводов, например QWX-7KD2PM */
  code?: string;
  stats?: { games: number; wins: number; mars: number; biggestWin: number; refs: number; streak: number };
  refCode?: string;
  /** когда снова можно крутить колесо (ms, 0 — уже можно) */
  wheelAt?: number;
  xp?: number;
  season?: string;
  /** открытые награды */
  unlocks?: string[];
  /** выбранные фишки (на вашем экране) */
  checkers?: string;
  /** выбранные кости (видит и соперник) */
  dice?: string;
  /** купленное в магазине: 'checkers:onyx', 'dice:gold' */
  owned?: string[];
  admin?: boolean;
  /** фишки кончились: когда заведение угостит (ms), 0 — не ждём */
  refillAt?: number;
}

// ───────────────────────── фишки, кости, доски ─────────────────────────

/** Набор фишек: ваши (light) и соперника (dark) — на вашем экране. */
export interface CheckerSet { id: string; name: string; light: string; dark: string; rim: string; inlay: string; metal?: boolean; pattern?: 'marble' | 'pearl' | 'wood'; free?: boolean; hint?: string; price?: number; note?: string }
export const CHECKER_SETS: CheckerSet[] = [
  { id: 'classic', name: 'Кость и эбен', light: '#efe4c8', dark: '#1a1412', rim: '#c9a35a', inlay: '#7a1218', free: true, note: 'классика нардов' },
  { id: 'wood', name: 'Орех и клён', light: '#d9b27a', dark: '#4a2614', rim: '#2a140a', inlay: '#c9a35a', pattern: 'wood', free: true, note: 'дерево ручной работы' },
  // сезон
  { id: 'crimson', name: 'Кармин', light: '#f2e6cc', dark: '#6e0f18', rim: '#d9a443', inlay: '#d9a443', hint: 'сезон · ур. 2' },
  { id: 'jade', name: 'Нефрит', light: '#e8efe6', dark: '#0e3f3a', rim: '#ffd66e', inlay: '#ffd66e', hint: 'сезон · ур. 14' },
  // магазин
  { id: 'amber', name: 'Янтарь', light: '#f0c46a', dark: '#5a2a08', rim: '#ffd27a', inlay: '#2a1404', price: 3000, note: 'мёд и смола' },
  { id: 'marble', name: 'Мрамор', light: '#f2f0ec', dark: '#2a2a2e', rim: '#9a9aa0', inlay: '#1a1a1a', pattern: 'marble', price: 5000, note: 'каррарский и неро' },
  { id: 'sapphire', name: 'Сапфир', light: '#e6ecf2', dark: '#1a3a8a', rim: '#c9d2dc', inlay: '#c9d2dc', price: 6000, note: 'синий и серебро' },
  { id: 'pearl', name: 'Жемчуг', light: '#f6f1ea', dark: '#3a2a3a', rim: '#e0c8d8', inlay: '#b08aa8', pattern: 'pearl', price: 8000, note: 'перламутр' },
  { id: 'malachite', name: 'Малахит', light: '#efe6c8', dark: '#1f6b4a', rim: '#c9a35a', inlay: '#c9a35a', price: 10000, note: 'уральский камень' },
  { id: 'garnet', name: 'Гранат', light: '#f6e2d8', dark: '#4a0410', rim: '#ff7a7a', inlay: '#ff9a9a', price: 12000, note: 'бордо и розовое золото' },
  { id: 'onyx', name: 'Оникс', light: '#e8e2d2', dark: '#050505', rim: '#ffd66e', inlay: '#ffd66e', price: 18000, note: 'чёрный лак с золотом' },
  { id: 'silver', name: 'Серебро', light: '#dfe3ea', dark: '#3a3f46', rim: '#ffffff', inlay: '#1a2030', metal: true, price: 30000, note: 'полированный металл' },
  { id: 'gold', name: 'Золото', light: '#e6c35a', dark: '#2a2420', rim: '#fff0b0', inlay: '#3a2a08', metal: true, price: 50000, note: 'для королей доски' },
];
export const CHECKER = Object.fromEntries(CHECKER_SETS.map(c => [c.id, c])) as Record<string, CheckerSet>;

/** Кости: ваши кости видит и соперник, когда вы бросаете. */
export interface DiceSet { id: string; name: string; body: string; pip: string; metal?: boolean; glass?: boolean; free?: boolean; hint?: string; price?: number; note?: string }
export const DICE_SETS: DiceSet[] = [
  { id: 'ivory', name: 'Слоновая кость', body: '#f3ead6', pip: '#1a1412', free: true, note: 'классика' },
  { id: 'ebony', name: 'Эбен', body: '#1a1614', pip: '#e8d3a2', free: true, note: 'чёрные с золотыми точками' },
  { id: 'red', name: 'Казино', body: '#b3122a', pip: '#ffffff', hint: 'сезон · ур. 8', glass: true },
  { id: 'royal', name: 'Королевские', body: '#1b1a4a', pip: '#ffd66e', hint: 'сезон · ур. 20' },
  { id: 'emerald', name: 'Изумруд', body: '#0b4a2e', pip: '#f2e6c8', glass: true, price: 3000, note: 'полупрозрачные' },
  { id: 'amber', name: 'Янтарь', body: '#c8781e', pip: '#2a1404', glass: true, price: 4000, note: 'на просвет' },
  { id: 'bone', name: 'Старая кость', body: '#e2d2a8', pip: '#7a1218', price: 5000, note: 'красные точки, как у дедушки' },
  { id: 'smoke', name: 'Дымчатый кварц', body: '#3a3a40', pip: '#ffffff', glass: true, price: 7500, note: 'тонированное стекло' },
  { id: 'rose', name: 'Розовое золото', body: '#e0a58a', pip: '#3a1a1e', metal: true, price: 15000, note: 'металл' },
  { id: 'gold', name: 'Золото', body: '#d4af37', pip: '#1a1208', metal: true, price: 40000, note: 'звенят по доске' },
];
export const DICE = Object.fromEntries(DICE_SETS.map(d => [d.id, d])) as Record<string, DiceSet>;

export const SHOP_IDS = new Set([...CHECKER_SETS.filter(c => c.price).map(c => 'checkers:' + c.id), ...DICE_SETS.filter(b => b.price).map(b => 'dice:' + b.id)]);
export function shopPrice(key: string): number {
  const [kind, id] = key.split(':');
  return (kind === 'checkers' ? CHECKER[id]?.price : kind === 'dice' ? DICE[id]?.price : 0) || 0;
}
export function shopName(key: string): string {
  const [kind, id] = key.split(':');
  return kind === 'checkers' ? `Фишки «${CHECKER[id]?.name}»` : `Кости «${DICE[id]?.name}»`;
}

/** Всё, что открывается наградами */
export const UNLOCKS: { id: string; kind: 'checkers' | 'dice' | 'board'; name: string }[] = [
  { id: 'crimson', kind: 'checkers', name: 'Фишки «Кармин»' },
  { id: 'jade', kind: 'checkers', name: 'Фишки «Нефрит»' },
  { id: 'red', kind: 'dice', name: 'Кости «Казино»' },
  { id: 'royal', kind: 'dice', name: 'Кости «Королевские»' },
  { id: 'ebony_board', kind: 'board', name: 'Доска «Эбен»' },
  { id: 'burl', kind: 'board', name: 'Доска «Карельская берёза»' },
  { id: 'inlay', kind: 'board', name: 'Доска «Мозаика»' },
];
export const UNLOCK_IDS = new Set(UNLOCKS.map(u => u.id));

/** Сезонный пропуск: месяц по Москве */
export const SEASON = {
  XP_GAME: 40, XP_WIN: 60, XP_MARS: 30, PER_LEVEL: 200, LEVELS: 20,
  REWARDS: {
    2: { unlock: 'crimson' }, 4: { unlock: 'ebony_board' }, 6: { chips: 5000 }, 8: { unlock: 'red' }, 10: { unlock: 'burl' },
    12: { chips: 10000 }, 14: { unlock: 'jade' }, 16: { unlock: 'inlay' }, 18: { chips: 20000 }, 20: { unlock: 'royal' },
  } as Record<number, { unlock?: string; chips?: number }>,
};
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export function seasonId(now = Date.now()) {
  const d = new Date(now + 3 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function seasonName(id: string) { return `Сезон «${MONTHS[Number(id.slice(5, 7)) - 1] || ''}»`; }
export function seasonEnds(now = Date.now()) {
  const d = new Date(now + 3 * 3600_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 3 * 3600_000;
}
export const levelOf = (xp: number) => Math.min(SEASON.LEVELS, Math.floor(xp / SEASON.PER_LEVEL) + 1);

/** Фишки кончились: перерыв, потом заведение угощает */
export const REFILL = { AMOUNT: 1000, WAIT: 30 * 60_000, BELOW: 500 };

/** Ставки на партию: 0 — товарищеская (без фишек) */
export const STAKES = [0, 500, 1000, 2500, 5000, 10000, 25000];
/** Уровни бота */
export const BOT_LEVELS = [
  { id: 0, name: 'Новичок', level: 0.15 },
  { id: 1, name: 'Любитель', level: 0.55 },
  { id: 2, name: 'Мастер', level: 0.85 },
  { id: 3, name: 'Аксакал', level: 1 },
];
/** награда за победу над ботом (раз за партию, без ставки) */
export const BOT_PRIZE = [100, 250, 500, 1000];

export interface AdminUser { id: string; name: string; username: string; balance: number; tableStack: number; hands: number; wins: number; xp: number; unlocks: string[]; createdAt: number; online: boolean; lastSeen?: number; code?: string; table?: string }

export interface DayStats {
  day: string;
  hands: number; turnover: number; won: number; lost: number; biggestPot: number;
  players: number; newPlayers: number; peakOnline: number; tables: number;
  wheel: number; refill: number; transfers: number; fees: number;
  adminGiven: number; adminTaken: number; tourneyPrizes: number;
}
export interface ClubEvent { at: number; kind: 'join' | 'new' | 'table' | 'win' | 'wheel' | 'transfer' | 'refill' | 'tourney' | 'admin' | 'ref' | 'shop'; text: string; who?: string }
export interface AdminTable { id: string; blinds: string; players: number; humans: string[]; stage: string; pot: number; tourney: boolean; hands: number }
export interface AdminOverview {
  online: number; users: number; chipsTotal: number; chipsOnTables: number;
  days: DayStats[]; tables: AdminTable[]; events: ClubEvent[]; onlineUsers: AdminUser[];
}

/** Колесо фортуны */
export const WHEEL: { v: number; w: number }[] = [
  { v: 500, w: 22 }, { v: 2500, w: 12 }, { v: 1000, w: 18 }, { v: 10000, w: 3 },
  { v: 500, w: 22 }, { v: 5000, w: 6 }, { v: 1000, w: 18 }, { v: 25000, w: 1 },
  { v: 500, w: 22 }, { v: 2500, w: 12 }, { v: 1000, w: 18 }, { v: 5000, w: 6 },
];
export const WHEEL_COOLDOWN = 24 * 3600_000;
export const REF_BONUS = 5000;

/** стол, который ждёт соперника */
export interface OpenTable { id: string; stake: number; owner: string; ownerName: string; players: number; playing: boolean; variant: Variant }

// ───────────────────────── протокол ─────────────────────────

export type ClientMsg =
  /** бросить кости */
  | { t: 'ROLL' }
  /** ход фишкой: from — шаг на своём пути (−1 — с бара), die — кость */
  | { t: 'MOVE'; from: number; die: number }
  | { t: 'UNDO' }
  | { t: 'LEAVE' }
  | { t: 'REMATCH' }
  // лобби
  | { t: 'CREATE'; stake: number; variant: Variant }
  | { t: 'QUICK'; stake: number; variant: Variant }
  | { t: 'CANCEL' }
  | { t: 'BOT'; level: number; variant: Variant }
  | { t: 'JOIN'; room: string }
  | { t: 'TOP' }
  | { t: 'RENAME'; name: string }
  | { t: 'TRANSFER'; to: string; amount: number }
  | { t: 'HISTORY' }
  | { t: 'WHEEL' }
  | { t: 'TABLES' }
  | { t: 'REF'; code: string }
  | { t: 'CHECKERS'; id: string }
  | { t: 'DICE'; id: string }
  /** магазин: купить 'checkers:…' или 'dice:…' */
  | { t: 'BUY'; item: string }
  | { t: 'PING' }
  | { t: 'ADMIN'; op: 'find' | 'give' | 'set' | 'unlock' | 'lock' | 'xp' | 'list' | 'broadcast' | 'resetWheel' | 'overview' | 'events'; target?: string; amount?: number; item?: string; text?: string };

export interface TransferRecord { at: number; from: string; to: string; amount: number; fee: number; dir: 'in' | 'out' }

export type ServerMsg =
  | { t: 'STATE'; view: MatchView }
  | { t: 'PROFILE'; profile: Profile }
  | { t: 'TOAST'; text: string; ok?: boolean }
  | { t: 'ERROR'; text: string }
  | { t: 'HOME'; resume?: string; invite?: string }
  /** подбор соперника: ищем (stake) или поиск окончен (null) */
  | { t: 'QUEUE'; stake: number | null; since?: number; variant?: Variant }
  | { t: 'AUTH' }
  | { t: 'KICKED' }
  | { t: 'WHEEL'; ok: boolean; index?: number; prize?: number; wheelAt?: number; text?: string }
  | { t: 'TABLES'; online: number; tables: OpenTable[] }
  | { t: 'HISTORY'; items: TransferRecord[] }
  | { t: 'TOP'; top: { name: string; profit: number }[] }
  | { t: 'PONG' }
  | { t: 'ADMIN'; ok: boolean; text?: string; user?: AdminUser; users?: AdminUser[]; overview?: AdminOverview; events?: ClubEvent[]; userEvents?: ClubEvent[] };
