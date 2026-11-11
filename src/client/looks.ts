// Оформление без зависимостей от 3D: доска и вид, выбор хранится в браузере.

/** Доска: дерево короба, поле и цвета треугольников. Первые три — бесплатно, остальные — наградой сезона. */
export interface BoardLook { id: string; name: string; wood: string; woodDark: string; field: string; p1: string; p2: string; unlock?: boolean; hint?: string }
export const BOARDS: BoardLook[] = [
  { id: 'walnut', name: 'Орех', wood: '#5a3218', woodDark: '#2a1408', field: '#e2cfa4', p1: '#6a1420', p2: '#1a1412' },
  { id: 'mahogany', name: 'Махагон', wood: '#6a2414', woodDark: '#2a0a06', field: '#1d3a2a', p1: '#e8d3a2', p2: '#8a1a22' },
  { id: 'oak', name: 'Дуб', wood: '#a8784a', woodDark: '#5a3a1a', field: '#f0e2c0', p1: '#2a3a5a', p2: '#8a3a1a' },
  { id: 'ebony_board', name: 'Эбен', wood: '#1a1412', woodDark: '#050404', field: '#2a0c10', p1: '#d4af37', p2: '#efe4c8', unlock: true, hint: 'сезон · ур. 4' },
  { id: 'burl', name: 'Карельская берёза', wood: '#c8964a', woodDark: '#6a4a1a', field: '#3a1a10', p1: '#f0d8a0', p2: '#1a0d07', unlock: true, hint: 'сезон · ур. 10' },
  { id: 'inlay', name: 'Мозаика', wood: '#3a1c0c', woodDark: '#140804', field: '#0e2a3a', p1: '#c9a35a', p2: '#b8322a', unlock: true, hint: 'сезон · ур. 16' },
];
export const DEFAULT_BOARD = 'walnut';

export function savedBoardId(): string {
  try { const v = localStorage.getItem('qn.board'); if (v && BOARDS.some(f => f.id === v)) return v; } catch { /* */ }
  return DEFAULT_BOARD;
}
export function saveBoard(id: string) {
  if (!BOARDS.some(f => f.id === id)) return;
  try { localStorage.setItem('qn.board', id); } catch { /* */ }
}
export const boardLook = (id: string) => BOARDS.find(b => b.id === id) || BOARDS[0];
/** открыт ли предмет у игрока */
export function isOpen(id: string, unlocks: string[] | undefined, needs?: boolean) { return !needs || !!unlocks?.includes(id); }

/** вид: 3D-зал или 2D (сверху) */
export function viewMode(): '3d' | '2d' {
  try { return localStorage.getItem('qb.view') === '2d' ? '2d' : '3d'; } catch { return '3d'; }
}
export function saveViewMode(m: '3d' | '2d') {
  try { localStorage.setItem('qb.view', m); } catch { /* */ }
}
