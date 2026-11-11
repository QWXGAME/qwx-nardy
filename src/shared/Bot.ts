// Бот для нард: перебирает все варианты хода и выбирает лучшую позицию по оценке.
// Уровень 0..1: чем ниже, тем больше «шума» в оценке и тем проще игра.

import { Nardy, CHECKERS } from './Nardy';
import type { Move, Side } from './Nardy';

export const BOT_NAMES = ['Ашот', 'Гиви', 'Вахтанг', 'Тенгиз', 'Ибрагим', 'Арсен', 'Рустам', 'Заур', 'Дато', 'Мамука', 'Аслан', 'Мурат'];

/** оценка позиции с точки зрения игрока p (больше — лучше) */
export function evaluate(n: Nardy, p: Side): number {
  const q = (1 - p) as Side;
  if (n.off[p] >= CHECKERS) return 1e6;
  let score = (n.pips(q) - n.pips(p)) * 1.0 + n.off[p] * 4;
  if (n.variant === 'short') {
    score += n.bar[q] * 18 - n.bar[p] * 18;
    // одиночки под ударом и занятые пункты
    for (let s = 0; s < 24; s++) {
      const c = n.own(p, s);
      if (c >= 2) score += s >= 18 ? 5 : s >= 12 ? 3 : 1.5;
      if (c === 1) {
        // сколько чужих фишек позади на расстоянии 1..11 (могут бить)
        let threat = 0;
        for (let d = 1; d <= 11; d++) { const t = s + d; if (t < 24 && n.foe(p, t) > 0) threat += d <= 6 ? 2 : 1; }
        if (n.bar[q]) threat += 2;
        score -= threat * (2 + s / 8);
      }
    }
    // прайм: подряд занятые пункты перед соперником
    let run = 0, best = 0;
    for (let s = 0; s < 24; s++) { run = n.own(p, s) >= 2 ? run + 1 : 0; best = Math.max(best, run); }
    score += best * best * 1.5;
  } else {
    // длинные: голову разгружать, занимать пункты, держать блоки на пути соперника
    score -= Math.max(0, n.own(p, 0) - 1) * 1.6;
    let points = 0, run = 0, best = 0;
    for (let s = 1; s < 24; s++) {
      const c = n.own(p, s);
      if (c > 0) points++;
      if (c > 4) score -= (c - 4) * 1.5;
      run = c > 0 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    score += points * 2.2 + best * best * 1.2;
  }
  return score;
}

/** лучший ход: последовательность одиночных ходов */
export function planTurn(n: Nardy, level: number, rnd: () => number): Move[] {
  const p = n.turn;
  const opts = n.turns();
  if (!opts.length) return [];
  let best: Move[] = opts[0], bestScore = -Infinity;
  const noise = (1 - level) * 22;
  for (const seq of opts) {
    const snap = n.save();
    for (const m of seq) n.move(m.from, m.die);
    const sc = evaluate(n, p) + (rnd() - 0.5) * noise;
    n.load(snap);
    n.history = [];
    if (sc > bestScore) { bestScore = sc; best = seq; }
  }
  return best;
}
