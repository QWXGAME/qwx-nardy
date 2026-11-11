// Перевод фишек игроку клуба по Telegram @username (комиссия клуба 5%) и история переводов.

import type { ClientMsg, Profile, TransferRecord } from '../../shared/Catalog';
import { Telegram } from '../telegram';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export class Transfer {
  private xfer = document.createElement('div');
  private back = document.createElement('div');
  private profile: Profile | null = null;

  constructor(private send: (m: ClientMsg) => void, private tap: () => void, private toast: (t: string, ok?: boolean) => void) {
    this.xfer.className = 'xfer';
    this.back.className = 'sheet-back';
  }

  setProfile(p: Profile) { this.profile = p; }

  private build() {
    this.xfer.innerHTML = `
      <div class="head"><h2>Перевод фишек</h2><button class="x" aria-label="Закрыть">×</button></div>
      <div class="sub">Получатель — Telegram-юзернейм игрока клуба, например @ivan_petrov. Комиссия клуба 5%.</div>
      <label>Кому<input class="to" placeholder="@username" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="33"></label>
      <label>Сколько<input class="amt" inputmode="numeric" placeholder="1 000" maxlength="10"></label>
      <div class="calc"></div>
      <button class="lobby-btn gold big go">Отправить</button>
      <div class="me-un"></div>
      <div class="hist-title">История</div>
      <div class="hist"><div class="none">Переводов пока не было</div></div>`;
    const to = this.xfer.querySelector('.to') as HTMLInputElement;
    const amt = this.xfer.querySelector('.amt') as HTMLInputElement;
    const calc = this.xfer.querySelector('.calc') as HTMLElement;
    amt.oninput = () => {
      const n = Number(amt.value.replace(/\D/g, '')) || 0;
      amt.value = n ? fmt(n) : '';
      calc.textContent = n ? `Получит ${fmt(n - Math.floor(n * 0.05))}` : '';
    };
    (this.xfer.querySelector('.x') as HTMLElement).onclick = () => this.close();
    this.back.onclick = () => this.close();
    (this.xfer.querySelector('.go') as HTMLButtonElement).onclick = () => {
      const n = Number(amt.value.replace(/\D/g, '')) || 0;
      const u = to.value.trim();
      if (!u || !n) { this.toast('Укажите @username и сумму', false); return; }
      this.send({ t: 'TRANSFER', to: '@' + u.replace(/^@/, ''), amount: n });
      Telegram.haptic('bet');
      amt.value = ''; calc.textContent = '';
      this.close();
    };
    document.body.append(this.back, this.xfer);
  }

  open() {
    this.tap();
    if (!this.xfer.childElementCount) this.build();
    this.send({ t: 'HISTORY' });
    const un = this.xfer.querySelector('.me-un') as HTMLElement;
    const name = this.profile?.username ? '@' + this.profile.username : '';
    un.innerHTML = name ? `Ваш юзернейм: <b class="mycode">${name}</b> · баланс ${fmt(this.profile!.balance)}` : 'Чтобы получать переводы, задайте @username в настройках Telegram и войдите заново';
    const b = un.querySelector('.mycode') as HTMLElement | null;
    if (b && name) b.onclick = () => navigator.clipboard?.writeText(name).then(() => this.toast('Юзернейм скопирован', true), () => {});
    this.xfer.classList.add('open');
    this.back.classList.add('open');
  }

  close() { this.xfer.classList.remove('open'); this.back.classList.remove('open'); }

  showHistory(items: TransferRecord[]) {
    const box = this.xfer.querySelector('.hist') as HTMLElement | null;
    if (!box) return;
    box.innerHTML = items.length ? items.map(r => {
      const d = new Date(r.at);
      const when = `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      const who = r.dir === 'out' ? `→ ${esc(r.to)}` : `← ${esc(r.from)}`;
      const sum = r.dir === 'out' ? `−${fmt(r.amount)}` : `+${fmt(r.amount - r.fee)}`;
      return `<div class="row ${r.dir}"><span>${who}<i>${when}</i></span><b>${sum}</b></div>`;
    }).join('') : '<div class="none">Переводов пока не было</div>';
  }
}
