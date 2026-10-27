// import-export.js — Exportar/importar el libro (JSON y TXT) + borrar todo.

import Storage from './storage.js';
import { toast } from './ui.js';

const APP_ID = 'mi-libro-de-recetas';

function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function payload() {
  return {
    app: APP_ID,
    version: 1,
    exportedAt: new Date().toISOString(),
    favorites: Storage.getFavorites(),
    history: Storage.getHistory(),
    settings: Storage.getSettings(),
  };
}

function exportJson() {
  const data = payload();
  download(`${APP_ID}-${stamp()}.json`, JSON.stringify(data, null, 2));
  toast('JSON exportado', 'success');
}

function exportTxt() {
  const favs = Storage.getFavorites();
  const lines = [
    'MI LIBRO DE RECETAS',
    `Exportado: ${new Date().toLocaleString('es')}`,
    `Recetas guardadas: ${favs.length}`,
    '='.repeat(46),
    '',
  ];
  favs.forEach((f, i) => {
    lines.push(`${i + 1}. ${f.name}`);
    lines.push(`   ${[f.category, f.area].filter(Boolean).join(' · ')}`);
    lines.push(`   Puntuación: ${f.rating || 0}/5`);
    if (f.note) lines.push(`   Nota: ${f.note}`);
    if (f.detail && f.detail.siteUrl) lines.push(`   ${f.detail.siteUrl}`);
    lines.push('');
  });
  const hist = Storage.getHistory();
  if (hist.length) {
    lines.push('HISTORIAL DE BÚSQUEDAS', '-'.repeat(46));
    hist.forEach((h) => lines.push(` - ${(h.terms || []).join(', ')}`));
  }
  download(`${APP_ID}-${stamp()}.txt`, `\ufeff${lines.join('\r\n')}`, 'text/plain');
  toast('TXT exportado', 'success');
}

function mergeFavorites(existing, incoming) {
  const byKey = new Map(existing.map((f) => [`${f.source}:${f.id}`, f]));
  for (const f of incoming) {
    if (!f || typeof f !== 'object' || f.id === undefined || f.id === null) continue;
    const k = `${f.source || 'themealdb'}:${f.id}`;
    if (!byKey.has(k)) {
      byKey.set(k, {
        source: f.source || 'themealdb',
        id: String(f.id),
        name: String(f.name || 'Receta'),
        image: f.image || '',
        category: f.category || null,
        area: f.area || null,
        rating: Math.max(0, Math.min(5, Number(f.rating) || 0)),
        note: typeof f.note === 'string' ? f.note.slice(0, 2000) : '',
        addedAt: Number(f.addedAt) || Date.now(),
        detail: f.detail && typeof f.detail === 'object' ? f.detail : null,
      });
    }
  }
  return Array.from(byKey.values());
}

function mergeHistory(existing, incoming) {
  const byKey = new Map(existing.map((h) => [h.key, h]));
  for (const h of incoming) {
    if (!h || typeof h !== 'object') continue;
    const key = h.key || (Array.isArray(h.terms) ? h.terms.join('|') : '');
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, { key, terms: h.terms || [], ts: Number(h.ts) || Date.now() });
  }
  return Array.from(byKey.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 20);
}

async function importFile(onChanged) {
  const input = document.getElementById('import-file');
  const result = document.getElementById('import-result');
  const file = input && input.files && input.files[0];
  const setMsg = (msg, type) => {
    if (!result) return;
    result.textContent = msg;
    result.className = `import-result${type ? ` is-${type}` : ''}`;
  };

  if (!file) { setMsg('Elige un archivo .json primero', 'error'); return; }

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    setMsg('El archivo no es JSON válido', 'error');
    return;
  }

  if (!data || typeof data !== 'object' || (!Array.isArray(data.favorites) && !Array.isArray(data.history))) {
    setMsg('El archivo no parece una exportación de este libro', 'error');
    return;
  }

  const mode = (document.querySelector('input[name="import-mode"]:checked') || {}).value || 'merge';
  const favsIn = Array.isArray(data.favorites) ? data.favorites : [];
  const histIn = Array.isArray(data.history) ? data.history : [];

  if (mode === 'replace') {
    Storage.setFavorites(mergeFavorites([], favsIn));
    Storage.setHistory(mergeHistory([], histIn));
    if (data.settings && typeof data.settings === 'object') Storage.setSettings(data.settings);
  } else {
    Storage.setFavorites(mergeFavorites(Storage.getFavorites(), favsIn));
    Storage.setHistory(mergeHistory(Storage.getHistory(), histIn));
  }

  if (typeof onChanged === 'function') onChanged();
  setMsg(`Importación ${mode === 'replace' ? 'completa' : 'combinada'}: ${favsIn.length} receta(s), ${histIn.length} búsqueda(s)`, 'ok');
  toast('Datos importados', 'success');
}

function wipeAll(onChanged) {
  const favs = Storage.getFavorites().length;
  const ok = confirm(`¿Borrar TODO tu libro local?\n\nSe eliminarán ${favs} receta(s) guardada(s), notas, puntuaciones e historial. Esta acción no se puede deshacer.`);
  if (!ok) return;
  Storage.clearAll();
  if (typeof onChanged === 'function') onChanged();
  toast('Todos los datos locales fueron borrados', 'success');
}

export function initDataDialog({ onChanged } = {}) {
  const dlg = document.getElementById('data-dialog');
  if (!dlg) return;

  document.getElementById('btn-export-json')?.addEventListener('click', exportJson);
  document.getElementById('btn-export-txt')?.addEventListener('click', exportTxt);
  document.getElementById('btn-import')?.addEventListener('click', () => importFile(onChanged));
  document.getElementById('btn-wipe-all')?.addEventListener('click', () => wipeAll(onChanged));
  document.getElementById('import-file')?.addEventListener('change', () => {
    const result = document.getElementById('import-result');
    if (result) { result.textContent = ''; result.className = 'import-result'; }
  });
}
