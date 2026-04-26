// ======================================================================
// shared/battery-types/s3-3d-view.js (v0.59.437)
// Настоящий 3D-вид сборки шкафов S³ на Three.js с OrbitControls.
//
// API:
//   mountS3ThreeDView(container, spec, { height = 360, modelInfo } = {})
//     → { dispose() }
//
// container — пустой DOM-элемент, в который монтируется WebGL-канвас.
// spec      — результат s3LiIonType.buildSystem().
// modelInfo — паспорт модуля (для угадывания типа: S3M040/050 узкий
//             с 2 колонками модулей или S3M100 широкий с 1 колонкой).
//
// Габариты по User Manual S³:
//   шкаф 600 W × 850 D × 2000 H мм (Figure 3-7)
//   фронт — перфорированная мет. дверь во всю высоту, ручка справа,
//   тач-скрин слева сверху на master, у combiner — горизонтальные шины.
// ======================================================================

let _threePromise = null;
function loadThree() {
  if (_threePromise) return _threePromise;
  _threePromise = (async () => {
    const THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js');
    const { OrbitControls } = await import(
      'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js'
    );
    return { THREE, OrbitControls };
  })();
  return _threePromise;
}

// Процедурная текстура перфорированной двери (тёмный фон + сетка точек).
function makePerforatedTexture(THREE, w = 256, h = 768) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // фон
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#2a2d33');
  grad.addColorStop(1, '#1a1c22');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // перфорация
  ctx.fillStyle = '#0a0b0e';
  const step = 8, r = 1.6;
  for (let y = step; y < h - step; y += step) {
    const off = (Math.floor(y / step) % 2) ? step / 2 : 0;
    for (let x = step + off; x < w - step; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Текстура combiner-двери — горизонтальные шины + надпись.
function makeCombinerTexture(THREE, w = 256, h = 768) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3f48';
  ctx.fillRect(0, 0, w, h);
  // болты по периметру
  ctx.fillStyle = '#1a1c22';
  for (let i = 0; i < 8; i++) {
    const y = 20 + i * (h - 40) / 7;
    ctx.beginPath(); ctx.arc(12, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w - 12, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // шины
  ctx.fillStyle = '#c97a2a';
  ctx.fillRect(40, h * 0.30, w - 80, 18);
  ctx.fillRect(40, h * 0.42, w - 80, 18);
  ctx.fillRect(40, h * 0.54, w - 80, 18);
  // подпись
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

// Текстура одного модуля для отрытой двери (если режим explode).
function makeModuleTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3d4855';
  ctx.fillRect(0, 0, 128, 32);
  // решётка перфорации
  ctx.fillStyle = '#0a0b0e';
  for (let y = 4; y < 28; y += 4) {
    for (let x = 6; x < 100; x += 4) {
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }
  // ручка справа
  ctx.fillStyle = '#222';
  ctx.fillRect(108, 10, 14, 12);
  // LED
  ctx.fillStyle = '#7bd88f';
  ctx.fillRect(102, 12, 3, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCabinet(THREE, role, opts) {
  // unit: 1 = 1 м, шкаф 0.6 × 0.85 × 2.0
  const W = 0.6, D = 0.85, H = 2.0;
  const group = new THREE.Group();

  // корпус — серый бокс, минус толщина двери спереди
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x4a4f58, metalness: 0.5, roughness: 0.55,
  });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, D),
    [bodyMat, bodyMat, bodyMat, bodyMat, bodyMat, bodyMat],
  );
  body.position.set(0, H / 2, 0);
  group.add(body);

  // фронтальная панель (наложение на грань +Z)
  let frontTex;
  if (role === 'combiner') {
    frontTex = makeCombinerTexture(THREE);
  } else {
    frontTex = opts._sharedPerfTex || makePerforatedTexture(THREE);
    opts._sharedPerfTex = frontTex;
  }
  const doorMat = new THREE.MeshStandardMaterial({
    map: frontTex, metalness: 0.3, roughness: 0.7,
  });
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.96, H * 0.96),
    doorMat,
  );
  door.position.set(0, H / 2, D / 2 + 0.001);
  group.add(door);

  // ручка двери справа (вертикальный стержень)
  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x2a2c30, metalness: 0.7, roughness: 0.4,
  });
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.35, 12),
    handleMat,
  );
  handle.position.set(W * 0.42, H * 0.55, D / 2 + 0.025);
  group.add(handle);
  // крепления ручки
  for (const dy of [-0.18, 0.18]) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.02, 0.05),
      handleMat,
    );
    m.position.set(W * 0.42, H * 0.55 + dy, D / 2 + 0.012);
    group.add(m);
  }

  // тач-скрин для master (по Figure 3-7 — слева сверху)
  if (role === 'master') {
    const screenBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.13, 0.012),
      new THREE.MeshStandardMaterial({
        color: 0x121418, metalness: 0.3, roughness: 0.6,
      }),
    );
    screenBase.position.set(-W * 0.30, H * 0.83, D / 2 + 0.008);
    group.add(screenBase);
    const screenGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.10),
      new THREE.MeshBasicMaterial({ color: 0x4a8eff }),
    );
    screenGlow.position.set(-W * 0.30, H * 0.83, D / 2 + 0.015);
    group.add(screenGlow);
  } else if (role === 'slave') {
    // маленький LED-индикатор слева сверху
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0x7bd88f }),
    );
    led.position.set(-W * 0.30, H * 0.83, D / 2 + 0.012);
    group.add(led);
  }

  // основание — небольшая металлическая плита
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(W * 1.02, 0.04, D * 1.02),
    new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.6, roughness: 0.5 }),
  );
  base.position.set(0, 0.02, 0);
  group.add(base);

  // подпись модели сверху (текстовый спрайт)
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

