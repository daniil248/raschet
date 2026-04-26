// shared/config-io.js — единый helper для экспорта/импорта конфигураций
// конфигураторов в JSON-файл. Используется panel-config, ups-config,
// pdu-config, suppression-config, rack-config и т.п.
//
// Схема файла:
//   {
//     schema: 'raschet.<module>.v1',
//     savedAt: '2026-04-26T...',
//     appVersion: '0.59.x',
//     payload: { <lsKey>: <jsonValue>, ..., _extra: {...} }
//   }
//
// API:
//   exportConfig({ schema, lsKeys, extra, filename, appVersion })
//   importConfig(file, { schema })  -> Promise<{payload, raw}>
//   restoreLsKeys(payload)          -> восстанавливает LS-ключи
//   download(blob, filename)        -> утилита

export function download(text, filename, mime = 'application/json') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch {} }, 300);
}

export function exportConfig({ schema, lsKeys = [], extra = null, filename, appVersion = '' }) {
  const payload = {};
  for (const k of lsKeys) {
    const raw = localStorage.getItem(k);
    if (raw == null) continue;
    try { payload[k] = JSON.parse(raw); }
    catch { payload[k] = raw; }
  }
  if (extra && typeof extra === 'object') payload._extra = extra;
  const obj = {
    schema,
    savedAt: new Date().toISOString(),
    appVersion,
    payload,
  };
  const fname = filename || `${schema}-${Date.now()}.json`;
  download(JSON.stringify(obj, null, 2), fname);
  return obj;
}

export function importConfig(file, { schema } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Файл не выбран'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Ошибка чтения файла'));
    fr.onload = () => {
      try {
        const obj = JSON.parse(String(fr.result || ''));
        if (schema && obj.schema !== schema) {
          return reject(new Error(`Несовпадение схемы: ожидалось "${schema}", получено "${obj.schema || '—'}"`));
        }
        resolve({ raw: obj, payload: obj.payload || {} });
      } catch (e) { reject(new Error('Не удалось разобрать JSON: ' + e.message)); }
    };
    fr.readAsText(file, 'utf-8');
  });
}

// Восстанавливает в localStorage все ключи payload (кроме _extra).
// Возвращает количество восстановленных ключей.
export function restoreLsKeys(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  let n = 0;
  for (const k of Object.keys(payload)) {
    if (k === '_extra') continue;
    const v = payload[k];
    try {
      const s = (typeof v === 'string') ? v : JSON.stringify(v);
      localStorage.setItem(k, s);
      n++;
    } catch {}
  }
  return n;
}

// Хелпер: подвязать к двум кнопкам (export / import) на странице.
// opts:
//   schema            — строка типа 'raschet.panel-config.v1'
//   lsKeys            — список LS-ключей для бэкапа
//   filenamePrefix    — имя файла без даты (опционально)
//   appVersion        — для записи в файл
//   getExtra()        — функция, возвращающая дополнительные данные (необязательно)
//   onAfterImport(payload, raw) — вызывается после успешного восстановления
//   toast(msg, type)  — функция для уведомлений (опционально)
export function wireExportImport({
  exportBtn, importBtn, fileInput,
  schema, lsKeys, filenamePrefix, appVersion = '',
  getExtra = null, onAfterImport = null, toast = null,
}) {
  const notify = (m, t) => {
    if (typeof toast === 'function') toast(m, t);
    else console.log('[config-io]', t || 'info', m);
  };

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      try {
        const fname = (filenamePrefix || schema) + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
        const extra = (typeof getExtra === 'function') ? getExtra() : null;
        exportConfig({ schema, lsKeys, extra, filename: fname, appVersion });
        notify('Конфигурация выгружена в файл', 'ok');
      } catch (e) {
        notify('Ошибка экспорта: ' + e.message, 'err');
      }
    });
  }

  if (importBtn && fileInput) {
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      try {
        const { payload, raw } = await importConfig(f, { schema });
        const n = restoreLsKeys(payload);
        notify(`Импортировано ключей: ${n}. Перезагрузите страницу.`, 'ok');
        if (typeof onAfterImport === 'function') onAfterImport(payload, raw);
      } catch (e) {
        notify('Ошибка импорта: ' + e.message, 'err');
      } finally {
        fileInput.value = '';
      }
    });
  }
}
