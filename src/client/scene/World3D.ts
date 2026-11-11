// 3D-зал нард: резная доска на столике под низкой лампой, фишки с инкрустацией, кости с настоящим броском,
// соперник в шляпе напротив. Камера — с вашей стороны; в портрете — сверху, доска вдоль экрана.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Renderer, Position, Highlight } from '../view';
import { L, slot, barSlot, traySlot, pickSpot, pointBase } from '../layout';
import type { Spot } from '../layout';
import { fieldCanvas, checkerTop, diceFace, woodFill, shade } from '../art';
import { boardLook } from '../looks';
import { CHECKER, DICE } from '../../shared/Catalog';
import { parquetTextures, clubWallTextures, rugTexture, woolTextures } from './woods';

/** высота столика (верх доски) и масштаб: единица доски → метры */
const TY = 0.72;
const S = 0.8;
const CH = 0.0105;          // толщина фишки
const CR = L.R * S * 0.97;  // радиус фишки
const DS = 0.024;           // ребро кости
const LAMP = 6.5;

interface Chk { side: 0 | 1; g: THREE.Group; spot: Spot | null; k: number; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; arc: number; tray: boolean; lift: number }
interface Die { mesh: THREE.Mesh; mats: THREE.MeshStandardMaterial[]; value: number; t: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Quaternion; q1: THREE.Quaternion; used: boolean; set: string; spin: THREE.Vector3 }

const FACE_VAL = [1, 6, 2, 5, 3, 4]; // грани BoxGeometry: +x −x +y −y +z −z

