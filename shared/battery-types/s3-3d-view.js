// ======================================================================
// shared/battery-types/s3-3d-view.js (v0.59.442)
// Настоящий 3D-вид сборки шкафов S³ на Three.js с OrbitControls.
//
// API:
//   mountS3ThreeDView(container, spec, { height = 520, modelInfo } = {})
//     → { dispose() }
//
// v0.59.442:
//   - крупное окно по умолчанию (520 px) + кнопка «⛶ Развернуть» (модалка
//     на весь экран с тем же canvas).
//   - над модулями каждого master/slave — модуль с автоматами защиты
//     (DC SPD), 1 автомат у slave, 2 автомата у master (User Manual S³).
//   - настройки фона (небо/тёмный/белый) и плоскости (серая 600/300/100 мм
//     или скрыта). По умолчанию — небо + серая плоскость + 600×600 мм.
// ======================================================================

let _threePromise = null;
function loadThree() {
  if (_threePromise) return _threePromise;
  _threePromise = (async () => {
    const tryLoad = async (base) => {
      const T = await import(/* @vite-ignore */ `${base}/three@0.160.0`);
      const o = await import(/* @vite-ignore */ `${base}/three@0.160.0/examples/jsm/controls/OrbitControls.js`);
      return { THREE: T, OrbitControls: o.OrbitControls };
    };
    try { return await tryLoad('https://esm.sh'); }
    catch (e1) {
      try { return await tryLoad('https://esm.run'); }
      catch (e2) { throw e2; }
    }
  })();
  return _threePromise;
}

// Текстура перфорированной двери.
function makePerforatedTexture(THREE, w = 256, h = 768) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#2a2d33');
  grad.addColorStop(1, '#1a1c22');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0a0b0e';
  const step = 8, r = 1.6;
  for (let y = step; y < h - step; y += step) {
    const off = (Math.floor(y / step) % 2) ? step / 2 : 0;
    for (let x = step + off; x < w - step; x += step) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeCombinerTexture(THREE, w = 256, h = 768) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3f48';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1a1c22';
  for (let i = 0; i < 8; i++) {
    const y = 20 + i * (h - 40) / 7;
    ctx.beginPath(); ctx.arc(12, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w - 12, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#c97a2a';
  ctx.fillRect(40, h * 0.30, w - 80, 18);
  ctx.fillRect(40, h * 0.42, w - 80, 18);
  ctx.fillRect(40, h * 0.54, w - 80, 18);
  ctx.fillStyle = '#e6e8ee';
  ctx.font = 'bold 18px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('DC BUS', w / 2, h * 0.20);
  ctx.font = '12px system-ui';
  ctx.fillText('COMBINER', w / 2, h * 0.78);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Раскладка модулей.
function moduleLayout(maxPerCabinet, modelHint) {
  const m = String(modelHint || '');
  if (/100/.test(m)) return { cols: 1, rows: 12 };
  if (/040|050/.test(m)) return { cols: 2, rows: 11 };
  if (maxPerCabinet > 12) {
    const rows = Math.ceil(maxPerCabinet / 2);
    return { cols: 2, rows };
  }
  return { cols: 1, rows: Math.max(8, maxPerCabinet) };
}

// Полка-модуль АКБ.
function buildModuleMesh(THREE, w, h, d, opts = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color: opts.empty ? 0x2c2e34 : 0x3d4855,
      metalness: 0.55,
      roughness: 0.5,
      opacity: opts.empty ? 0.55 : 1,
      transparent: !!opts.empty,
    }),
  );
  g.add(body);
  if (!opts.empty) {
    const c = document.createElement('canvas');
    c.width = 192; c.height = 48;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3d4855'; ctx.fillRect(0, 0, 192, 48);
    ctx.fillStyle = '#0a0b0e';
    for (let y = 4; y < 44; y += 4) {
      for (let x = 6; x < 150; x += 4) {
        ctx.fillRect(x, y, 1.2, 1.2);
      }
    }
    ctx.fillStyle = '#1a1c22';
    ctx.fillRect(160, 14, 22, 20);
    ctx.fillStyle = '#7bd88f';
    ctx.fillRect(154, 18, 4, 4);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.97, h * 0.92),
      new THREE.MeshStandardMaterial({ map: tex, metalness: 0.3, roughness: 0.7 }),
    );
    front.position.set(0, 0, d / 2 + 0.0008);
    g.add(front);
  } else {
    const mat = new THREE.MeshBasicMaterial({ color: 0x4a4f58 });
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.004, 0.001), mat);
    r1.position.set(0, 0, d / 2 + 0.001);
    g.add(r1);
  }
  return g;
}

