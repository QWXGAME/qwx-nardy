// Тесты нард: npm test

import { Nardy, pointOf } from './Nardy';
import type { Variant } from './Nardy';
import { planTurn } from './Bot';
import { Match } from './Match';

let fails = 0;
const ok = (c: unknown, m: string) => { if (c) console.log('  ✓ ' + m); else { fails++; console.log('  ✗ ' + m); } };
const sum = (n: Nardy) => [0, 1].map(p => n.board.reduce((a, v) => a + (p === 0 ? Math.max(0, v) : Math.max(0, -v)), 0) + n.bar[p] + n.off[p]);

console.log('Длинные: расстановка и голова');
{
  const n = new Nardy('long');
  ok(n.board[23] === 15 && n.board[11] === -15, 'по 15 фишек на голове');
  n.roll(5, 3);
  const l = n.legal();
  ok(l.every(m => m.from === 0), 'первый ход — только с головы');
  n.move(0, 5);
  ok(n.legal().every(m => m.from !== 0), 'вторая фишка с головы — нельзя');
  ok(n.legal().length > 0 && n.legal().every(m => m.from === 5 && m.die === 3), 'играем вторую кость той же фишкой');
  n.move(5, 3);
  ok(n.done() && n.own(0, 8) === 1, 'ход сыгран: фишка на 8-м шаге');
  n.pass();
  n.roll(6, 6);
  const heads = new Set(n.turns().map(seq => seq.filter(m => m.from === 0).length));
  ok(Math.max(...heads) === 2, 'первый бросок 6-6 — две фишки с головы');
}
{
  const n = new Nardy('long');
  n.roll(4, 4);
  // нельзя встать на пункт соперника: у чёрных голова — шаг 12 белых
  n.board[pointOf('long', 0, 4)] = -1; n.board[11] = -14;
  ok(!n.legal().some(m => m.to === 4), 'на занятый соперником пункт ходить нельзя');
}
{
  // блок из шести без фишек соперника впереди — запрещён
  const n = new Nardy('long');
  n.board = new Array(24).fill(0);
  for (const s of [1, 2, 3, 4, 5]) n.board[pointOf('long', 0, s)] = 2;
  n.board[pointOf('long', 0, 0)] = 5;
  n.board[11] = -15; // все чёрные на голове: впереди блока их нет
  n.fresh = [false, false];
  n.roll(6, 1);
  ok(!n.legal().some(m => m.to === 6), 'шестой пункт блока поставить нельзя');
  n.board[11] = -14; n.board[pointOf('long', 1, 20)] = -1; // одна чёрная ушла вперёд
  n.roll(6, 1);
  ok(n.legal().some(m => m.to === 6), 'если впереди есть фишка соперника — можно');
}

console.log('Короткие: удар, бар, выход');
{
  const n = new Nardy('short');
  ok(n.board[23] === 2 && n.board[12] === 5 && n.board[7] === 3 && n.board[5] === 5, 'классическая расстановка белых');
  ok(sum(n)[0] === 15 && sum(n)[1] === 15, 'по 15 фишек');
  // одиночная чёрная на шаге белых 5 → удар
  n.board = new Array(24).fill(0);
  n.board[pointOf('short', 0, 0)] = 2;
  n.board[pointOf('short', 0, 5)] = -1;
  n.board[0] = -14;
  n.roll(5, 2);
  const m = n.move(0, 5);
  ok(m?.hit && n.bar[1] === 1, 'одиночка бита — на бар');
  n.move(5, 2);
  n.pass();
  n.roll(6, 6);
  ok(n.legal().every(x => x.from === -1) || n.legal().length === 0, 'с бара — в первую очередь');
}
{
  const n = new Nardy('short');
  n.board = new Array(24).fill(0);
  n.board[pointOf('short', 0, 20)] = 1;
  n.board[pointOf('short', 0, 22)] = 1;
  n.board[0] = -15;
  n.off[0] = 13;
  n.roll(6, 3);
  ok(n.legal().some(m => m.from === 20 && m.to === 24 && m.die === 6), 'выброс старшей костью с дальней фишки');
  n.move(20, 6); n.move(22, 3);
  ok(n.winner() === 0 && n.result() === 'koks', 'все сняты; у соперника фишки в доме победителя — кокс');
}
{
  // правило большей кости
  const n = new Nardy('short');
  n.board = new Array(24).fill(0);
  n.board[pointOf('short', 0, 0)] = 1;
  n.board[pointOf('short', 0, 1)] = -2; n.board[pointOf('short', 0, 5)] = -2; n.board[pointOf('short', 0, 6)] = -2;
  n.board[pointOf('short', 0, 11)] = -9;
  n.roll(6, 4);
  const l = n.legal();
  ok(l.length >= 1 && l.every(m => m.die === 6 || l.every(x => x.die !== 6)), 'одна кость — играем большую, если можно');
}

console.log('Партии ботов до конца');
for (const v of ['long', 'short'] as Variant[]) {
  const n = new Nardy(v);
  let turns = 0, rnd = 1;
  const r = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const t0 = Date.now();
  while (n.winner() < 0 && turns < 600) {
    n.roll(1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6));
    for (const m of planTurn(n, 0.9, r)) if (!n.move(m.from, m.die)) { ok(false, 'бот сделал недопустимый ход'); break; }
    const s = sum(n);
    if (s[0] !== 15 || s[1] !== 15) { ok(false, 'фишки потерялись'); break; }
    if (n.winner() >= 0) break;
    n.pass();
    turns++;
  }
  ok(n.winner() >= 0, `${v}: победа за ${turns} ходов (${n.result()}), ${Date.now() - t0} мс`);
}

console.log('Стол целиком: человек против бота');
(async () => {
  await new Promise<void>(res => {
    let over = false;
    const m: Match = new Match({ id: 'T', stake: 0, variant: 'short', fast: true, turnMs: 2000, onEnd: r => { over = true; ok(!!r, `партия окончена: ${r.result}`); } });
    m.join('me', 'Я');
    m.subscribe('me', msg => {
      const v = msg.view;
      if (v.me !== v.state.turn) return;
      if (v.phase === 'ROLL') setTimeout(() => m.roll('me'), 1);
      if (v.phase === 'MOVE') setTimeout(() => {
        const n = Nardy.from(v.state);
        const l = n.legal();
        if (l.length) m.move('me', l[0].from, l[0].die);
      }, 1);
    });
    m.addBot('Ашот', 0.9);
    const iv = setInterval(() => { if (over) { clearInterval(iv); m.destroy(); res(); } }, 50);
    setTimeout(() => { if (!over) { ok(false, 'партия не закончилась'); clearInterval(iv); m.destroy(); res(); } }, 60000);
  });
  console.log(fails ? `\n${fails} ОШИБОК` : '\nВсе тесты пройдены');
  process.exit(fails ? 1 : 0);
})();
