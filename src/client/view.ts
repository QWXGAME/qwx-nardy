// Общий интерфейс доски: 3D-зал и 2D-доска рисуют одно и то же, интерфейс про отличие не знает.

import type { Spot } from './layout';
import type { Variant } from '../shared/Nardy';

export interface Position {
  board: number[];
  bar: [number, number];
  off: [number, number];
  variant: Variant;
}

export interface Highlight {
  /** пункты, откуда можно ходить */
  from: Spot[];
  /** выбранная фишка */
  sel: Spot | null;
  /** куда можно пойти выбранной */
  to: Spot[];
}

export interface Renderer {
  readonly kind: '3d' | '2d';
  /** чей взгляд: 0 — белые снизу, 1 — доска повёрнута для чёрных */
  setSide(side: number): void;
  /** расставить фишки; изменения анимируются сами (ход, удар, отмена) */
  setPosition(p: Position, instant?: boolean): void;
  /** кости: values — выпавшие, left — ещё не сыгранные; side — кто бросал; throwIt — анимировать бросок */
  setDice(values: number[], left: number[], side: number, set: string, throwIt: boolean): void;
  highlight(h: Highlight): void;
  /** экран → пункт; null — мимо доски */
  pick(sx: number, sy: number): Spot | null;
  /** экран → где фишка (для подсказок над доской) */
  toScreen(spot: Spot, side: number): { x: number; y: number };
  setLooks(checkers: string, board: string): void;
  setLobby(on: boolean): void;
  onFrame(cb: (dt: number) => void): void;
  onLowPower(cb: (low: boolean) => void): void;
  /** стук фишки/костей — для звука */
  onSound(cb: (kind: 'checker' | 'dice' | 'hit', v: number) => void): void;
}