// v0.59.442: модуль с автоматами защиты DC (над АКБ-модулями).
// 1 автомат у slave (1 строка), 2 автомата у master (2 строки)
// — по эскизам User Manual S³.
function buildBreakerPanel(THREE, w, d, breakerCount) {
  const g = new THREE.Group();
  // высота панели ~120 мм
  const h = 0.12;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x3a3f48, metalness: 0.45, roughness: 0.55,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
  g.add(body);
  // фронтальная пластина с автоматами (canvas-текстура)
  const c = document.createElement('canvas');
  c.width = 384; c.height = 96;
  const ctx = c.getContext('2d');
  // фон панели (металл со штриховкой)
  const grad = ctx.createLinearGradient(0, 0, 0, 96);
  grad.addColorStop(0, '#4a4f58');
  grad.addColorStop(1, '#3a3f48');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 384, 96);
  // винты по углам
  ctx.fillStyle = '#1a1c22';
  for (const [x, y] of [[12, 12], [372, 12], [12, 84], [372, 84]]) {
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // автоматы (DC MCB-style: серое тело + белый рычажок-«флажок»)
  const breakers = Math.max(1, Math.min(2, breakerCount | 0));
  const totalW = 384;
  // распределение: 1 → справа (slave), 2 → слева+справа (master)
  const positions = breakers === 1 ? [totalW * 0.72] : [totalW * 0.28, totalW * 0.72];
  for (const cx of positions) {
    const bw = 56, bh = 48;
    const bx = cx - bw / 2, by = 24;
    // корпус автомата
    ctx.fillStyle = '#1d2026';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#0a0b0e';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, bw, bh);
    // окно «I/O» (рычажок) — белый прямоугольник
    ctx.fillStyle = '#e6e8ee';
    ctx.fillRect(bx + bw / 2 - 9, by + bh / 2 - 7, 18, 14);
    // подпись
    ctx.fillStyle = '#cfd3dc';
    ctx.font = 'bold 8px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('DC', cx, by + 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.97, h * 0.92),
    new THREE.MeshStandardMaterial({ map: tex, metalness: 0.3, roughness: 0.65 }),
  );
  front.position.set(0, 0, d / 2 + 0.001);
  g.add(front);
  return g;
}

