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

  // v0.59.477: высота 720 (было 600), чтобы вертикальная прокрутка не появлялась
  // в 2D-табах при обычной разрешающей способности экрана.
  const height = opts.height || 720;
  const root = document.createElement('div');
  root.style.cssText = `display:flex;flex-wrap:wrap;gap:8px;width:100%;align-items:stretch`;
  container.appendChild(root);

  const wrap = document.createElement('div');
  wrap.style.cssText =
    `position:relative;flex:0 1 560px;min-width:340px;max-width:680px;` +
    `height:${height}px;border:1px solid #2a2f3a;border-radius:8px;overflow:hidden`;
  root.appendChild(wrap);

  // 2D-вид (фронт / план / сбоку)
  const view2d = document.createElement('div');
  view2d.style.cssText =
    `flex:1 1 360px;min-width:280px;height:${height}px;border:1px solid #2a2f3a;` +
    `border-radius:8px;background:#f7f8fb;padding:0;box-sizing:border-box;` +
    `overflow:hidden;font:11px system-ui;color:#1a2a44;display:flex;flex-direction:column`;
  root.appendChild(view2d);

  // Табы 2D-вида
  const tabs2d = document.createElement('div');
  tabs2d.style.cssText =
    'display:flex;gap:0;background:#e6eaf2;border-bottom:1px solid #cdd5e3;flex-shrink:0';
  const TABS = [
    { id: 'top', label: 'План (сверху)' },
    { id: 'front', label: 'Фасад' },
    { id: 'side', label: 'Сбоку' },
  ];
  let active2d = 'top';
  const tabBtns = {};
  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tab = t.id;
    b.textContent = t.label;
    b.style.cssText =
      'flex:1;padding:7px 6px;font:11px system-ui;border:none;background:transparent;' +
      'cursor:pointer;border-bottom:2px solid transparent;color:#5a6680';
    b.addEventListener('click', () => {
      active2d = t.id;
      for (const id in tabBtns) {
        tabBtns[id].style.background = id === active2d ? '#fff' : 'transparent';
        tabBtns[id].style.color = id === active2d ? '#1a2a44' : '#5a6680';
        tabBtns[id].style.borderBottomColor = id === active2d ? '#234a8a' : 'transparent';
        tabBtns[id].style.fontWeight = id === active2d ? '600' : 'normal';
      }
      render2d();
    });
    tabBtns[t.id] = b;
    tabs2d.appendChild(b);
  }
  view2d.appendChild(tabs2d);

  const view2dBody = document.createElement('div');
  view2dBody.style.cssText = 'flex:1;overflow:auto;padding:10px';
  view2d.appendChild(view2dBody);

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

  // === 2D-виды (top / front / side) ===
  const W_MM = 600, D_MM = 850, H_MM = 2000;
  const COMB_W = 400, COMB_D = 860;
  const capAh2d = (spec && spec.module && spec.module.capacityAh) || null;

  function colorsByRole(role) {
    if (role === 'master')   return { fill: '#cfe0ff', stroke: '#3463b8' };
    if (role === 'slave')    return { fill: '#d6f0d6', stroke: '#2c8a4a' };
    return { fill: '#f0d8b8', stroke: '#a85a18' };
  }

  function totalRowWidth() {
    let w = 0;
    for (const cab of cabs) w += (cab.role === 'combiner' ? COMB_W : W_MM);
    return w;
  }

  function renderTopView() {
    const total_w = totalRowWidth();
    const total_d = Math.max(D_MM, COMB_D);
    const cw = view2dBody.clientWidth - 20;
    const ch = view2dBody.clientHeight - 80;
    const scale = Math.min((cw > 0 ? cw : 240) / total_w, (ch > 0 ? ch : 200) / total_d);
    const svgW = Math.max(220, total_w * scale + 40);
    const svgH = Math.max(160, total_d * scale + 60);
    const parts = [`<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">`];
    parts.push(`<text x="${svgW/2}" y="14" text-anchor="middle" font-size="11" fill="#5a6680" font-weight="bold">Вид сверху (план)</text>`);
    let x = 20;
    const yTop = 28;
    for (const cab of cabs) {
      const w_mm = cab.role === 'combiner' ? COMB_W : W_MM;
      const d_mm = cab.role === 'combiner' ? COMB_D : D_MM;
      const w = w_mm * scale, d = d_mm * scale;
      const { fill, stroke } = colorsByRole(cab.role);
      parts.push(`<rect x="${x}" y="${yTop}" width="${w}" height="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
      parts.push(`<line x1="${x}" y1="${yTop + d}" x2="${x + w}" y2="${yTop + d}" stroke="${stroke}" stroke-width="2"/>`);
      parts.push(`<circle cx="${x + 3}" cy="${yTop + d - 2}" r="2" fill="${stroke}"/>`);
      const lab = cab.role === 'master' ? 'M' : cab.role === 'slave' ? 'S' : 'C';
      parts.push(`<text x="${x + w/2}" y="${yTop + d/2 + 4}" text-anchor="middle" font-size="11" font-weight="bold" fill="${stroke}">${lab}</text>`);
      parts.push(`<text x="${x + w/2}" y="${yTop + d + 14}" text-anchor="middle" font-size="9" fill="#1a2a44">${(cab.model || '').slice(-14)}</text>`);
      parts.push(`<text x="${x + w/2}" y="${yTop - 4}" text-anchor="middle" font-size="8" fill="#8a93a6">${w_mm}</text>`);
      x += w;
    }
    parts.push(`<text x="${svgW - 6}" y="${yTop + (D_MM*scale)/2}" text-anchor="end" font-size="8" fill="#8a93a6" transform="rotate(-90 ${svgW-6} ${yTop + (D_MM*scale)/2})">${D_MM} мм</text>`);
    // v0.59.477/479: общая ширина ряда снизу (total_w уже объявлен выше).
    const dimY = yTop + total_d * scale + 22;
    parts.push(`<line x1="20" y1="${dimY}" x2="${20 + total_w*scale}" y2="${dimY}" stroke="#444" stroke-width="0.7"/>`);
    parts.push(`<line x1="20" y1="${dimY-4}" x2="20" y2="${dimY+4}" stroke="#444" stroke-width="0.7"/>`);
    parts.push(`<line x1="${20 + total_w*scale}" y1="${dimY-4}" x2="${20 + total_w*scale}" y2="${dimY+4}" stroke="#444" stroke-width="0.7"/>`);
    parts.push(`<text x="${20 + total_w*scale/2}" y="${dimY+13}" text-anchor="middle" font-size="10" fill="#1a2a44" font-weight="bold">общая ширина ${total_w} мм</text>`);
    parts.push(`</svg>`);
    return parts.join('');
  }

  function renderFrontView() {
    const total_w = totalRowWidth();
    const cw = view2dBody.clientWidth - 20;
    const ch = view2dBody.clientHeight - 80;
    const scale = Math.min((cw > 0 ? cw : 240) / total_w, (ch > 0 ? ch : 320) / H_MM);
    const svgW = Math.max(220, total_w * scale + 40);
    const svgH = Math.max(220, H_MM * scale + 70);
    const parts = [`<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">`];
    parts.push(`<text x="${svgW/2}" y="14" text-anchor="middle" font-size="11" fill="#5a6680" font-weight="bold">Вид спереди (фасад)</text>`);
    // пол
    parts.push(`<line x1="10" y1="${28 + H_MM*scale + 6}" x2="${svgW - 10}" y2="${28 + H_MM*scale + 6}" stroke="#888" stroke-width="1"/>`);
    let x = 20;
    const yTop = 28;
    const isHundred = Number(capAh2d) === 100;
    const breakerCount = isHundred ? 1 : 2;
    for (const cab of cabs) {
      const w_mm = cab.role === 'combiner' ? COMB_W : W_MM;
      const w = w_mm * scale;
      const h = H_MM * scale;
      const { fill, stroke } = colorsByRole(cab.role);
      // корпус
      parts.push(`<rect x="${x}" y="${yTop}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
      // верхний кожух (250 мм)
      const topReserveH = 250 * scale;
      parts.push(`<rect x="${x}" y="${yTop}" width="${w}" height="${topReserveH}" fill="#3a3f48" stroke="${stroke}" stroke-width="1"/>`);
      if (cab.role === 'master' || cab.role === 'slave') {
        // панель автоматов (120 мм)
        const breakerH_mm = 120;
        const breakerY = yTop + topReserveH;
        const breakerH_px = breakerH_mm * scale;
        parts.push(`<rect x="${x + 2}" y="${breakerY}" width="${w - 4}" height="${breakerH_px}" fill="#4a4f58" stroke="#1a1c22" stroke-width="0.5"/>`);
        // автоматы
        const positions = breakerCount === 1 ? [0.65] : [0.30, 0.70];
        for (const f of positions) {
          const bw = Math.min(28 * scale * 1.5, w * 0.22);
          const bh = breakerH_px * 0.72;
          const bx = x + w * f - bw / 2;
          const by = breakerY + (breakerH_px - bh) / 2;
          parts.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#1d2026" stroke="#0a0b0e" stroke-width="0.5"/>`);
          parts.push(`<rect x="${bx + bw*0.32}" y="${by + bh*0.38}" width="${bw*0.36}" height="${bh*0.24}" fill="#e6e8ee"/>`);
        }
        // зона модулей
        const modZoneY = breakerY + breakerH_px;
        const modZoneH = (yTop + h) - modZoneY - 60 * scale; // нижний бортик
        // ячейки модулей по слоям (упрощённо: 12 рядов, перфорация)
        const filled = cab.modulesInCabinet || 0;
        const totalSlots = filled + (cab.emptySlots || 0);
        const layout = moduleLayout(totalSlots, cab.model);
        const rows = layout.rows;
        const cols = layout.cols;
        const cellH = modZoneH / rows;
        const cellW = (w - 8) / cols;
        for (let r = 0; r < rows; r++) {
          const rTop = rows - 1 - r;
          for (let c = 0; c < cols; c++) {
            const idxTop = rTop * cols + c;
            const isFilled = idxTop < filled;
            const cx = x + 4 + c * cellW;
            const cy = modZoneY + r * cellH;
            parts.push(`<rect x="${cx}" y="${cy}" width="${cellW - 1}" height="${cellH - 1}" fill="${isFilled ? '#3d4855' : '#aab0bc'}" opacity="${isFilled ? '1' : '0.55'}" stroke="#1a1c22" stroke-width="0.3"/>`);
            if (isFilled) {
              // LED
              parts.push(`<circle cx="${cx + cellW - 6}" cy="${cy + cellH/2}" r="1.5" fill="#7bd88f"/>`);
            }
          }
        }
      } else {
        // combiner — горизонтальные шины
        const busY = yTop + topReserveH + 0.30 * (h - topReserveH);
        for (let i = 0; i < 3; i++) {
          parts.push(`<rect x="${x + 6}" y="${busY + i * 14 * scale * 6}" width="${w - 12}" height="${10 * scale * 4}" fill="#c97a2a" stroke="#1a1c22" stroke-width="0.5"/>`);
        }
        parts.push(`<text x="${x + w/2}" y="${yTop + topReserveH/2 + 4}" text-anchor="middle" font-size="9" font-weight="bold" fill="#fff">DC BUS</text>`);
      }
      // ручка двери справа
      parts.push(`<rect x="${x + w - 5*scale*4}" y="${yTop + h*0.45}" width="${2*scale*3}" height="${h*0.10}" fill="${stroke}"/>`);
      // подпись снизу
      parts.push(`<text x="${x + w/2}" y="${yTop + h + 24}" text-anchor="middle" font-size="9" fill="#1a2a44">${cab.model || ''}</text>`);
      // ширина сверху
      parts.push(`<text x="${x + w/2}" y="${yTop - 4}" text-anchor="middle" font-size="8" fill="#8a93a6">${w_mm}</text>`);
      x += w;
    }
    // высота слева
    parts.push(`<text x="14" y="${yTop + (H_MM*scale)/2}" text-anchor="middle" font-size="8" fill="#8a93a6" transform="rotate(-90 14 ${yTop + (H_MM*scale)/2})">${H_MM} мм</text>`);
    // v0.59.477/479: общие размеры — ширина внизу, высота сбоку (total_w уже выше).
    const dimY = yTop + H_MM * scale + 22;
    parts.push(`<line x1="20" y1="${dimY}" x2="${20 + total_w*scale}" y2="${dimY}" stroke="#444" stroke-width="0.7"/>`);
    parts.push(`<line x1="20" y1="${dimY-4}" x2="20" y2="${dimY+4}" stroke="#444" stroke-width="0.7"/>`);
    parts.push(`<line x1="${20 + total_w*scale}" y1="${dimY-4}" x2="${20 + total_w*scale}" y2="${dimY+4}" stroke="#444" stroke-width="0.7"/>`);
    parts.push(`<text x="${20 + total_w*scale/2}" y="${dimY+13}" text-anchor="middle" font-size="10" fill="#1a2a44" font-weight="bold">общая ширина ${total_w} мм · высота ${H_MM} мм</text>`);
    parts.push(`</svg>`);
    return parts.join('');
  }

  function renderSideView() {
    // Вид сбоку: один шкаф 850 (D) × 2000 (H). Если есть combiner — 860.
    const cw = view2dBody.clientWidth - 20;
    const ch = view2dBody.clientHeight - 80;
    const scale = Math.min((cw > 0 ? cw : 200) / D_MM, (ch > 0 ? ch : 320) / H_MM);
    const svgW = Math.max(180, D_MM * scale + 60);
    const svgH = Math.max(220, H_MM * scale + 70);
    const parts = [`<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">`];
    parts.push(`<text x="${svgW/2}" y="14" text-anchor="middle" font-size="11" fill="#5a6680" font-weight="bold">Вид сбоку</text>`);
    const x = 30;
    const yTop = 28;
    const w = D_MM * scale;
    const h = H_MM * scale;
    const stroke = '#3463b8';
    parts.push(`<rect x="${x}" y="${yTop}" width="${w}" height="${h}" fill="#dde6f3" stroke="${stroke}" stroke-width="1.5"/>`);
    // верхняя секция (вентиляция)
    parts.push(`<rect x="${x}" y="${yTop}" width="${w}" height="${250*scale}" fill="#3a3f48" stroke="${stroke}" stroke-width="1"/>`);
    // дверь — слева (передняя сторона = слева в проекции сбоку)
    parts.push(`<line x1="${x}" y1="${yTop + 250*scale}" x2="${x}" y2="${yTop + h}" stroke="${stroke}" stroke-width="3"/>`);
    parts.push(`<text x="${x - 8}" y="${yTop + h/2}" text-anchor="end" font-size="9" fill="${stroke}" transform="rotate(-90 ${x - 8} ${yTop + h/2})">фасад →</text>`);
    // пол
    parts.push(`<line x1="10" y1="${yTop + h + 6}" x2="${svgW - 10}" y2="${yTop + h + 6}" stroke="#888" stroke-width="1"/>`);
    // подпись D
    parts.push(`<text x="${x + w/2}" y="${yTop - 4}" text-anchor="middle" font-size="8" fill="#8a93a6">${D_MM} мм</text>`);
    parts.push(`<text x="${svgW - 6}" y="${yTop + h/2}" text-anchor="middle" font-size="8" fill="#8a93a6" transform="rotate(-90 ${svgW-6} ${yTop + h/2})">${H_MM} мм</text>`);
    parts.push(`</svg>`);
    return parts.join('');
  }

  function renderComposition() {
    const total_w = totalRowWidth();
    const total_d = Math.max(D_MM, COMB_D);
    let html = '<div style="margin-top:10px;line-height:1.55;font-size:11px">';
    html += `<div style="font-weight:bold;margin-bottom:4px">Состав ряда</div>`;
    const counts = { master: 0, slave: 0, combiner: 0 };
    for (const c of cabs) counts[c.role] = (counts[c.role] || 0) + 1;
    if (counts.master) html += `<div><span style="color:#3463b8">●</span> Master: <b>${counts.master}</b></div>`;
    if (counts.slave) html += `<div><span style="color:#2c8a4a">●</span> Slave: <b>${counts.slave}</b></div>`;
    if (counts.combiner) {
      const combTypes = {};
      for (const c of cabs) {
        if (c.role === 'combiner') {
          const k = c.model || 'Combiner';
          combTypes[k] = (combTypes[k] || 0) + 1;
        }
      }
      for (const [k, v] of Object.entries(combTypes)) {
        html += `<div><span style="color:#a85a18">●</span> ${k}: <b>${v}</b></div>`;
      }
    }
    html += `<div style="margin-top:6px;color:#5a6680">Длина ряда: <b>${total_w} мм</b></div>`;
    html += `<div style="color:#5a6680">Глубина: <b>${total_d} мм</b></div>`;
    html += `<div style="color:#5a6680">Высота: <b>${H_MM} мм</b></div>`;
    // v0.59.477: общие габариты системы — площадь основания и объём.
    const areaM2 = (total_w * total_d) / 1e6;
    const volumeM3 = (total_w * total_d * H_MM) / 1e9;
    html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e0e3ea;color:#1a2a44">`;
    html += `Габариты: <b>${total_w}×${total_d}×${H_MM}</b> мм<br>`;
    html += `Площадь: <b>${areaM2.toFixed(2)} м²</b> · Объём: <b>${volumeM3.toFixed(2)} м³</b>`;
    html += `</div>`;
    html += '</div>';
    return html;
  }

  function render2d() {
    let svg = '';
    if (active2d === 'top') svg = renderTopView();
    else if (active2d === 'front') svg = renderFrontView();
    else svg = renderSideView();
    view2dBody.innerHTML = svg + renderComposition();
  }

  // активируем первый таб
  tabBtns['top'].click();

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

  // ресайз. v0.59.484: setSize(true) — обновляем И style canvas, иначе при
  // расширении wrap (например, fullscreen) canvas.style.height застревал
  // на старом значении и трёхмерное изображение оставалось мелким в углу.
  const resize = () => {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, true);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  // === модалка «Развернуть» ===
  // v0.59.484: используем выделенный body-level overlay вместо переключения
  // position:fixed на самом wrap. Раньше при position:fixed родительские
  // стили (display:flex, transforms) ломали layout — wrap «застревал» в
  // углу. Сейчас wrap временно ПЕРЕНОСИТСЯ в overlay, а после exit —
  // возвращается на исходное место (через placeholder-якорь).
  let isFs = false;
  let fsOverlay = null;
  let fsAnchor = null;
  let bodyOverflowSaved = '';
  const origStyles = {};
  function enterFullscreen() {
    if (isFs) return;
    isFs = true;
    bodyOverflowSaved = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Сохраняем оригинальные стили wrap, чтобы вернуть их при exit.
    for (const k of ['position','flex','minWidth','maxWidth','width','height','border','borderRadius']) {
      origStyles[k] = wrap.style[k];
    }
    // Якорь на месте, куда вернуть wrap после exit.
    fsAnchor = document.createComment('s3-3d-anchor');
    wrap.parentNode.insertBefore(fsAnchor, wrap);
    // Создаём overlay поверх всего, переносим wrap в него.
    fsOverlay = document.createElement('div');
    fsOverlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(10,15,25,0.94)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:12px', 'box-sizing:border-box',
    ].join(';');
    document.body.appendChild(fsOverlay);
    // Перенос wrap в overlay + новые размеры.
    wrap.style.position = 'relative';
    wrap.style.flex = '1 1 auto';
    wrap.style.minWidth = '0';
    wrap.style.maxWidth = 'none';
    wrap.style.width = '100%';
    wrap.style.height = '100%';
    wrap.style.border = 'none';
    wrap.style.borderRadius = '6px';
    fsOverlay.appendChild(wrap);
    // Кнопка закрытия.
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.style.cssText =
      'position:absolute;right:18px;top:18px;z-index:10;font:13px system-ui;' +
      'color:#fff;background:#a83a3a;border:1px solid #c95252;border-radius:4px;' +
      'padding:9px 18px;cursor:pointer;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
    closeBtn.textContent = '✕ Закрыть (Esc)';
    closeBtn.addEventListener('click', exitFullscreen);
    fsOverlay.appendChild(closeBtn);
    fullBtn.textContent = '⤓ Свернуть';
    document.addEventListener('keydown', escHandler);
    // Resize canvas под новые размеры — двойной rAF чтобы DOM применил.
    requestAnimationFrame(() => requestAnimationFrame(resize));
  }
  function exitFullscreen() {
    if (!isFs) return;
    isFs = false;
    document.removeEventListener('keydown', escHandler);
    document.body.style.overflow = bodyOverflowSaved;
    // Возвращаем wrap на исходное место.
    if (fsAnchor && fsAnchor.parentNode) {
      fsAnchor.parentNode.insertBefore(wrap, fsAnchor);
      fsAnchor.remove();
      fsAnchor = null;
    }
    // Восстанавливаем оригинальные стили + дефолты модуля.
    wrap.style.position = 'relative';
    wrap.style.flex = '0 1 560px';
    wrap.style.minWidth = '340px';
    wrap.style.maxWidth = '680px';
    wrap.style.width = '';
    wrap.style.height = `${height}px`;
    wrap.style.border = '1px solid #2a2f3a';
    wrap.style.borderRadius = '8px';
    if (fsOverlay) { fsOverlay.remove(); fsOverlay = null; }
    fullBtn.textContent = '⛶ Развернуть';
    requestAnimationFrame(() => requestAnimationFrame(resize));
  }
  function escHandler(e) { if (e.key === 'Escape') exitFullscreen(); }
  fullBtn.addEventListener('click', () => {
    // v0.59.477: было `if (modalOverlay) ...` — но modalOverlay не
    // определён в текущей реализации (legacy от старого подхода).
    // Используем isFs — флаг состояния fullscreen.
    if (isFs) exitFullscreen(); else enterFullscreen();
  });

  return {
    dispose() {
      stopped = true;
      try { document.removeEventListener('keydown', escHandler); } catch {}
      try { if (isFs) exitFullscreen(); } catch {}
      try { ro.disconnect(); } catch {}
      try { controls.dispose(); } catch {}
      try { renderer.dispose(); } catch {}
      try { wrap.remove(); } catch {}
      try { root.remove(); } catch {}
    },
  };
}
