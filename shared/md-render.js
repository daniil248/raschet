// Phase 1.20.40: простой markdown → HTML рендерер для roadmap.html и
// changelog.html. Поддерживает: заголовки, списки, таблицы, inline-код,
// bold, italic, ссылки, blockquote, горизонтальные разделители и
// подсветку версий вида v0.57.14.

export function mdToHtml(md) {
  const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const lines = md.split('\n');
  const out = [];
  let inList = false, inTable = false, inCodeBlock = false;
  const flushList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const flushTable = () => { if (inTable) { out.push('</tbody></table>'); inTable = false; } };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.startsWith('```')) {
      flushList(); flushTable();
      if (inCodeBlock) { out.push('</code></pre>'); inCodeBlock = false; }
      else { out.push('<pre><code>'); inCodeBlock = true; }
      continue;
    }
    if (inCodeBlock) { out.push(esc(ln)); continue; }
    const h = ln.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushList(); flushTable();
      out.push(`<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (ln.startsWith('|') && ln.endsWith('|')) {
      const cells = ln.slice(1, -1).split('|').map(c => c.trim());
      if (!inTable) {
        flushList();
        out.push('<table><thead><tr>');
        for (const c of cells) out.push(`<th>${esc(c)}</th>`);
        out.push('</tr></thead><tbody>');
        inTable = true;
        if (lines[i + 1] && /^\|[-:\s|]+\|$/.test(lines[i + 1])) i++;
      } else {
        out.push('<tr>');
        for (const c of cells) out.push(`<td>${inlineMd(c)}</td>`);
        out.push('</tr>');
      }
      continue;
    } else if (inTable) {
      flushTable();
    }
    const li = ln.match(/^(\s*)[-*]\s+(.+)$/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMd(li[2])}</li>`);
      continue;
    }
    flushList();
    if (/^[-=]{3,}$/.test(ln.trim())) { out.push('<hr>'); continue; }
    if (ln.trim() === '') { out.push(''); continue; }
    if (ln.startsWith('> ')) {
      out.push(`<blockquote>${inlineMd(ln.slice(2))}</blockquote>`);
      continue;
    }
    out.push(`<p>${inlineMd(ln)}</p>`);
  }
  flushList(); flushTable();
  return out.join('\n');
}

export function inlineMd(s) {
  const esc = (x) => x.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let r = esc(s);
  r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
  r = r.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  r = r.replace(/__([^_]+)__/g, '<b>$1</b>');
  r = r.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  r = r.replace(/\b(v\d+\.\d+\.\d+)\b/g, '<span class="ver-badge">$1</span>');
  r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return r;
}