function buildCabinet(THREE, role, opts) {
  const W = 0.6, D = 0.85, H = 2.0;
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x4a4f58, metalness: 0.5, roughness: 0.55, side: THREE.DoubleSide,
  });
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0x2a2c30, metalness: 0.4, roughness: 0.7, side: THREE.DoubleSide,
  });
  const t = 0.012;
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, t), innerMat);
  back.position.set(0, H / 2, -D / 2 + t / 2); group.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(t, H, D), bodyMat);
  left.position.set(-W / 2 + t / 2, H / 2, 0); group.add(left);
  const right = new THREE.Mesh(new THREE.BoxGeometry(t, H, D), bodyMat);
  right.position.set(W / 2 - t / 2, H / 2, 0); group.add(right);
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, t, D), bodyMat);
  top.position.set(0, H - t / 2, 0); group.add(top);
  const bot = new THREE.Mesh(new THREE.BoxGeometry(W, t, D), bodyMat);
  bot.position.set(0, t / 2, 0); group.add(bot);

  // === модули + панель автоматов (для master/slave) ===
  if (role === 'master' || role === 'slave') {
    const lay = opts.layout || { cols: 2, rows: 11 };
    const filled = Math.max(0, opts.modulesInCabinet || 0);
    const innerW = W - 2 * t - 0.04;
    // v0.59.442: резервируем 0.16 м под панель автоматов сверху
    // и 0.06 м под верхний короб контроллера
    const breakerH = 0.12;
    const reservedTop = breakerH + 0.10;
    const innerH = H - 2 * t - reservedTop;
    const innerD = D - 2 * t - 0.04;
    const modH = innerH / lay.rows * 0.92;
    const modGap = innerH / lay.rows * 0.08;
    const modW = innerW / lay.cols * 0.95;
    const modD = innerD * 0.92;
    const startY = t + modH / 2;
    const startX = -innerW / 2 + modW / 2;
    for (let r = 0; r < lay.rows; r++) {
      for (let c = 0; c < lay.cols; c++) {
        const rTop = (lay.rows - 1 - r);
        const idxTop = rTop * lay.cols + c;
        const isFilled = idxTop < filled;
        const m = buildModuleMesh(THREE, modW, modH, modD, { empty: !isFilled });
        m.position.set(
          startX + c * (innerW / lay.cols),
          startY + r * (modH + modGap),
          0,
        );
        group.add(m);
      }
    }
    // v0.59.443: число автоматов зависит от ёмкости модуля
    // (по эскизам User Manual): 100 А·ч → 1 автомат; 40/50 А·ч → 2 автомата.
    const isHundredAh = Number(opts.capacityAh) === 100;
    const breakerCount = isHundredAh ? 1 : 2;
    const panel = buildBreakerPanel(THREE, innerW, innerD * 0.7, breakerCount);
    panel.position.set(0, t + innerH + breakerH / 2 + 0.02, 0);
    group.add(panel);
  }

  // дверь
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-W / 2 + 0.005, H / 2, D / 2 + 0.002);
  group.add(doorPivot);

  let frontTex;
  if (role === 'combiner') {
    frontTex = makeCombinerTexture(THREE);
  } else {
    frontTex = opts._sharedPerfTex || makePerforatedTexture(THREE);
    opts._sharedPerfTex = frontTex;
  }
  const doorMat = new THREE.MeshStandardMaterial({
    map: frontTex, metalness: 0.3, roughness: 0.7, side: THREE.DoubleSide,
    transparent: true, opacity: 0.92,
  });
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.96, H * 0.96),
    doorMat,
  );
  door.position.set(W * 0.96 / 2, 0, 0);
  doorPivot.add(door);
  if (opts.collectDoor) opts.collectDoor(doorPivot, role);

  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x2a2c30, metalness: 0.7, roughness: 0.4,
  });
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.35, 12),
    handleMat,
  );
  handle.position.set(W * 0.92, 0, 0.025);
  doorPivot.add(handle);
  for (const dy of [-0.18, 0.18]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, 0.05), handleMat);
    m.position.set(W * 0.92, dy, 0.012);
    doorPivot.add(m);
  }

  if (role === 'master') {
    const screenBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.13, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x121418, metalness: 0.3, roughness: 0.6 }),
    );
    screenBase.position.set(W * 0.18, H * 0.33, 0.008);
    doorPivot.add(screenBase);
    const screenGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.10),
      new THREE.MeshBasicMaterial({ color: 0x4a8eff }),
    );
    screenGlow.position.set(W * 0.18, H * 0.33, 0.015);
    doorPivot.add(screenGlow);
  } else if (role === 'slave') {
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x7bd88f }),
    );
    led.position.set(W * 0.18, H * 0.33, 0.012);
    doorPivot.add(led);
  }

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(W * 1.02, 0.04, D * 1.02),
    new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.6, roughness: 0.5 }),
  );
  base.position.set(0, 0.02, 0);
  group.add(base);

  if (opts.label) {
    const sprite = makeLabelSprite(THREE, opts.label, opts.subLabel);
    sprite.position.set(0, H + 0.18, 0);
    group.add(sprite);
  }
  return group;
}

function makeLabelSprite(THREE, text, sub) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,22,28,0.85)';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#3a3f48';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 510, 126);
  ctx.fillStyle = '#e6e8ee';
  ctx.font = 'bold 36px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, sub ? 48 : 64);
  if (sub) {
    ctx.font = '24px system-ui';
    ctx.fillStyle = '#8a93a6';
    ctx.fillText(sub, 256, 92);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.7, 0.18, 1);
  return sp;
}

