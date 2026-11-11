// Всплывающие сообщения сверху экрана.

export class Toasts {
  private el = document.createElement('div');
  constructor() {
    this.el.className = 'toasts';
    document.body.appendChild(this.el);
  }
  show(text: string, ok?: boolean) {
    const t = document.createElement('div');
    t.className = 'toast' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
    t.textContent = text;
    this.el.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; }, 2600 + Math.min(2000, text.length * 25));
    setTimeout(() => t.remove(), 3200 + Math.min(2000, text.length * 25));
  }
}