export class World3D implements Renderer {
  readonly kind = '3d' as const;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.03, 40);
  private board = new THREE.Group();
  private fieldMat!: THREE.MeshStandardMaterial;
  private frameMat!: THREE.MeshStandardMaterial;
  private chks: Chk[] = [];
  private dice: Die[] = [];
  private glow: THREE.Mesh[] = [];
  private glowMat: THREE.MeshBasicMaterial[] = [];
  private trayGlow!: THREE.Mesh;
  private barGlow!: THREE.Mesh;
  private hl: Highlight = { from: [], sel: null, to: [] };
  private side = 0;
  private variant: 'long' | 'short' = 'long';
  private checkerSet = 'classic';
  private boardId = 'walnut';
  private lobby = true;
  private frameCbs: ((dt: number) => void)[] = [];
  private lowCbs: ((low: boolean) => void)[] = [];
  private soundCbs: ((k: 'checker' | 'dice' | 'hit', v: number) => void)[] = [];
  private last = performance.now();
  private camPos = new THREE.Vector3(0, TY + 1.4, 1.6);
  private camLook = new THREE.Vector3(0, TY, 0);
  private wantPos = new THREE.Vector3();
  private wantLook = new THREE.Vector3();
  private orbit = 0;
  private dpr: number;
  private minDpr = 1;
  private frames = 0;
  private winStart = performance.now();
  private low = false;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TY);
  private sideMats: Record<string, THREE.MeshStandardMaterial> = {};
  private topMats: Record<string, THREE.MeshStandardMaterial> = {};
  private chkGeo!: THREE.BufferGeometry;
  private topGeo!: THREE.BufferGeometry;
  private figure = new THREE.Group();
  private figHead = new THREE.Group();
  private t = 0;

  constructor(private el: HTMLElement, boardId: string, checkers: string) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.minDpr = mobile ? 1.25 : 1;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x070405);
    this.scene.fog = new THREE.FogExp2(0x070405, 0.08);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(clubEnvironment(), 0).texture;
    this.scene.environmentIntensity = 0.5;
    this.boardId = boardId;
    this.checkerSet = checkers;

    this.buildRoom();
    this.buildTable();
    this.buildBoard();
    this.buildLamp(mobile ? 2048 : 4096);
    this.buildCheckers();
    this.buildDice();
    this.buildFigure();
    this.scene.add(this.board);

    addEventListener('resize', () => this.resize());
    this.resize();
    const loop = () => { this.tick(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ───────────────────────── зал ─────────────────────────

  private buildRoom() {
    const s = this.scene;
    const parquet = parquetTextures(1024);
    for (const t of [parquet.map, parquet.rough, parquet.bump]) t.repeat.set(5, 5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ map: parquet.map, roughnessMap: parquet.rough, bumpMap: parquet.bump, bumpScale: 0.6, roughness: 0.75, envMapIntensity: 0.3 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.2), new THREE.MeshStandardMaterial({ map: rugTexture(768), roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2; rug.rotation.z = Math.PI / 2;
    rug.position.y = 0.004;
    rug.receiveShadow = true;
    s.add(rug);
    const wall = clubWallTextures(512);
    wall.map.repeat.set(6, 1.6); wall.bump.repeat.set(6, 1.6);
    const wallMat = new THREE.MeshStandardMaterial({ map: wall.map, bumpMap: wall.bump, bumpScale: 0.5, roughness: 0.85 });
    const H = 3.2;
    for (const [x, z, ry] of [[0, -4.5, 0], [0, 4.5, Math.PI], [-4.5, 0, Math.PI / 2], [4.5, 0, -Math.PI / 2]] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9, H), wallMat);
      m.position.set(x, H / 2, z); m.rotation.y = ry;
      s.add(m);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshStandardMaterial({ color: 0x0b0706, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H;
    s.add(ceil);
    const glowTex = glowTexture();
    for (const [x, z] of [[-2, -4.45], [2, -4.45], [-4.45, -1.5], [4.45, -1.5], [-4.45, 1.5], [4.45, 1.5]]) {
      const l = new THREE.PointLight(0xffb070, 1.6, 5, 2);
      l.position.set(x * 0.97, 1.9, z * 0.97);
      s.add(l);
      const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc080, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
      g.scale.set(0.7, 0.7, 1);
      g.position.set(x * 0.985, 1.9, z * 0.985);
      s.add(g);
    }
    s.add(new THREE.HemisphereLight(0x4a3428, 0x080404, 0.32));
  }

  private buildTable() {
    const s = this.scene;
    const wood = new THREE.MeshPhysicalMaterial({ color: 0x2a1208, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2, envMapIntensity: 0.7 });
    const top = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.05, 0.9, 4, 0.02), wood);
    top.position.y = TY - 0.045;
    top.castShadow = true; top.receiveShadow = true;
    s.add(top);
    for (const [x, z] of [[-0.52, -0.37], [0.52, -0.37], [-0.52, 0.37], [0.52, 0.37]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.018, TY - 0.07, 16), wood);
      leg.position.set(x, (TY - 0.07) / 2, z);
      leg.castShadow = true;
      s.add(leg);
    }
  }

  // ───────────────────────── доска ─────────────────────────

  private buildBoard() {
    const b = this.board;
    const look = boardLook(this.boardId);
    // поле
    const ft = new THREE.CanvasTexture(fieldCanvas(this.boardId));
    ft.colorSpace = THREE.SRGBColorSpace;
    ft.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    this.fieldMat = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.82, envMapIntensity: 0.25 });
    const field = new THREE.Mesh(new THREE.PlaneGeometry(L.W * S, L.H * S), this.fieldMat);
    field.rotation.x = -Math.PI / 2;
    field.position.y = TY - 0.0118;
    field.receiveShadow = true;
    b.add(field);
    // рамка короба и лоток
    this.frameMat = new THREE.MeshPhysicalMaterial({ map: woodTexture(look.wood, look.woodDark), roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.6 });
    const F = L.FRAME * S, Wd = L.W * S, Hd = L.H * S, T = L.TRAY * S;
    const parts: THREE.BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => { const g = new RoundedBoxGeometry(w, h, d, 2, 0.004); g.translate(x, y, z); parts.push(g); };
    const outerW = Wd + 2 * F + 2 * (T + F);
    box(outerW, 0.014, Hd + 2 * F, 0, TY - 0.0215, 0);                 // дно
    box(outerW, 0.03, F, 0, TY - 0.002, -(Hd / 2 + F / 2));             // дальний борт
    box(outerW, 0.03, F, 0, TY - 0.002, Hd / 2 + F / 2);                // ближний борт
    for (const sx of [-1, 1]) {
      box(F, 0.03, Hd, sx * (Wd / 2 + F / 2), TY - 0.002, 0);           // борта поля
      box(F, 0.03, Hd, sx * (Wd / 2 + F + T + F / 2), TY - 0.002, 0);   // внешние борта лотков
    }
    const frame = new THREE.Mesh(mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g))!, this.frameMat);
    frame.castShadow = true; frame.receiveShadow = true;
    b.add(frame);
    // лотки — тёмное сукно
    const trayMat = new THREE.MeshStandardMaterial({ color: shade(look.field, -0.45), roughness: 0.9 });
    for (const sx of [-1, 1]) {
      const tr = new THREE.Mesh(new THREE.PlaneGeometry(T, Hd), trayMat);
      tr.rotation.x = -Math.PI / 2;
      tr.position.set(sx * (Wd / 2 + F + T / 2), TY - 0.0118, 0);
      tr.receiveShadow = true;
      b.add(tr);
    }
    // подсветка пунктов
    for (let i = 0; i < 24; i++) {
      const p = pointBase(i);
      const baseV = p.dir < 0 ? L.H / 2 : -L.H / 2;
      const tipV = baseV + p.dir * L.TRI;
      const shape = new THREE.Shape();
      shape.moveTo((p.x - L.PW / 2) * S, baseV * S); shape.lineTo((p.x + L.PW / 2) * S, baseV * S); shape.lineTo(p.x * S, tipV * S); shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(Math.PI / 2);
      const m = new THREE.MeshBasicMaterial({ color: 0xffd66e, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.y = TY - 0.0112;
      b.add(mesh);
      this.glow.push(mesh); this.glowMat.push(m);
    }
    const gm = () => new THREE.MeshBasicMaterial({ color: 0x8affb0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.trayGlow = new THREE.Mesh(new THREE.PlaneGeometry(T, Hd / 2), gm());
    this.trayGlow.rotation.x = -Math.PI / 2;
    this.trayGlow.position.y = TY - 0.01;
    b.add(this.trayGlow);
    this.barGlow = new THREE.Mesh(new THREE.PlaneGeometry(L.B * S, Hd), gm());
    this.barGlow.rotation.x = -Math.PI / 2;
    this.barGlow.position.y = TY - 0.0095;
    b.add(this.barGlow);
  }

  private buildLamp(shadowSize: number) {
    const s = this.scene;
    const brass = new THREE.MeshStandardMaterial({ color: 0xb8924c, metalness: 1, roughness: 0.3 });
    const LY = TY + 1.15;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 3.2 - LY, 8), brass);
    rod.position.set(0, (3.2 + LY) / 2, 0);
    s.add(rod);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.26, 0.17, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x0d3a26, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }));
    shade.position.set(0, LY + 0.05, 0);
    s.add(shade);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.256, 0.168, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1d0, side: THREE.BackSide }));
    inner.position.copy(shade.position);
    s.add(inner);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe6b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    glow.scale.set(0.7, 0.7, 1);
    glow.position.set(0, LY - 0.02, 0);
    s.add(glow);
    const spot = new THREE.SpotLight(0xffe4b8, LAMP, 0, 0.75, 0.6, 2);
    spot.position.set(0, LY, 0.02);
    spot.target.position.set(0, TY, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(shadowSize, shadowSize);
    spot.shadow.bias = -0.00015;
    spot.shadow.normalBias = 0.004;
    spot.shadow.camera.near = 0.4; spot.shadow.camera.far = 2.5;
    s.add(spot, spot.target);
  }

  // ───────────────────────── фишки и кости ─────────────────────────

  private buildCheckers() {
    // профиль: скруглённый бортик и плоский верх
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
    const r = CR, h = CH, e = 0.0022;
    pts.push(new THREE.Vector2(r - e, 0));
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(r - e + Math.cos(a) * e, e + Math.sin(a) * e)); }
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(r - e + Math.cos(a) * e, h - e + Math.sin(a) * e)); }
    pts.push(new THREE.Vector2(r * 0.9, h), new THREE.Vector2(r * 0.86, h - 0.0008));
    this.chkGeo = new THREE.LatheGeometry(pts, 48);
    this.topGeo = new THREE.CircleGeometry(r * 0.86, 48);
    this.topGeo.rotateX(-Math.PI / 2);
    this.topGeo.translate(0, h - 0.0007, 0);
    for (const side of [0, 1] as const) for (let k = 0; k < 15; k++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.chkGeo, this.sideMat(side));
      const top = new THREE.Mesh(this.topGeo, this.topMat(side));
      body.castShadow = true; body.receiveShadow = true;
      g.add(body, top);
      g.visible = false;
      this.board.add(g);
      this.chks.push({ side, g, spot: null, k: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0.4, arc: 0, tray: false, lift: 0 });
    }
  }

  private sideMat(side: number) {
    const k = this.checkerSet + side;
    if (!this.sideMats[k]) {
      const c = CHECKER[this.checkerSet] || CHECKER.classic;
      this.sideMats[k] = new THREE.MeshPhysicalMaterial({ color: side ? c.dark : c.light, roughness: c.metal ? 0.22 : 0.35, metalness: c.metal ? 0.9 : 0, clearcoat: c.metal ? 0 : 0.8, clearcoatRoughness: 0.15, envMapIntensity: c.metal ? 1.3 : 0.6 });
    }
    return this.sideMats[k];
  }
  private topMat(side: number) {
    const k = this.checkerSet + side;
    if (!this.topMats[k]) {
      const c = CHECKER[this.checkerSet] || CHECKER.classic;
      const t = new THREE.CanvasTexture(checkerTop(this.checkerSet, side === 1));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      this.topMats[k] = new THREE.MeshPhysicalMaterial({ map: t, roughness: c.metal ? 0.22 : 0.3, metalness: c.metal ? 0.85 : 0, clearcoat: c.metal ? 0 : 1, clearcoatRoughness: 0.12, envMapIntensity: c.metal ? 1.3 : 0.6 });
    }
    return this.topMats[k];
  }

  private buildDice() {
    const geo = new RoundedBoxGeometry(DS, DS, DS, 3, DS * 0.16);
    for (let i = 0; i < 2; i++) {
      const mats = FACE_VAL.map(() => new THREE.MeshPhysicalMaterial({ roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.8 }));
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = true;
      mesh.visible = false;
      this.board.add(mesh);
      this.dice.push({ mesh, mats, value: 1, t: 1, dur: 1, p0: new THREE.Vector3(), p1: new THREE.Vector3(), q0: new THREE.Quaternion(), q1: new THREE.Quaternion(), used: false, set: '', spin: new THREE.Vector3() });
    }
  }

  private dieSet(d: Die, set: string) {
    if (d.set === set) return;
    d.set = set;
    const ds = DICE[set] || DICE.ivory;
    d.mats.forEach((m, i) => {
      const t = new THREE.CanvasTexture(diceFace(set, FACE_VAL[i]));
      t.colorSpace = THREE.SRGBColorSpace;
      m.map?.dispose();
      m.map = t;
      m.metalness = ds.metal ? 0.85 : 0;
      m.roughness = ds.metal ? 0.25 : 0.28;
      m.transparent = !!ds.glass;
      m.opacity = ds.glass ? 0.88 : 1;
      m.needsUpdate = true;
    });
  }

  // ───────────────────────── соперник напротив ─────────────────────────

  private buildFigure() {
    const wool = woolTextures(256);
    wool.map.repeat.set(4, 4); wool.bump.repeat.set(4, 4);
    const suit = new THREE.MeshPhysicalMaterial({ map: wool.map, bumpMap: wool.bump, bumpScale: 1.2, color: 0x17171c, roughness: 0.84, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0x3c4054), envMapIntensity: 0.3 });
    const skin = new THREE.MeshPhysicalMaterial({ color: 0x5a3626, roughness: 0.58, envMapIntensity: 0.2, sheen: 0.6, sheenColor: new THREE.Color(0xc08068) });
    const shirt = new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.72 });
    const hat = new THREE.MeshStandardMaterial({ color: 0x141214, roughness: 0.7 });
    const band = new THREE.MeshStandardMaterial({ color: 0x6e0f18, roughness: 0.5 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x15100e, roughness: 0.45 });
    const f = this.figure, body = new THREE.Group();
    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = body) => { const x = new THREE.Mesh(g, m); x.castShadow = true; parent.add(x); return x; };
    const pts: [number, number][] = [[0.15, 0], [0.156, 0.1], [0.172, 0.22], [0.198, 0.33], [0.212, 0.39], [0.2, 0.44], [0.15, 0.475], [0.08, 0.497], [0.046, 0.505]];
    const tg = new THREE.LatheGeometry(new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r * 1.04, y))).getPoints(40), 48);
    tg.scale(1.25, 1, 0.62);
    tg.rotateX(-0.12);
    add(tg, suit);
    add(new THREE.CylinderGeometry(0.05, 0.056, 0.03, 18, 1, true).translate(0, 0.505, -0.02), shirt);
    add(new THREE.CylinderGeometry(0.044, 0.05, 0.09, 14).translate(0, 0.54, -0.02), skin);
    const head = this.figHead;
    head.position.set(0, 0.55, -0.02);
    const hg = new THREE.SphereGeometry(0.092, 32, 24); hg.scale(0.86, 1.14, 1);
    add(hg.translate(0, 0.1, -0.02), skin, head);
    add(new THREE.CylinderGeometry(0.165, 0.17, 0.008, 40).translate(0, 0.17, -0.01), hat, head);
    add(new THREE.CylinderGeometry(0.08, 0.098, 0.1, 32).translate(0, 0.22, -0.01), hat, head);
    add(new THREE.CylinderGeometry(0.0985, 0.1, 0.022, 32, 1, true).translate(0, 0.183, -0.01), band, head);
    body.add(head);
    for (const sx of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(sx * 0.18, 0.4, 0.03), new THREE.Vector3(sx * 0.26, 0.22, -0.12), new THREE.Vector3(sx * 0.12, 0.2, -0.34)]);
      add(new THREE.TubeGeometry(curve, 24, 0.05, 12, false), suit);
      add(new THREE.SphereGeometry(0.04, 16, 12).scale(0.8, 0.45, 1.25).translate(sx * 0.1, 0.2, -0.39), glove);
    }
    f.add(body);
    f.position.set(0, TY - 0.3, -1.0);
    f.rotation.y = 0;
    this.scene.add(f);
  }

  // ───────────────────────── интерфейс доски ─────────────────────────

  setSide(side: number) {
    if (side === this.side) return;
    this.side = side;
    this.board.rotation.y = side === 1 ? Math.PI : 0;
    // фишки: «свои» всегда светлые на своём экране
    this.recolor();
  }

  private recolor() {
    for (const c of this.chks) {
      const mine = c.side === this.side;
      const look = mine ? 0 : 1;
      (c.g.children[0] as THREE.Mesh).material = this.sideMat(look);
      (c.g.children[1] as THREE.Mesh).material = this.topMat(look);
    }
  }

  setLooks(checkers: string, boardId: string) {
    if (checkers !== this.checkerSet) { this.checkerSet = checkers; this.recolor(); }
    if (boardId !== this.boardId) {
      this.boardId = boardId;
      const look = boardLook(boardId);
      const ft = new THREE.CanvasTexture(fieldCanvas(boardId));
      ft.colorSpace = THREE.SRGBColorSpace; ft.anisotropy = 8;
      this.fieldMat.map?.dispose(); this.fieldMat.map = ft; this.fieldMat.needsUpdate = true;
      this.frameMat.map?.dispose(); this.frameMat.map = woodTexture(look.wood, look.woodDark); this.frameMat.needsUpdate = true;
    }
  }

  /** место фишки на доске в координатах группы доски */
  private place(side: number, spot: Spot, k: number, variant: 'long' | 'short'): { p: THREE.Vector3; tray: boolean } {
    let s: { x: number; v: number; layer: number };
    if (spot === 24) s = traySlot(side, k, variant);
    else if (spot === -1) s = barSlot(side, k);
    else s = slot(spot, k);
    const tray = spot === 24;
    const y = tray ? TY - 0.0116 + CR * 0.98 : TY - 0.0116 + s.layer * CH;
    return { p: new THREE.Vector3(s.x * S, y, s.v * S), tray };
  }

  setPosition(pos: Position, instant = false) {
    this.variant = pos.variant;
    // сколько фишек каждой стороны должно быть в каждом месте
    const want = (side: 0 | 1) => {
      const m = new Map<Spot, number>();
      pos.board.forEach((v, i) => { const n = side === 0 ? Math.max(0, v) : Math.max(0, -v); if (n) m.set(i, n); });
      if (pos.bar[side]) m.set(-1, pos.bar[side]);
      if (pos.off[side]) m.set(24, pos.off[side]);
      return m;
    };
    let moved = 0, hit = false;
    for (const side of [0, 1] as const) {
      const need = want(side);
      const mine = this.chks.filter(c => c.side === side);
      const have = new Map<Spot, Chk[]>();
      for (const c of mine) if (c.spot !== null) { const a = have.get(c.spot) || []; a.push(c); have.set(c.spot, a); }
      const free: Chk[] = mine.filter(c => c.spot === null);
      // лишние — со своих мест (сверху стопки)
      for (const [spot, list] of have) {
        list.sort((a, b) => a.k - b.k);
        const n = need.get(spot) || 0;
        while (list.length > n) free.push(list.pop()!);
      }
      // недостающие — из свободных
      for (const [spot, n] of need) {
        const list = have.get(spot) || [];
        while (list.length < n && free.length) {
          const c = free.shift()!;
          if (c.spot !== null) { moved++; if (spot === -1) hit = true; }
          c.spot = spot;
          list.push(c);
        }
        have.set(spot, list);
      }
      for (const c of free) { c.spot = null; c.g.visible = false; }
      // раскладка по местам
      for (const [spot, list] of have) {
        list.forEach((c, k) => {
          const { p, tray } = this.place(side, spot, k, pos.variant);
          const wasHidden = !c.g.visible;
          c.k = k;
          c.tray = tray;
          if (instant || wasHidden) { c.g.position.copy(p); c.from.copy(p); c.to.copy(p); c.t = 1; c.g.visible = true; return; }
          if (c.to.distanceTo(p) < 1e-5) return;
          c.from.copy(c.g.position);
          c.to.copy(p);
          const far = c.from.distanceTo(p);
          c.t = 0;
          c.dur = Math.min(0.75, 0.22 + far * 0.9);
          c.arc = far > 0.03 ? Math.min(0.07, 0.02 + far * 0.12) : 0;
          c.g.visible = true;
        });
      }
    }
    if (moved && !instant) setTimeout(() => this.soundCbs.forEach(f => f(hit ? 'hit' : 'checker', 1)), 380);
  }

  setDice(values: number[], left: number[], side: number, set: string, throwIt: boolean) {
    const show = values.length > 0;
    const remaining = [...left];
    this.dice.forEach((d, i) => {
      d.mesh.visible = show;
      if (!show) return;
      this.dieSet(d, set);
      const v = values[i];
      // кость «сыграна», если её значения больше нет среди оставшихся
      const ix = remaining.indexOf(v);
      d.used = ix < 0;
      if (ix >= 0) remaining.splice(ix, 1);
      if (values[0] === values[1]) d.used = i === 0 ? left.length <= 2 : left.length === 0;
      // куда ложится: правая половина со стороны бросавшего
      const sgn = side === 0 ? 1 : -1;
      const p1 = new THREE.Vector3(sgn * (L.W / 4 + (i - 0.5) * 0.09) * S, TY - 0.0116 + DS / 2, sgn * ((i - 0.5) * 0.05) * S);
      const q1 = faceUp(v).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i ? 0.35 : -0.25) + Math.sin(v * 7 + i) * 0.3));
      if (throwIt || v !== d.value || !d.mesh.visible) {
        d.value = v;
        if (throwIt) {
          d.p0.set(sgn * (L.W / 2 - 0.05) * S, TY + 0.12, sgn * (0.2 + i * 0.05) * S);
          d.q0.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
          d.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
          d.t = 0; d.dur = 0.95 + i * 0.12;
          setTimeout(() => this.soundCbs.forEach(f => f('dice', 1)), 260);
          setTimeout(() => this.soundCbs.forEach(f => f('dice', 0.6)), 560);
        } else { d.t = 1; d.mesh.position.copy(p1); d.mesh.quaternion.copy(q1); }
      }
      d.p1.copy(p1); d.q1.copy(q1);
    });
  }

  highlight(h: Highlight) { this.hl = h; }

  pick(sx: number, sy: number): Spot | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hitP = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, hitP)) return null;
    const local = this.board.worldToLocal(hitP.clone());
    return pickSpot(local.x / S, local.z / S, this.variant, this.side);
  }

  toScreen(spot: Spot, side: number) {
    const { p } = this.place(side, spot, 0, this.variant);
    const w = this.board.localToWorld(p.clone()).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((w.x + 1) / 2) * r.width, y: r.top + ((1 - w.y) / 2) * r.height };
  }

  setLobby(on: boolean) { this.lobby = on; }
  onFrame(cb: (dt: number) => void) { this.frameCbs.push(cb); }
  onLowPower(cb: (low: boolean) => void) { this.lowCbs.push(cb); }
  onSound(cb: (k: 'checker' | 'dice' | 'hit', v: number) => void) { this.soundCbs.push(cb); }

  // ───────────────────────── кадр ─────────────────────────

  private resize() {
    const w = this.el.clientWidth || innerWidth, h = this.el.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 50 : 38;
    this.camera.updateProjectionMatrix();
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const t = this.t;
    // фишки: перелёт дугой или скольжение
    const h = this.hl;
    for (const c of this.chks) {
      if (!c.g.visible) continue;
      if (c.t < 1) {
        c.t = Math.min(1, c.t + dt / c.dur);
        const e = c.t < 0.5 ? 4 * c.t ** 3 : 1 - (-2 * c.t + 2) ** 3 / 2;
        c.g.position.lerpVectors(c.from, c.to, e);
        c.g.position.y += Math.sin(Math.PI * c.t) * c.arc;
      }
      // выбранная фишка (верхняя в стопке) приподнята
      const top = c.spot !== null && c.side === this.side && c.spot === h.sel && this.isTop(c);
      c.lift += ((top ? 0.012 : 0) - c.lift) * Math.min(1, dt * 12);
      c.g.children.forEach(m => (m.position.y = c.lift));
      c.g.rotation.x = c.tray ? Math.PI / 2 : 0;
      if (c.tray) c.g.rotation.z = 0;
    }
    // кости
    for (const d of this.dice) {
      if (!d.mesh.visible) continue;
      if (d.t < 1) {
        d.t = Math.min(1, d.t + dt / d.dur);
        const k = d.t;
        const e = 1 - (1 - k) ** 3;
        d.mesh.position.lerpVectors(d.p0, d.p1, e);
        // подскоки
        const bounce = Math.abs(Math.sin(k * Math.PI * 3.2)) * (1 - k) ** 1.6 * 0.07;
        d.mesh.position.y = THREE.MathUtils.lerp(d.p0.y, d.p1.y, Math.min(1, k * 2.2)) + bounce;
        const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(d.spin.x * (1 - e), d.spin.y * (1 - e), d.spin.z * (1 - e)));
        d.mesh.quaternion.slerpQuaternions(d.q0, d.q1, Math.min(1, e * 1.15)).premultiply(spin);
        if (k >= 1) { d.mesh.position.copy(d.p1); d.mesh.quaternion.copy(d.q1); }
      }
      for (const m of d.mats) { const want = d.used ? 0.35 : 1; m.color.setScalar(m.color.r + (want - m.color.r) * Math.min(1, dt * 6)); }
    }
    // подсветка пунктов
    for (let i = 0; i < 24; i++) {
      const m = this.glowMat[i];
      const to = h.to.includes(i), sel = h.sel === i, from = h.from.includes(i);
      const want = to ? 0.42 + Math.sin(t * 5) * 0.12 : sel ? 0.4 : from ? 0.13 + Math.sin(t * 3 + i) * 0.05 : 0;
      if (to) m.color.set(0x7affb0); else m.color.set(0xffd66e);
      m.opacity += (want - m.opacity) * Math.min(1, dt * 10);
    }
    const tm = this.trayGlow.material as THREE.MeshBasicMaterial;
    const right = this.side === 0 || this.variant === 'short';
    this.trayGlow.position.set((right ? 1 : -1) * (L.W / 2 + L.FRAME + L.TRAY / 2) * S, TY - 0.0105, (this.side === 0 ? 1 : -1) * L.H / 4 * S);
    tm.opacity += ((h.to.includes(24) ? 0.4 + Math.sin(t * 5) * 0.12 : 0) - tm.opacity) * Math.min(1, dt * 10);
    const bm = this.barGlow.material as THREE.MeshBasicMaterial;
    bm.color.set(0xffd66e);
    bm.opacity += ((h.from.includes(-1) || h.sel === -1 ? 0.25 + Math.sin(t * 4) * 0.08 : 0) - bm.opacity) * Math.min(1, dt * 10);
    // соперник дышит и посматривает на доску
    this.figHead.rotation.x = 0.35 + Math.sin(t * 0.5) * 0.04;
    this.figHead.rotation.y = Math.sin(t * 0.31) * 0.15;
    this.updateCamera(dt, t);
    for (const cb of this.frameCbs) cb(dt);
    this.renderer.render(this.scene, this.camera);
    this.perf(now);
  }

  private isTop(c: Chk) {
    let max = -1;
    for (const o of this.chks) if (o.side === c.side && o.spot === c.spot && o.g.visible) max = Math.max(max, o.k);
    return c.k === max;
  }

  private updateCamera(dt: number, t: number) {
    const portrait = this.camera.aspect < 1;
    if (this.lobby) {
      this.orbit += dt * 0.07;
      const r = portrait ? 2.3 : 1.9;
      this.wantPos.set(Math.sin(this.orbit) * r, TY + 0.95, Math.cos(this.orbit) * r);
      this.wantLook.set(0, TY - 0.05, 0);
      this.camera.up.set(0, 1, 0);
    } else if (portrait) {
      // сверху, доска вдоль экрана
      const fit = 0.98 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.62;
      this.wantPos.set(0.0001, TY + Math.max(0.95, fit), 0.0001);
      this.wantLook.set(0, TY, 0);
      this.camera.up.set(-1, 0, 0);
    } else {
      const a = this.camera.aspect;
      const k = a < 1.45 ? 1.18 : 1;
      this.wantPos.set(Math.sin(t * 0.11) * 0.015, TY + 0.78 * k, 0.6 * k);
      this.wantLook.set(0, TY - 0.03, 0.03);
      this.camera.up.set(0, 1, 0);
    }
    const kk = 1 - Math.pow(this.lobby ? 0.5 : 0.02, dt);
    this.camPos.lerp(this.wantPos, kk);
    this.camLook.lerp(this.wantLook, kk);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  private perf(now: number) {
    this.frames++;
    if (now - this.winStart < 2000) return;
    const fps = (this.frames * 1000) / (now - this.winStart);
    this.frames = 0; this.winStart = now;
    if (fps < 38 && this.dpr > this.minDpr) {
      this.dpr = Math.max(this.minDpr, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.resize();
    }
    const low = fps < 32;
    if (low !== this.low) { this.low = low; for (const cb of this.lowCbs) cb(low); }
  }
}

// ───────────────────────── мелочи ─────────────────────────

/** поворот кости так, чтобы значение n смотрело вверх */
function faceUp(n: number): THREE.Quaternion {
  const e: Record<number, THREE.Euler> = {
    1: new THREE.Euler(0, 0, Math.PI / 2), 6: new THREE.Euler(0, 0, -Math.PI / 2), 2: new THREE.Euler(0, 0, 0),
    5: new THREE.Euler(Math.PI, 0, 0), 3: new THREE.Euler(-Math.PI / 2, 0, 0), 4: new THREE.Euler(Math.PI / 2, 0, 0),
  };
  return new THREE.Quaternion().setFromEuler(e[n] || e[2]);
}

function woodTexture(base: string, dark: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d')!;
  woodFill(g, 0, 0, 1024, 256, base, dark);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  t.anisotropy = 8;
  return t;
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,240,210,1)'); grd.addColorStop(0.25, 'rgba(255,210,150,0.5)'); grd.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function clubEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x0a0605);
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0d0).multiplyScalar(14) }));
  lamp.rotation.x = Math.PI / 2;
  lamp.position.set(0, 1.0, 0);
  env.add(lamp);
  env.add(new THREE.Mesh(new THREE.BoxGeometry(9, 4, 9), new THREE.MeshBasicMaterial({ color: 0x3a2214, side: THREE.BackSide })));
  const sconce = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb070).multiplyScalar(3) });
  for (const [x, z] of [[-2, -4], [2, -4], [-4, 1.5], [4, 1.5]]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), sconce);
    m.position.set(x, 1.2, z);
    env.add(m);
  }
  return env;
}
