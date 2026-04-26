// ======================================================================
// shared/battery-types/s3-iso-view.js (v0.59.435)
// Изометрический «3D» SVG-вид сборки шкафов S³ (master / slave / combiner)
// для отображения в battery-calc и в инспекторе ИБП.
//
// Рисует ряд шкафов слева направо в простой косоугольной проекции
// (oblique projection): передняя грань — фронтальный прямоугольник,
// верх и правый бок — параллелограммы со смещением вправо-вверх.
//
// Каждый шкаф визуально несёт:
//   • для master — большую touch-screen панель в верхней трети (по фото)
//   • для slave  — маленький LED-индикатор-окно
//   • для combiner — горизонтальная шинная разводка (без модулей)
//   • полки модулей — горизонтальные полосы; пустые слоты — иной оттенок
//
// API: renderS3IsoSvg(spec, { width, accent }) → строка SVG.
// ======================================================================

const COLORS = {
  bodyFront:  '#26292f',
  bodyTop:    '#3a3f48',
  bodySide:   '#1a1c22',
  doorEdge:   '#0f1115',
  module:     '#3d4855',
  moduleEdge: '#0c0e12',
  moduleHi:   '#5a6878',
  empty:      '#4a4a4a',
  emptyHatch: '#5a5a5a',
  screen:     '#1976d2',
  screenGlow: '#64b5f6',
  led:        '#43a047',
  busbar:     '#b0bec5',
  busbarEdge: '#546e7a',
  label:      '#0f172a',
  labelMuted: '#64748b',
  shadow:     'rgba(0,0,0,0.18)',
};

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Рисует один шкаф в изо-проекции.
//   x0, y0 — позиция нижнего-левого угла фронта
//   W, H, D — размеры в пикселях (ширина, высота, глубина)
//   role — 'master' | 'slave' | 'combiner'
//   modulesInCabinet, emptySlots — заполнение
//   capacityAh — 40/50 или 100 (визуально влияет на число полос: 12 или 4)
function drawCabinet({ x0, y0, W, H, D, role, modulesInCabinet, emptySlots, capacityAh, label }) {
  // y0 — НИЖНИЙ край фронта. Превращаем во y-top для удобства SVG.
  const yTop = y0 - H;
  const ox = D * 0.55;   // смещение по X (вправо)
  const oy = -D * 0.35;  // смещение по Y (вверх в экранных координатах = меньше y)
  const parts = [];

  // 1) Тень под шкафом (овал)
  parts.push(`<ellipse cx="${x0 + W/2 + ox*0.4}" cy="${y0 + 6}" rx="${W*0.55}" ry="${4}" fill="${COLORS.shadow}"/>`);

  // 2) Верхняя грань (параллелограмм)
  const top = [
    [x0,         yTop],
    [x0 + W,     yTop],
    [x0 + W+ox,  yTop+oy],
    [x0 + ox,    yTop+oy],
  ];
  parts.push(`<polygon points="${top.map(p => p.join(',')).join(' ')}" fill="${COLORS.bodyTop}" stroke="${COLORS.doorEdge}" stroke-width="1"/>`);

  // 3) Правый бок (параллелограмм)
  const side = [
    [x0 + W,     yTop],
    [x0 + W+ox,  yTop+oy],
    [x0 + W+ox,  y0+oy],
    [x0 + W,     y0],
  ];
  parts.push(`<polygon points="${side.map(p => p.join(',')).join(' ')}" fill="${COLORS.bodySide}" stroke="${COLORS.doorEdge}" stroke-width="1"/>`);

  // 4) Передняя грань (корпус двери)
  parts.push(`<rect x="${x0}" y="${yTop}" width="${W}" height="${H}" fill="${COLORS.bodyFront}" stroke="${COLORS.doorEdge}" stroke-width="1"/>`);

  // 5) Верхняя панель управления (выступ ~15% высоты)
  const panelH = H * 0.16;
  parts.push(`<rect x="${x0+3}" y="${yTop+3}" width="${W-6}" height="${panelH}" fill="#1a1c22" stroke="${COLORS.doorEdge}" stroke-width="0.5"/>`);

  if (role === 'master') {
    // Touch screen window
    const swW = W * 0.55, swH = panelH * 0.7;
    const swX = x0 + (W - swW) / 2, swY = yTop + 3 + (panelH - swH) / 2;
    parts.push(`<rect x="${swX}" y="${swY}" width="${swW}" height="${swH}" fill="${COLORS.screen}" stroke="${COLORS.screenGlow}" stroke-width="0.5" rx="1"/>`);
    parts.push(`<circle cx="${swX + swW*0.5}" cy="${swY + swH*0.5}" r="${Math.min(swW, swH)*0.18}" fill="${COLORS.screenGlow}" opacity="0.55"/>`);
  } else if (role === 'slave') {
    // LED indicator
    const ledX = x0 + W * 0.5;
    const ledY = yTop + 3 + panelH * 0.5;
    parts.push(`<circle cx="${ledX}" cy="${ledY}" r="${Math.max(2, panelH * 0.22)}" fill="${COLORS.led}" opacity="0.9"/>`);
    parts.push(`<circle cx="${ledX}" cy="${ledY}" r="${Math.max(1, panelH * 0.10)}" fill="#fff" opacity="0.7"/>`);
  } else if (role === 'combiner') {
    // Combiner: вертикальная щель + горизонтальная шина в верхней трети.
    // Стираем стандартную верхнюю панель — у combiner просто плоская дверь
    parts.push(`<rect x="${x0+5}" y="${yTop + H*0.20}" width="${W-10}" height="${H*0.06}" fill="${COLORS.busbar}" stroke="${COLORS.busbarEdge}" stroke-width="0.5"/>`);
    parts.push(`<rect x="${x0+5}" y="${yTop + H*0.30}" width="${W-10}" height="${H*0.06}" fill="${COLORS.busbar}" stroke="${COLORS.busbarEdge}" stroke-width="0.5"/>`);
    parts.push(`<text x="${x0 + W/2}" y="${yTop + H*0.55}" text-anchor="middle" font-size="9" font-weight="600" fill="${COLORS.busbar}" font-family="system-ui,sans-serif">DC BUS</text>`);
    // ручка двери справа
    parts.push(`<rect x="${x0 + W - 8}" y="${yTop + H*0.45}" width="3" height="${H*0.10}" fill="${COLORS.busbar}" opacity="0.7"/>`);
  }

  // 6) Полки модулей (только для master/slave)
  if (role !== 'combiner') {
    const isHundredAh = (Number(capacityAh) === 100);
    const slots = isHundredAh ? 4 : 12; // максимум модулей в шкафу
    const slotsAreaY = yTop + 3 + panelH + 3;
    const slotsAreaH = H - panelH - 10;
    const slotH = slotsAreaH / slots;
    for (let i = 0; i < slots; i++) {
      // Заполняем сверху вниз: первые modulesInCabinet — модули, остаток — заглушки.
      const sy = slotsAreaY + i * slotH;
      const filled = i < modulesInCabinet;
      if (filled) {
        // Модуль: основной фон + тонкая верхняя/нижняя подсветка
        parts.push(`<rect x="${x0+5}" y="${sy+1}" width="${W-10}" height="${slotH-2}" fill="${COLORS.module}" stroke="${COLORS.moduleEdge}" stroke-width="0.5"/>`);
        // блик сверху
        parts.push(`<line x1="${x0+6}" y1="${sy+2}" x2="${x0+W-6}" y2="${sy+2}" stroke="${COLORS.moduleHi}" stroke-width="0.5" opacity="0.6"/>`);
        // декоративный кружок-индикатор слева
        const cy = sy + slotH/2;
        if (slotH > 6) {
          parts.push(`<circle cx="${x0+10}" cy="${cy}" r="1.4" fill="#90caf9" opacity="0.85"/>`);
        }
      } else {
        // Заглушка (blank panel) — серее, с диагональной штриховкой
        parts.push(`<rect x="${x0+5}" y="${sy+1}" width="${W-10}" height="${slotH-2}" fill="${COLORS.empty}" stroke="${COLORS.moduleEdge}" stroke-width="0.5" opacity="0.55"/>`);
      }
    }
  }

  // 7) Подпись под шкафом
  if (label) {
    parts.push(`<text x="${x0 + W/2}" y="${y0 + 22}" text-anchor="middle" font-size="9" fill="${COLORS.label}" font-family="system-ui,sans-serif">${escXml(label)}</text>`);
  }

  return parts.join('');
}

