// Точка входа клиента QWX NARDY.

import './ui/style.css';
import './ui/club.css';
import './ui/nardy.css';
import { Telegram } from './telegram';
import { Audio } from './audio';
import type { Renderer } from './view';
import { Game } from './ui/Game';
import { Lobby } from './ui/Lobby';
import { AutoConn } from './net';
import { login } from './ui/Login';
import { Loading } from './ui/loading';
import { Identity } from './identity';
import { Menu } from './ui/Menu';
import { savedBoardId } from './looks';
import { Smoke } from './ui/smoke';
import { viewMode, saveViewMode } from './looks';
import { PWA, weakDevice } from './pwa';
import { Toasts } from './ui/toast';
import { Transfer } from './ui/Transfer';

/** первый запуск на слабом телефоне: сразу предлагаем лёгкий 2D-стол */
function chooseView(): Promise<void> {
  return new Promise(res => {
    const el = document.createElement('div');
    el.className = 'view-ask';
    el.innerHTML = `<div class="va-card"><small>Первый запуск</small><h2>Как будем играть?</h2>
      <p>Похоже, телефон не самый мощный. Лёгкая 2D-доска (вид сверху) работает плавно и бережёт батарею — 3D можно включить в любой момент в «Оформлении».</p>
      <button class="lobby-btn gold big" data-v="2d">2D · быстро и плавно</button>
      <button class="lobby-btn big" data-v="3d">3D · прокуренный зал</button></div>`;
    el.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => {
      saveViewMode(b.dataset.v as '2d' | '3d');
      el.classList.add('gone');
      setTimeout(() => { el.remove(); res(); }, 300);
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
  });
}

async function boot() {
  Telegram.boot();
  PWA.boot();
  let firstRun = false;
  try { firstRun = !localStorage.getItem('qb.view'); } catch { /* */ }
  if (firstRun && weakDevice()) await chooseView();
  const base = ((import.meta.env.VITE_SERVER_URL as string | undefined) || location.origin).replace(/\/$/, '');
  const offlineOnly = new URLSearchParams(location.search).has('offline') || location.protocol === 'file:';
  type AuthCfg = { google?: string; telegram?: string; required?: boolean };
  const inlined = (window as unknown as { __QWX_CFG?: AuthCfg }).__QWX_CFG;
  const cfgFetch: Promise<AuthCfg | null> = offlineOnly ? Promise.resolve(null) : inlined ? Promise.resolve(inlined)
    : fetch(`${base}/auth/config`).then(r => (r.ok ? r.json() as Promise<AuthCfg> : null)).catch(() => null);

  Loading.done('code');
  await Promise.race([
    Promise.all([
      document.fonts.load('700 80px "Playfair Display"'),
      document.fonts.load('800 40px "Bodoni Moda"'),
      document.fonts.load('600 14px "Manrope"'),
    ]),
    new Promise(r => setTimeout(r, 1800)),
  ]).catch(() => {});
  Loading.done('fonts');

  const audio = new Audio();
  const toasts = new Toasts();

  // вид стола: 3D-зал или лёгкий 2D — в 2D three.js вообще не скачивается
  const mode = viewMode();
  document.body.classList.add('mode-' + mode);
  const stage = document.getElementById('stage')!;
  let world: Renderer;
  let w3: import('./scene/World3D').World3D | null = null;
  if (mode === '3d') {
    const [{ World3D }, bake] = await Promise.all([import('./scene/World3D'), import('./scene/bake')]);
    await bake.loadBakeManifest();
    w3 = new World3D(stage, savedBoardId(), 'classic');
    world = w3;
  } else {
    const { Table2D } = await import('./two/Table2D');
    world = new Table2D(stage, savedBoardId(), 'classic');
  }

  // ── соединение ──
  const wsBase = base.replace(/^http/, 'ws');
  let cfg: AuthCfg | null = null;
  if (!offlineOnly) cfg = await Promise.race([cfgFetch, new Promise<null>(r => setTimeout(() => r(null), 15000))]);
  let signed = cfg === null ? null : cfg.required ? 'required' : '';
  if (cfg && Telegram.initData) {
    try {
      const r = await fetch(`${base}/auth/tma`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: Telegram.initData }) });
      if (r.ok) { const j = await r.json(); Identity.session = j.session; if (!Identity.name) Identity.name = j.name; signed = 'required'; }
    } catch { /* */ }
  }
  if (signed && !Identity.session) {
    document.getElementById('splash')?.classList.add('gone');
    const r = await login({ telegram: cfg!.telegram || undefined }, base);
    Identity.session = r.session;
    if (!Identity.name) Identity.name = r.name;
  }
  const q = new URLSearchParams(signed
    ? { session: Identity.session, room: Identity.room || Telegram.startParam }
    : { token: Identity.token, name: Identity.name || 'Гость', room: Identity.room || Telegram.startParam });
  const conn = new AutoConn(offlineOnly || signed === null ? null : `${wsBase}/ws?${q}`, !signed);
  conn.onAuth(() => { Identity.session = ''; location.reload(); });
  conn.onKicked(() => {
    const el = document.createElement('div');
    el.className = 'login open';
    el.innerHTML = `<div class="login-card"><div class="lobby-logo"><span>●</span><h1>QWX NARDY</h1><p>длинные и короткие</p></div>
      <p class="login-text">Игра открыта на другом устройстве или в другой вкладке.<br>Одновременно можно играть только в одном месте.</p>
      <button class="lobby-btn gold big">Играть здесь</button></div>`;
    (el.querySelector('button') as HTMLButtonElement).onclick = () => location.reload();
    document.body.appendChild(el);
  });

  const toast = (t: string, ok?: boolean) => toasts.show(t, ok);
  let lastProfile: import('../shared/Catalog').Profile | null = null;
  const game = new Game(world, { send: m => conn.send(m), audio, toast, home: () => conn.send({ t: 'LEAVE' }) });
  const transfer = new Transfer(m => conn.send(m), () => audio.press(), toast);
  conn.onHistory(h => transfer.showHistory(h));

  // дым за меню лобби
  const smokeCanvas = document.createElement('canvas');
  smokeCanvas.className = 'lobby-smoke';
  document.body.appendChild(smokeCanvas);
  const smoke = new Smoke(smokeCanvas, 0.8);
  const lobby = new Lobby(m => conn.send(m), () => { audio.press(); Telegram.haptic('tap'); }, () => conn.online, toast);
  const menu = new Menu({
    send: m => conn.send(m),
    tap: () => audio.press(),
    tick: () => audio.chipTick(0.35),
    win: () => audio.win(true),
    toast,
    online: () => conn.online,
    transfer: () => transfer.open(),
    setBoard: id => world.setLooks(lastProfile?.checkers || 'classic', id),
    inviteTable: () => game.invite(),
    leave: () => conn.send({ t: 'LEAVE' }),
    sound: () => audio.toggleSfx(),
    soundOn: () => audio.sfxEnabled,
    signOut: () => { Identity.session = ''; location.reload(); },
  });
  menu.signedIn = !!signed;
  conn.onWheel(w => menu.onWheel(w));
  conn.onAdmin(a => menu.onAdmin(a));
  conn.onTables(t => { menu.onTables(t); lobby.setOnline(t.online); });
  conn.onTop(t => menu.onTop(t));
  conn.onQueue((s, since) => lobby.queue(s, since));
  lobby.onOpen = k => menu.open(k);
  setInterval(() => { if (lobby.isHome && conn.online && !document.hidden) conn.send({ t: 'TABLES' }); }, 15000);
  conn.onStatus(s => { if (s === 'online' && Identity.ref) { conn.send({ t: 'REF', code: Identity.ref }); Identity.clearRef(); } if (s === 'online') conn.send({ t: 'TABLES' }); });
  conn.onState(v => {
    lobby.update(v);
    world.setLobby(v.phase === 'WAIT');
    if (v.phase === 'WAIT') { game.home(); menu.setContext(false); return; }
    game.apply(v);
    menu.setContext(true);
  });
  conn.onProfile(p => { lastProfile = p; world.setLooks(p.checkers || 'classic', savedBoardId()); game.setProfile(p); lobby.setProfile(p); menu.setProfile(p); transfer.setProfile(p); });
  conn.onHome(h => {
    let auto = false;
    try { auto = sessionStorage.getItem('qb.autoResume') === '1'; sessionStorage.removeItem('qb.autoResume'); } catch { /* */ }
    if (auto && h.resume) { conn.send({ t: 'JOIN', room: h.resume }); return; }
    game.home(); world.setLobby(true); lobby.showHome(h); menu.setContext(false);
  });
  lobby.showHome({});
  lobby.signedIn = !!signed;
  lobby.onVisible = v => {
    world.setLobby(v);
    smokeCanvas.classList.toggle('on', v);
    if (v) smoke.start(); else setTimeout(() => { if (!smokeCanvas.classList.contains('on')) smoke.pause(); }, 1300);
  };
  lobby.onSignOut = () => { Identity.session = ''; location.reload(); };
  conn.onToast((t, ok) => toast(t, ok));
  const reconn = document.createElement('div');
  reconn.className = 'reconn';
  reconn.innerHTML = '<i></i><span>Переподключение…</span>';
  document.body.appendChild(reconn);
  let reconnT = 0;
  conn.onStatus(s => {
    clearTimeout(reconnT);
    if (s === 'online' || !conn.online) { reconn.classList.remove('on'); return; }
    reconnT = window.setTimeout(() => reconn.classList.add('on'), 800);
  });
  world.onLowPower(l => document.body.classList.toggle('lowfx', l));
  // для автотестов
  (window as unknown as { __world: Renderer }).__world = world;
  (window as unknown as { __send: unknown }).__send = (m: Parameters<typeof conn.send>[0]) => conn.send(m);
  (window as unknown as { __game: Game }).__game = game;

  if (!w3) {
    Loading.done('textures'); Loading.done('shaders');
    setTimeout(() => document.getElementById('splash')?.classList.add('gone'), 350);
    return;
  }
  const w = w3;
  const bake = await import('./scene/bake');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const compile = (w.renderer.compileAsync ? w.renderer.compileAsync(w.scene, w.camera) : Promise.resolve()).catch(() => {}).then(() => Loading.done('shaders'));
    const textures = bake.bakedReady().then(() => Loading.done('textures'));
    Promise.race([Promise.all([textures, compile]), new Promise(r => setTimeout(r, 7000))])
      .then(() => { Loading.done('textures'); Loading.done('shaders'); setTimeout(() => document.getElementById('splash')?.classList.add('gone'), 500); });
  }));
}

boot();
