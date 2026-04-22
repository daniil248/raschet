#!/usr/bin/env node
/* audit-design.mjs — Phase 1.26.9
   Проверяет, что ни один модуль не ставит max-width:<число>px + margin:0 auto
   на корневую обёртку (body > main, .*-wrap, .page-wrap). Запуск:
     node scripts/audit-design.mjs
   Выход 0 — ок. Выход 1 — найдены нарушения (печатает файл:строку). */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'scripts']);
// известные wrapper-классы и селекторы, которым НЕ полагается max-width/margin auto
const WRAPPER_PATTERNS = [
  /^\s*body\s*>\s*main\b/,
  /^\s*\.(?:page|sc|rc|cb|mv|pdu|ups|xf|el|bat|cat|log|mdc|psy|sup|pc|tr|app)-wrap\b/,
  /^\s*main\s*\{/,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (extname(p) === '.css' && !p.endsWith(join('shared', 'styles', 'base.css'))) out.push(p);
  }
  return out;
}

function findBlocks(css) {
  // наивно — ищем блоки `selector { ... }` (без вложенных скобок).
  const re = /([^{}]+?)\{([^{}]*)\}/g;
  const blocks = [];
  let m, line = 1, pos = 0;
  while ((m = re.exec(css))) {
    const selLine = css.slice(0, m.index).split('\n').length;
    blocks.push({ selector: m[1].trim(), body: m[2], line: selLine });
  }
  return blocks;
}

const issues = [];
for (const file of walk(ROOT)) {
  const css = readFileSync(file, 'utf8');
  for (const b of findBlocks(css)) {
    const isWrapper = WRAPPER_PATTERNS.some(re => re.test(b.selector));
    if (!isWrapper) continue;
    const mw = /max-width\s*:\s*\d+(?:\.\d+)?(?:px|rem|em|vw)/.exec(b.body);
    const ma = /margin\s*:[^;]*\bauto\b/.exec(b.body);
    if (mw && ma) {
      issues.push(`${file}:${b.line}  ${b.selector}  — max-width + margin:auto (нарушает 1.26.1)`);
    }
  }
}

if (issues.length) {
  console.error('❌ Найдены нарушения full-width policy:');
  for (const i of issues) console.error('  ' + i);
  console.error(`\nВсего: ${issues.length}. См. ROADMAP 1.26.1.`);
  process.exit(1);
} else {
  console.log('✔ Full-width policy OK — нарушений не найдено.');
}