export async function mountS3ThreeDView(container, spec, opts = {}) {
  if (!container) return { dispose() {} };
  container.innerHTML = '';
  // плейсхолдер
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

  const height = opts.height || 380;
  const wrap = document.createElement('div');
  wrap.style.cssText =
    `position:relative;width:100%;height:${height}px;border:1px solid #2a2f3a;` +
    `border-radius:8px;background:linear-gradient(180deg,#1a1d24 0%,#0e1014 100%);` +
    `overflow:hidden`;
  container.appendChild(wrap);

  const hint = document.createElement('div');
  hint.style.cssText =
    'position:absolute;left:8px;top:8px;font:11px system-ui;color:#8a93a6;' +
    'background:rgba(0,0,0,0.4);padding:3px 7px;border-radius:4px;pointer-events:none;z-index:2';
  hint.innerHTML = '🖱 ЛКМ — вращать · колесо — зум · ПКМ — панорама';
  wrap.appendChild(hint);

  // легенда справа сверху
  const legend = document.createElement('div');
  legend.style.cssText =
    'position:absolute;right:8px;top:8px;font:11px system-ui;color:#cfd3dc;' +
    'background:rgba(0,0,0,0.45);padding:6px 9px;border-radius:4px;line-height:1.5;z-index:2';
  const cabs = spec.cabinets || [];
  const counts = { master: 0, slave: 0, combiner: 0 };
  for (const c of cabs) counts[c.role] = (counts[c.role] || 0) + 1;
  legend.innerHTML =
    `<b>${cabs.length}</b> шкаф(ов): ` +
    (counts.master ? `<span style="color:#4a8eff">●</span> ${counts.master} master ` : '') +
    (counts.slave  ? `<span style="color:#7bd88f">●</span> ${counts.slave} slave ` : '') +
    (counts.combiner ? `<span style="color:#c97a2a">●</span> ${counts.combiner} combiner` : '');
  wrap.appendChild(legend);

  // сцена
  const scene = new THREE.Scene();
  scene.background = null; // прозрачный — фон от wrap

  // освещение
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8c8ff, 0.35);
  fill.position.set(-3, 2, -2);
  scene.add(fill);

  // пол
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.95, metalness: 0.0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // сетка
  const grid = new THREE.GridHelper(10, 20, 0x2a2f3a, 0x1a1c22);
  grid.position.y = 0.001;
  scene.add(grid);

  // ряд шкафов вдоль X. Шкаф 0.6 м, между шкафами зазор 0 (стоят впритык).
  const sharedOpts = {};
  const W = 0.6, D = 0.85;
  const total = cabs.length;
  const startX = -((total - 1) * W) / 2;
  cabs.forEach((cab, i) => {
    const g = buildCabinet(THREE, cab.role, {
      ...sharedOpts,
      label: cab.model || (cab.role === 'combiner' ? 'Combiner' : cab.role),
      subLabel: (cab.role === 'master' ? 'Master' :
                 cab.role === 'slave' ? 'Slave' :
                 cab.role === 'combiner' ? 'Combiner' : ''),
    });
    g.position.x = startX + i * W;
    scene.add(g);
  });

  // камера
  const initW = wrap.clientWidth || 600;
  const initH = height;
  const camera = new THREE.PerspectiveCamera(38, initW / initH, 0.05, 50);
  // вид с фронта-сверху-сбоку, как на фото User Manual
  const sceneWidth = Math.max(2.5, total * W + 1.8);
  camera.position.set(sceneWidth * 0.55, 1.6, sceneWidth * 0.85);
  camera.lookAt(0, 1.0, 0);

  // рендерер
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(initW, initH);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  wrap.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  // OrbitControls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.5;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.495; // не пускаем под пол
  controls.update();

  let stopped = false;
  function loop() {
    if (stopped) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  // ресайз
  const ro = new ResizeObserver(() => {
    const w = wrap.clientWidth || initW;
    const h = wrap.clientHeight || initH;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  ro.observe(wrap);

  return {
    dispose() {
      stopped = true;
      try { ro.disconnect(); } catch {}
      try { controls.dispose(); } catch {}
      try { renderer.dispose(); } catch {}
      try { wrap.remove(); } catch {}
    },
  };
}
