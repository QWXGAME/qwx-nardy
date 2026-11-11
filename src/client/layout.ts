// Раскладка доски нард в «единицах доски» — общая для 3D и 2D.
// x — вправо, v — к игроку (вниз на экране). Центр доски — (0, 0).
// Вид белых: нижний ряд — пункты 0..11 справа налево, верхний — 12..23 слева направо.

export const L = {
  W: 0.96,          // ширина игрового поля
  B: 0.06,          // бар посередине
  H: 0.64,          // глубина поля
  PW: 0.075,        // ширина пункта
  TRI: 0.27,        // длина треугольника
  R: 0.033,         // радиус фишки
  FRAME: 0.035,     // рамка доски
  TRAY: 0.08,       // лоток для снятых фишек (справа)
};

export type Spot = number; // 0..23 — пункты, −1 — бар, 24 — снята

/** центр основания пункта и направление роста стопки (+1 — вверх по экрану, −1 — вниз) */
export function pointBase(i: number): { x: number; v: number; dir: number } {
  const { W, B, PW, H } = L;
  if (i < 12) {
    const x = i < 6 ? W / 2 - PW * (i + 0.5) : -B / 2 - PW * (i - 6 + 0.5);
    return { x, v: H / 2 - L.R, dir: -1 };
  }
  const x = i < 18 ? -W / 2 + PW * (i - 12 + 0.5) : B / 2 + PW * (i - 18 + 0.5);
  return { x, v: -H / 2 + L.R, dir: 1 };
}

/** место k-й фишки в стопке пункта (до 5 в ряд, дальше — второй слой со сдвигом) */
export function slot(i: number, k: number): { x: number; v: number; layer: number } {
  const b = pointBase(i);
  const per = 5;
  const layer = Math.floor(k / per);
  const kk = k % per;
  const step = L.R * 2 * 0.98;
  return { x: b.x, v: b.v + b.dir * (kk * step + layer * L.R), layer };
}

/** бар: фишки игрока side; flipView — смотрим за чёрных */
export function barSlot(side: number, k: number): { x: number; v: number; layer: number } {
  const s = side === 0 ? 1 : -1;
  return { x: 0, v: s * (0.06 + k * L.R * 1.6), layer: 0 };
}

/** лоток снятых фишек: тонкие «монеты» стопкой вдоль края; home — сторона дома (верх/низ, лево/право) */
export function traySlot(side: number, k: number, variant: 'long' | 'short'): { x: number; v: number; layer: number } {
  // дом белых — справа внизу; чёрных: короткие — справа вверху, длинные — слева вверху
  const right = side === 0 || variant === 'short';
  const x = (right ? 1 : -1) * (L.W / 2 + L.FRAME + L.TRAY / 2);
  const s = side === 0 ? 1 : -1;
  return { x, v: s * (L.H / 2 - 0.02 - k * 0.0135), layer: 0 };
}

/** точка на доске → пункт (или бар / лоток); null — мимо */
export function pickSpot(x: number, v: number, variant: 'long' | 'short', mySide: number): Spot | null {
  const { W, B, H, PW } = L;
  if (Math.abs(v) > H / 2 + 0.02) return null;
  const trayX = W / 2 + L.FRAME;
  // лоток своего дома
  const right = mySide === 0 || variant === 'short';
  if ((right && x > trayX - 0.01) || (!right && x < -trayX + 0.01)) return 24;
  if (Math.abs(x) > W / 2) return null;
  if (Math.abs(x) < B / 2) return -1;
  const top = v < 0;
  if (!top) {
    if (x > 0) return Math.min(5, Math.max(0, Math.floor((W / 2 - x) / PW)));
    return 6 + Math.min(5, Math.max(0, Math.floor((-B / 2 - x) / PW)));
  }
  if (x < 0) return 12 + Math.min(5, Math.max(0, Math.floor((x + W / 2) / PW)));
  return 18 + Math.min(5, Math.max(0, Math.floor((x - B / 2) / PW)));
}

/** для чёрных доска повёрнута на 180° */
export const flipXY = (p: { x: number; v: number }, flip: boolean) => flip ? { x: -p.x, v: -p.v } : p;
