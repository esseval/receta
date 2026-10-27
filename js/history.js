// history.js — Historial de búsquedas por ingredientes (localStorage).

import Storage from './storage.js';
import { normalize } from './dict.js';
import { escapeHtml } from './ui.js';

const MAX_ITEMS = 20;

let onRestore = null;

export function initHistory({ restore } = {}) {
  onRestore = restore;

  const clearBtn = document.getElementById('btn-clear-history');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    Storage.setHistory([]);
    render();
  });

  const list = document.getElementById('history-list');
  if (list) list.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-hist]');
    if (!chip) return;
    const entry = Storage.getHistory().find((h) => h.key === chip.dataset.hist);
    if (entry && onRestore) onRestore(entry.terms || []);
  });

  document.addEventListener('data:changed', render);
  render();
}

export function pushHistory(terms) {
  if (!Array.isArray(terms) || !terms.length) return;
  const key = terms.map((t) => normalize(t)).join('|');
  const list = Storage.getHistory().filter((h) => h.key !== key);
  list.unshift({ key, terms: terms.slice(0, 12), ts: Date.now() });
  Storage.setHistory(list.slice(0, MAX_ITEMS));
  render();
}

function ago(ts) {
  const diff = Math.max(0, Date.now() - (ts || 0));
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

function render() {
  const listEl = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  if (!listEl) return;

  const list = Storage.getHistory();
  listEl.innerHTML = list.map((h) => `
    <button type="button" class="chip" data-hist="${escapeHtml(h.key)}" title="Repetir búsqueda">
      ${escapeHtml((h.terms || []).join(', '))}
      <span class="chip-alt">${escapeHtml(ago(h.ts))}</span>
    </button>`).join('');

  if (empty) empty.hidden = list.length > 0;
  const section = document.getElementById('history-section');
  if (section) section.hidden = false;
}