// Главная функция: генерирует SVG-сборку из spec'а (результата
// s3LiIonType.buildSystem). Возвращает строку с <svg>.
export function renderS3IsoSvg(spec, opts = {}) {
  if (!spec || !Array.isArray(spec.cabinets) || !spec.cabinets.length) return '';
  const cabinets = spec.cabinets;
  const W = 60, H = 180, D = 50;
  const gap = 8;
  const ox = D * 0.55;       // смещение по X для top/side
  const oyAbs = D * 0.35;    // абсолютное смещение по Y
  const padL = 16, padR = 24, padT = 18, padB = 30;
  const totalW = padL + cabinets.length * W + (cabinets.length - 1) * gap + ox + padR;
  const totalH = padT + H + oyAbs + padB;
  // capacityAh: первая попавшаяся «реальная» (master/slave) ячейка имеет соответствующую плотность.
  const capacityAh = opts.capacityAh || 50;

  const drawn = [];
  cabinets.forEach((c, idx) => {
    const x0 = padL + idx * (W + gap);
    const y0 = padT + H;   // нижняя кромка фронта
    const role = c.role;
    const modulesInCabinet = Number(c.modulesInCabinet) || 0;
    const emptySlots = Number(c.emptySlots) || 0;
    const label = (c.model || '').replace(/^.*?-(\w{1,2})$/, '-$1').slice(-3) || (role[0] || '?').toUpperCase();
    drawn.push(drawCabinet({
      x0, y0, W, H, D, role, modulesInCabinet, emptySlots, capacityAh,
      label: c.model || role,
    }));
  });

  // Заголовок-легенда
  const totalReal = cabinets.filter(c => c.role !== 'combiner').length;
  const legendTxt = `${cabinets.length} шкаф(ов): ` +
    cabinets.filter(c => c.role === 'master').length + '×master · ' +
    cabinets.filter(c => c.role === 'slave').length + '×slave' +
    (cabinets.some(c => c.role === 'combiner') ? ' + 1×combiner' : '');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="background:#f7f9fc;border:1px solid #d6dde6;border-radius:6px">
    <text x="${padL}" y="12" font-size="10" fill="${COLORS.labelMuted}" font-family="system-ui,sans-serif">${escXml(legendTxt)}</text>
    ${drawn.join('\n')}
  </svg>`;
}
