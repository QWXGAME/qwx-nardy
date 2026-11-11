// Телеграм-бот игры: приветствие на /start (картинка + кнопка «Играть»), команды, описание и кнопка меню.
// Работает, если задан TELEGRAM_BOT_TOKEN. Опрос getUpdates — без вебхука и без лишних настроек.
// Выключить: TG_WELCOME=0 (например, если этим же ботом управляет другая программа).

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BotTexts {
  /** короткое «О боте» (до 120 символов) */
  about: string;
  /** описание в пустом чате (до 512 символов) */
  description: string;
  /** приветствие на /start (HTML Telegram) */
  welcome: string;
  /** подпись кнопки */
  button: string;
  /** команды бота */
  commands: { command: string; description: string }[];
  /** ответ на /help */
  help: string;
  /** картинка приветствия в папке public/tg */
  image: string;
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method: string, body: unknown) {
  try {
    const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json() as { ok: boolean; result?: unknown; description?: string };
  } catch { return { ok: false }; }
}

/** запустить бота; url() — адрес игры (может появиться позже, когда сервер узнает свой домен) */
export function startBot(t: BotTexts, url: () => string) {
  if (!TOKEN || process.env.TG_WELCOME === '0') return;
  let photoId = '';
  let offset = 0;
  let menuSetFor = '';

  // описание, «о боте», команды — один раз при старте
  void call('setMyShortDescription', { short_description: t.about.slice(0, 120) });
  void call('setMyDescription', { description: t.description.slice(0, 512) });
  void call('setMyCommands', { commands: t.commands });

  const ensureMenu = () => {
    const u = url();
    if (!u.startsWith('https://') || menuSetFor === u) return;
    menuSetFor = u;
    void call('setChatMenuButton', { menu_button: { type: 'web_app', text: t.button.replace(/^[^\p{L}]+/u, '').slice(0, 16) || 'Играть', web_app: { url: u } } });
  };

  const keyboard = () => {
    const u = url();
    if (!u.startsWith('https://')) return undefined;
    return { inline_keyboard: [[{ text: t.button, web_app: { url: u } }], [{ text: '🌐 Открыть в браузере', url: u }]] };
  };

  async function welcome(chat: number) {
    const markup = keyboard();
    const file = path.join(process.cwd(), 'dist', 'tg', t.image);
    if (photoId || fs.existsSync(file)) {
      try {
        let r: Response;
        if (photoId) {
          r = await fetch(`${API}/sendPhoto`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, photo: photoId, caption: t.welcome, parse_mode: 'HTML', reply_markup: markup }) });
        } else {
          const fd = new FormData();
          fd.append('chat_id', String(chat));
          fd.append('caption', t.welcome);
          fd.append('parse_mode', 'HTML');
          if (markup) fd.append('reply_markup', JSON.stringify(markup));
          fd.append('photo', new Blob([fs.readFileSync(file)]), t.image);
          r = await fetch(`${API}/sendPhoto`, { method: 'POST', body: fd });
        }
        const j = await r.json() as { ok: boolean; result?: { photo?: { file_id: string }[] } };
        if (j.ok) { const ph = j.result?.photo; if (ph?.length) photoId = ph[ph.length - 1].file_id; return; }
      } catch { /* текстом */ }
    }
    await call('sendMessage', { chat_id: chat, text: t.welcome, parse_mode: 'HTML', reply_markup: markup });
  }

  async function poll() {
    for (;;) {
      try {
        const r = await fetch(`${API}/getUpdates?timeout=50&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`);
        const j = await r.json() as { ok: boolean; result?: { update_id: number; message?: { chat: { id: number; type: string }; text?: string } }[] };
        if (!j.ok) { await new Promise(res => setTimeout(res, 15000)); continue; }
        ensureMenu();
        for (const u of j.result || []) {
          offset = u.update_id + 1;
          const m = u.message;
          if (!m?.text || m.chat.type !== 'private') continue;
          const cmd = m.text.split(/[\s@]/)[0].toLowerCase();
          if (cmd === '/start' || cmd === '/play') await welcome(m.chat.id);
          else if (cmd === '/help' || cmd === '/rules') await call('sendMessage', { chat_id: m.chat.id, text: t.help, parse_mode: 'HTML', reply_markup: keyboard() });
          else await call('sendMessage', { chat_id: m.chat.id, text: 'Нажмите «Играть» — игра откроется прямо в Telegram 👇', reply_markup: keyboard() });
        }
      } catch { await new Promise(res => setTimeout(res, 10000)); }
    }
  }
  void poll();
}