// v0.59.442: текстура неба (вертикальный градиент).
function makeSkyTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#7ec1ff'); // зенит
  g.addColorStop(0.55, '#cbe4f7');
  g.addColorStop(1.0, '#f4f8fc');  // у горизонта
  ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export async function mountS3ThreeDView(container, spec, opts = {}) {
  if (!container) return { dispose() {} };
  container.innerHTML = '';
  const ph = document.createElement('div');
  ph.style.cssText = 'padding:14px;color:#888;font-size:12px;text-align:center';
  ph.textContent = 'Загрузка 3D-вида (Three.js)…';
  container.appendChild(ph);

  let mod;
  try { mod = await loadThree(); }
  catch (e) {
    ph.textContent = '⚠ Не удалось загрузить Three.js (нужен интернет). 3D-вид недоступен.';
    return { dispose() { container.innerHTML = ''; } };
  }
  const { THREE, OrbitControls } = mod;
  container.removeChild(ph);

  // v0.59.443: компоновка — слева 3D, справа 2D top-view (минимум 220 px).
  // По умолчанию высота 480 px (было 520, но из-за широкого canvas высота
  // казалась маленькой). При узком контейнере 2D-вид прячется под 3D.
  const height = opts.height || 480;
  const root = document.createElement('div');
  root.style.cssText = `display:flex;flex-wrap:wrap;gap:8px;width:100%`;
  container.appendChild(root);

  const wrap = document.createElement('div');
  wrap.style.cssText =
    `position:relative;flex:1 1 480px;min-width:320px;height:${height}px;` +
    `border:1px solid #2a2f3a;border-radius:8px;overflow:hidden`;
  root.appendChild(wrap);

  // 2D top-view (план)
  const view2d = document.createElement('div');
  view2d.style.cssText =
    `flex:0 1 260px;min-width:220px;height:${height}px;border:1px solid #2a2f3a;` +
    `border-radius:8px;background:#f7f8fb;padding:10px;box-sizing:border-box;` +
    `overflow:auto;font:11px system-ui;color:#1a2a44`;
  root.appendChild(view2d);

  // подсказка
  const hint = document.createElement('div');
  hint.style.cssText =
    'position:absolute;left:8px;top:8px;font:11px system-ui;color:#1a2a44;' +
    'background:rgba(255,255,255,0.75);padding:3px 7px;border-radius:4px;pointer-events:none;z-index:2';
  hint.innerHTML = '🖱 ЛКМ — вращать · колесо — зум · ПКМ — панорама';
  wrap.appendChild(hint);

  // легенда
  const legend = document.createElement('div');
  legend.style.cssText =
    'position:absolute;right:8px;top:8px;font:11px system-ui;color:#1a2a44;' +
    'background:rgba(255,255,255,0.78);padding:6px 9px;border-radius:4px;line-height:1.5;z-index:2';
  const cabs = spec.cabinets || [];
  const counts = { master: 0, slave: 0, combiner: 0 };
  for (const c of cabs) counts[c.role] = (counts[c.role] || 0) + 1;
  legend.innerHTML =
    `<b>${cabs.length}</b> шкаф(ов): ` +
    (counts.master ? `<span style="color:#1f5fcf">●</span> ${counts.master} master ` : '') +
    (counts.slave  ? `<span style="color:#2c8a4a">●</span> ${counts.slave} slave ` : '') +
    (counts.combiner ? `<span style="color:#a85a18">●</span> ${counts.combiner} combiner` : '');
  wrap.appendChild(legend);

  const scene = new THREE.Scene();

  // === фон / плоскость ===
  const skyTex = makeSkyTexture(THREE);

  function applyBackground(kind) {
    if (kind === 'sky') {
      scene.background = skyTex;
    } else if (kind === 'dark') {
      scene.background = new THREE.Color(0x0e1014);
    } else if (kind === 'white') {
      scene.background = new THREE.Color(0xf4f6fa);
    } else {
      scene.background = null;
    }
  }

  // освещение
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8c8ff, 0.35);
  fill.position.set(-3, 2, -2);
  scene.add(fill);

  // плоскость (пол) + сетка
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.95, metalness: 0.0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // сетка с шагом 0.6 м (600 мм). 40 м × 40 м → 67 делений ≈ округлим до 60.
  let gridHelper = null;
  function rebuildGrid(stepMm) {
    if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); }
    if (!stepMm) { gridHelper = null; return; }
    const stepM = stepMm / 1000;
    const size = 24; // 24 м поля
    const divisions = Math.round(size / stepM);
    gridHelper = new THREE.GridHelper(size, divisions, 0x4a4f58, 0x6a707a);
    gridHelper.position.y = 0.001;
    scene.add(gridHelper);
  }

  // === шкафы ===
  const sharedOpts = {};
  const W = 0.6, D = 0.85;
  const total = cabs.length;
  const startX = -((total - 1) * W) / 2;
  const doorPivots = [];
  // v0.59.443: пробрасываем capacityAh модуля в каждый шкаф для
  // правильного выбора кол-ва автоматов (1 для 100 А·ч, 2 для 40/50).
  const capacityAh = (spec && spec.module && spec.module.capacityAh) ||
                     (opts.modelInfo && opts.modelInfo.capacityAh) || null;
  cabs.forEach((cab, i) => {
    const totalSlots = (cab.modulesInCabinet || 0) + (cab.emptySlots || 0);
    const layout = moduleLayout(totalSlots, cab.model);
    const g = buildCabinet(THREE, cab.role, {
      ...sharedOpts,
      modulesInCabinet: cab.modulesInCabinet || 0,
      layout,
      capacityAh,
      collectDoor: (pivot, role) => doorPivots.push({ pivot, role }),
      label: cab.model || (cab.role === 'combiner' ? 'Combiner' : cab.role),
      subLabel: (cab.role === 'master' ? 'Master' :
                 cab.role === 'slave' ? 'Slave' :
                 cab.role === 'combiner' ? 'Combiner' : ''),
    });
    g.position.x = startX + i * W;
    scene.add(g);
  });

  // === Тулбар (низ-лево): двери + развернуть ===
  const toolbar = document.createElement('div');
  toolbar.style.cssText =
    'position:absolute;left:8px;bottom:8px;display:flex;gap:6px;z-index:3';
  wrap.appendChild(toolbar);

  const btnBase = 'font:11px system-ui;color:#fff;background:#234a8a;' +
    'border:1px solid #3463b8;border-radius:4px;padding:6px 11px;cursor:pointer';

  const toggleBtn = document.createElement('button');
  toggleBtn.style.cssText = btnBase;
  toggleBtn.textContent = '🚪 Открыть двери';
  let doorsOpen = false;
  let animProgress = 0;
  toggleBtn.addEventListener('click', () => {
    doorsOpen = !doorsOpen;
    toggleBtn.textContent = doorsOpen ? '🚪 Закрыть двери' : '🚪 Открыть двери';
  });
  toolbar.appendChild(toggleBtn);

  const fullBtn = document.createElement('button');
  fullBtn.style.cssText = btnBase + ';background:#2a3f5a;border-color:#3a557a';
  fullBtn.textContent = '⛶ Развернуть';
  toolbar.appendChild(fullBtn);

  // === Панель настроек (низ-право): фон + сетка ===
  const settings = document.createElement('div');
  settings.style.cssText =
    'position:absolute;right:8px;bottom:8px;display:flex;gap:8px;align-items:center;' +
    'background:rgba(255,255,255,0.85);padding:6px 9px;border-radius:6px;' +
    'font:11px system-ui;color:#1a2a44;z-index:3';
  settings.innerHTML =
    '<label style="display:flex;align-items:center;gap:4px">Фон ' +
      '<select data-role="bg" style="font:11px system-ui;padding:1px 3px">' +
        '<option value="sky" selected>Небо</option>' +
        '<option value="dark">Тёмный</option>' +
        '<option value="white">Белый</option>' +
      '</select></label>' +
    '<label style="display:flex;align-items:center;gap:4px">Сетка ' +
      '<select data-role="grid" style="font:11px system-ui;padding:1px 3px">' +
        '<option value="600" selected>600 мм</option>' +
        '<option value="300">300 мм</option>' +
        '<option value="100">100 мм</option>' +
        '<option value="0">скрыть</option>' +
      '</select></label>';
  wrap.appendChild(settings);

  const bgSel = settings.querySelector('[data-role="bg"]');
  const gridSel = settings.querySelector('[data-role="grid"]');
  bgSel.addEventListener('change', () => applyBackground(bgSel.value));
  gridSel.addEventListener('change', () => rebuildGrid(Number(gridSel.value) || 0));

  // дефолты: небо + 600 мм сетка
  applyBackground('sky');
  rebuildGrid(600);

  // === 2D top-view ===
  function render2dTopView() {
    const W_MM = 600, D_MM = 850, H_COMB = 2000;
    const COMB_W = 400, COMB_D = 860;
    const margin = 8;
    // Считаем общую ширину ряда: master+slave×W + combiners×COMB_W
    let total_w = 0;
    for (const cab of cabs) total_w += (cab.role === 'combiner' ? COMB_W : W_MM);
    const total_d = Math.max(D_MM, COMB_D);
    const cw = view2d.clientWidth - 2 * margin - 20;
    const ch = view2d.clientHeight - 2 * margin - 60;
    const scale = Math.min((cw > 0 ? cw : 200) / total_w, (ch > 0 ? ch : 200) / total_d);
    const svgW = Math.max(180, total_w * scale + 40);
    const svgH = Math.max(140, total_d * scale + 80);
    let parts = [`<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">`];
    parts.push(`<text x="${svgW/2}" y="14" text-anchor="middle" font-size="11" fill="#5a6680" font-weight="bold">План (вид сверху)</text>`);
    let x = 20;
    const yTop = 30;
    for (const cab of cabs) {
      const w_mm = cab.role === 'combiner' ? COMB_W : W_MM;
      const d_mm = cab.role === 'combiner' ? COMB_D : D_MM;
      const w = w_mm * scale, d = d_mm * scale;
      const fill = cab.role === 'master' ? '#cfe0ff' :
                   cab.role === 'slave' ? '#d6f0d6' :
                   '#f0d8b8';
      const stroke = cab.role === 'master' ? '#3463b8' :
                     cab.role === 'slave' ? '#2c8a4a' :
                     '#a85a18';
      parts.push(`<rect x="${x}" y="${yTop}" width="${w}" height="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
      // дверь — линия снизу
      parts.push(`<line x1="${x}" y1="${yTop + d}" x2="${x + w}" y2="${yTop + d}" stroke="${stroke}" stroke-width="2"/>`);
      // петля
      parts.push(`<circle cx="${x + 3}" cy="${yTop + d - 2}" r="2" fill="${stroke}"/>`);
      const lab = cab.role === 'master' ? 'M' : cab.role === 'slave' ? 'S' : 'C';
      parts.push(`<text x="${x + w/2}" y="${yTop + d/2 + 4}" text-anchor="middle" font-size="11" font-weight="bold" fill="${stroke}">${lab}</text>`);
      // подпись модели
      parts.push(`<text x="${x + w/2}" y="${yTop + d + 14}" text-anchor="middle" font-size="9" fill="#1a2a44">${(cab.model || '').slice(-12)}</text>`);
      // габариты
      parts.push(`<text x="${x + w/2}" y="${yTop - 4}" text-anchor="middle" font-size="8" fill="#8a93a6">${w_mm}</text>`);
      x += w;
    }
    // глубина справа
    parts.push(`<text x="${svgW - 6}" y="${yTop + (D_MM*scale)/2}" text-anchor="end" font-size="8" fill="#8a93a6" transform="rotate(-90 ${svgW-6} ${yTop + (D_MM*scale)/2})">${D_MM} мм</text>`);
    parts.push(`</svg>`);
    // Состав
    let composition = '<div style="margin-top:8px;line-height:1.5">';
    composition += `<div style="font-weight:bold;margin-bottom:4px">Состав ряда</div>`;
    const counts = { master: 0, slave: 0, combiner: 0 };
    for (const c of cabs) counts[c.role] = (counts[c.role] || 0) + 1;
    if (counts.master) composition += `<div>● Master: <b>${counts.master}</b></div>`;
    if (counts.slave) composition += `<div>● Slave: <b>${counts.slave}</b></div>`;
    if (counts.combiner) {
      const combTypes = {};
      for (const c of cabs) {
        if (c.role === 'combiner') {
          const k = c.model || 'Combiner';
          combTypes[k] = (combTypes[k] || 0) + 1;
        }
      }
      for (const [k, v] of Object.entries(combTypes)) {
        composition += `<div>● ${k}: <b>${v}</b></div>`;
      }
    }
    // Габариты ряда
    composition += `<div style="margin-top:6px;color:#5a6680">Длина ряда: <b>${total_w} мм</b></div>`;
    composition += `<div style="color:#5a6680">Глубина: <b>${total_d} мм</b></div>`;
    composition += '</div>';
    view2d.innerHTML = parts.join('') + composition;
  }
  render2dTopView();

  // камера + рендерер
  const initW = wrap.clientWidth || 800;
  const initH = height;
  const camera = new THREE.PerspectiveCamera(38, initW / initH, 0.05, 100);
  const sceneWidth = Math.max(2.5, total * W + 1.8);
  camera.position.set(sceneWidth * 0.55, 1.6, sceneWidth * 0.95);
  camera.lookAt(0, 1.0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(initW, initH);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  wrap.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = 20;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();

  let stopped = false;
  const MAX_ANGLE = Math.PI * 0.65;
  function loop() {
    if (stopped) return;
    controls.update();
    const target = doorsOpen ? 1 : 0;
    if (Math.abs(animProgress - target) > 0.001) {
      animProgress += (target - animProgress) * 0.12;
      for (const { pivot } of doorPivots) {
        pivot.rotation.y = -animProgress * MAX_ANGLE;
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  // ресайз
  const resize = () => {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  // === модалка «Развернуть» ===
  // v0.59.443: правильное полноэкранное окно. Корень модалки = position:fixed
  // на весь viewport, wrap занимает всю площадь (без flex-смешения с padding).
  let modalOverlay = null;
  const origStyles = { position: '', width: '', height: '', flex: '', minWidth: '' };
  function enterFullscreen() {
    if (modalOverlay) return;
    // запоминаем плейсхолдер на месте wrap, чтобы потом вернуть
    const placeholder = document.createElement('div');
    placeholder.style.cssText = `flex:1 1 480px;min-width:320px;height:${height}px`;
    wrap.parentNode.insertBefore(placeholder, wrap);
    wrap.dataset._placeholderHook = '1';
    wrap._placeholder = placeholder;

    modalOverlay = document.createElement('div');
    modalOverlay.style.cssText =
      'position:fixed;left:0;top:0;right:0;bottom:0;z-index:9999;' +
      'background:rgba(10,12,18,0.96);box-sizing:border-box';
    document.body.appendChild(modalOverlay);

    // wrap → 100%×100% viewport
    origStyles.position = wrap.style.position;
    origStyles.width = wrap.style.width;
    origStyles.height = wrap.style.height;
    origStyles.flex = wrap.style.flex;
    origStyles.minWidth = wrap.style.minWidth;
    wrap.style.position = 'absolute';
    wrap.style.left = '0';
    wrap.style.top = '0';
    wrap.style.width = '100vw';
    wrap.style.height = '100vh';
    wrap.style.flex = '0 0 auto';
    wrap.style.minWidth = '0';
    wrap.style.borderRadius = '0';
    wrap.style.border = 'none';
    modalOverlay.appendChild(wrap);

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText =
      'position:fixed;right:16px;top:16px;z-index:10000;font:13px system-ui;' +
      'color:#fff;background:#a83a3a;border:1px solid #c95252;border-radius:4px;' +
      'padding:8px 16px;cursor:pointer;font-weight:bold';
    closeBtn.textContent = '✕ Закрыть (Esc)';
    closeBtn.addEventListener('click', exitFullscreen);
    modalOverlay.appendChild(closeBtn);
    modalOverlay._closeBtn = closeBtn;

    fullBtn.textContent = '⤓ Свернуть';
    document.addEventListener('keydown', escHandler);
    // Принудительно перерисовываем canvas под новые размеры
    requestAnimationFrame(() => requestAnimationFrame(resize));
  }
  function exitFullscreen() {
    if (!modalOverlay) return;
    document.removeEventListener('keydown', escHandler);
    // возвращаем wrap на место плейсхолдера
    const ph = wrap._placeholder;
    wrap.style.position = origStyles.position;
    wrap.style.left = '';
    wrap.style.top = '';
    wrap.style.width = '';
    wrap.style.height = `${height}px`;
    wrap.style.flex = '1 1 480px';
    wrap.style.minWidth = '320px';
    wrap.style.borderRadius = '8px';
    wrap.style.border = '1px solid #2a2f3a';
    if (ph && ph.parentNode) {
      ph.parentNode.insertBefore(wrap, ph);
      ph.remove();
    }
    delete wrap._placeholder;
    modalOverlay.remove();
    modalOverlay = null;
    fullBtn.textContent = '⛶ Развернуть';
    requestAnimationFrame(() => requestAnimationFrame(resize));
  }
  function escHandler(e) { if (e.key === 'Escape') exitFullscreen(); }
  fullBtn.addEventListener('click', () => {
    if (modalOverlay) exitFullscreen(); else enterFullscreen();
  });

  return {
    dispose() {
      stopped = true;
      try { document.removeEventListener('keydown', escHandler); } catch {}
      try { if (modalOverlay) modalOverlay.remove(); } catch {}
      try { ro.disconnect(); } catch {}
      try { controls.dispose(); } catch {}
      try { renderer.dispose(); } catch {}
      try { wrap.remove(); } catch {}
      try { root.remove(); } catch {}
    },
  };
}
