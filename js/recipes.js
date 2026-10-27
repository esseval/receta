// recipes.js — Buscador por ingredientes / por nombre y renderizado de resultados.

import { fetchRecipes, searchByName, fetchList } from './api.js';
import { toQueryTerm, suggestFromDict, normalize } from './dict.js';
import { state, setQuery } from './state.js';
import { Storage } from './storage.js';
import { escapeHtml, toast, setStatus, attachImgFallback, imageSize } from './ui.js';
import * as book from './book.js';
import { pushHistory } from './history.js';

const MAX_TERMS = 12;
const MAX_TERM_LEN = 40;

let terms = [];           // ingredientes en texto del usuario
let visible = [];         // resultados tal como se están mostrando
let onOpen = null;
let mode = 'ingredients'; // 'ingredients' | 'name'
let sortMode = 'match';

export function initRecipes({ open } = {}) {
  onOpen = open;
  sortMode = Storage.getSortMode();

  const form = document.getElementById('ingredient-form');
  const input = document.getElementById('ingredient-input');
  const btnSearch = document.getElementById('btn-search');
  const btnClear = document.getElementById('btn-clear');
  const nameForm = document.getElementById('name-form');
  const nameInput = document.getElementById('name-input');
  const sortSelect = document.getElementById('sort-select');
  const chips = document.getElementById('chips');

  if (sortSelect) {
    sortSelect.value = sortMode;
    sortSelect.addEventListener('change', () => {
      sortMode = sortSelect.value;
      Storage.setSortMode(sortMode);
      renderResults();
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = input.value.trim();
      if (!raw) { btnSearch && btnSearch.focus(); return; }
      raw.split(',').forEach((piece) => addTerm(piece));
      input.value = '';
      input.focus();
    });
  }

  if (btnSearch) btnSearch.addEventListener('click', () => runIngredientSearch());

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      terms = [];
      renderChips();
      input && input.focus();
    });
  }

  if (chips) {
    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-term]');
      if (!btn) return;
      terms = terms.filter((t) => t !== btn.dataset.term);
      renderChips();
    });
  }

  if (nameForm) {
    nameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      runNameSearch(nameInput.value.trim());
    });
  }

  // Pestañas
  const tabIng = document.getElementById('tab-ingredients');
  const tabName = document.getElementById('tab-name');
  const panelIng = document.getElementById('panel-ingredients');
  const panelName = document.getElementById('panel-name');
  const switchTab = (which) => {
    mode = which;
    const isIng = which === 'ingredients';
    tabIng.classList.toggle('is-active', isIng);
    tabName.classList.toggle('is-active', !isIng);
    tabIng.setAttribute('aria-selected', String(isIng));
    tabName.setAttribute('aria-selected', String(!isIng));
    panelIng.hidden = !isIng;
    panelName.hidden = isIng;
    setStatus('');
  };
  tabIng && tabIng.addEventListener('click', () => switchTab('ingredients'));
  tabName && tabName.addEventListener('click', () => switchTab('name'));

  const resultsGrid = document.getElementById('results-grid');
  book.bindCardFavorites(resultsGrid, (card) => visible[Number(card.dataset.idx)]);
  if (resultsGrid && onOpen) {
    resultsGrid.addEventListener('click', (e) => {
      if (e.target.closest('[data-fav]')) return;
      const card = e.target.closest('[data-idx]');
      if (!card) return;
      const recipe = visible[Number(card.dataset.idx)];
      if (!recipe) return;
      e.preventDefault();
      onOpen({ source: recipe.source, id: recipe.id, summary: recipe });
    });
  }

  document.addEventListener('book:changed', () => {
    if ((state.results || []).length) renderResults();
  });

  populateDatalist();
  renderChips();
}

/* ----------------------------- ingredientes ---------------------------- */

function addTerm(raw) {
  const value = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!value) return;
  if (value.length > MAX_TERM_LEN) {
    toast(`Máximo ${MAX_TERM_LEN} caracteres por ingrediente`, 'error');
    return;
  }
  const key = normalize(value);
  if (terms.some((t) => normalize(t) === key)) {
    toast('Ese ingrediente ya está en la lista');
    return;
  }
  if (terms.length >= MAX_TERMS) {
    toast(`Máximo ${MAX_TERMS} ingredientes por búsqueda`, 'error');
    return;
  }
  terms.push(value);
  renderChips();
}

export function getTerms() {
  return terms.slice();
}

export function restoreTerms(list) {
  terms = (Array.isArray(list) ? list : [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, MAX_TERMS);
  renderChips();
}

function renderChips() {
  const wrap = document.getElementById('chips');
  const counter = document.getElementById('chips-counter');
  if (!wrap) return;

  wrap.innerHTML = terms.map((t) => {
    const mapped = toQueryTerm(t);
    const alt = mapped.alt ? `<span class="chip-alt">→ ${escapeHtml(mapped.alt)}</span>` : '';
    return `<span class="chip">
      ${escapeHtml(mapped.label)} ${alt}
      <button type="button" data-term="${escapeHtml(t)}" aria-label="Quitar ${escapeHtml(t)}">✕</button>
    </span>`;
  }).join('');

  if (counter) {
    counter.textContent = terms.length
      ? `${terms.length}/${MAX_TERMS} ingredientes listos para buscar`
      : 'Agrega ingredientes para empezar.';
  }
}

async function populateDatalist() {
  const dl = document.getElementById('ingredient-list');
  if (!dl) return;
  const seen = new Set();
  const options = [];

  const push = (label) => {
    const k = normalize(label);
    if (!k || seen.has(k)) return;
    seen.add(k);
    options.push(label);
  };

  // sugerencias del diccionario (es + en)
  ['a', 'e', 'i', 'o', 'u', 'c', 'p', 't', 'l', 's'].forEach((letter) => {
    suggestFromDict(letter, 40).forEach(({ es, en }) => { push(es); push(en); });
  });

  dl.innerHTML = options.map((o) => `<option value="${escapeHtml(o)}"></option>`).join('');

  try {
    const list = await fetchList('ingredients');
    const names = (list.items || []).map((i) => i.name);
    const merged = [...new Set([...options, ...names])];
    dl.innerHTML = merged.map((o) => `<option value="${escapeHtml(o)}"></option>`).join('');
  } catch (e) {
    console.warn('No se pudo cargar la lista de ingredientes:', e.message);
  }
}

/* -------------------------------- búsquedas ---------------------------- */

export async function runIngredientSearch() {
  if (!terms.length) {
    toast('Agrega al menos un ingrediente', 'error');
    const input = document.getElementById('ingredient-input');
    input && input.focus();
    return;
  }

  const mapped = terms.map(toQueryTerm);
  const query = mapped.map((m) => m.term);

  setStatus('Buscando recetas con tus ingredientes…', 'loading');
  const section = document.getElementById('results-section');
  if (section) section.hidden = false;

  try {
    const res = await fetchRecipes(query);
    setQuery(terms, res.userKeys || query);
    state.results = res.recipes || [];
    state.mode = res.mode || 'scored';
    state.source = res.source || 'themealdb';

    renderResults(res.warnings || []);
    if (state.results.length) {
      setStatus(`${state.results.length} recetas · ordenadas por coincidencia`, '');
      pushHistory(terms.slice());
    } else {
      setStatus('Sin coincidencias con esos ingredientes', 'error');
      pushHistory(terms.slice());
    }
  } catch (e) {
    setStatus(e.message, 'error');
    toast(e.message, 'error');
  }
}

export async function runNameSearch(q) {
  if (!q) { toast('Escribe el nombre de una receta', 'error'); return; }
  setStatus(`Buscando “${q}”…`, 'loading');
  const section = document.getElementById('results-section');
  if (section) section.hidden = false;
  try {
    const res = await searchByName(q);
    state.results = res.recipes || [];
    state.mode = 'name';
    state.source = 'themealdb';
    setQuery([q], []);
    renderResults(res.warnings || []);
    setStatus(state.results.length ? `${state.results.length} recetas encontradas` : `Sin resultados para “${q}”`, state.results.length ? '' : 'error');
  } catch (e) {
    setStatus(e.message, 'error');
    toast(e.message, 'error');
  }
}

/* ------------------------------- resultados ---------------------------- */

function sortResults(list) {
  const arr = list.slice();
  if (sortMode === 'name') return arr.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (sortMode === 'category') {
    return arr.sort((a, b) => String(a.category || 'zz').localeCompare(String(b.category || 'zz'))
      || a.name.localeCompare(b.name, 'es'));
  }
  return arr.sort((a, b) => {
    const pa = a.match ? a.match.pct : -1;
    const pb = b.match ? b.match.pct : -1;
    if (pb !== pa) return pb - pa;
    const ca = a.match ? a.match.count : -1;
    const cb = b.match ? b.match.count : -1;
    if (cb !== ca) return cb - ca;
    return a.name.localeCompare(b.name, 'es');
  });
}

function renderResults(warnings = []) {
  const grid = document.getElementById('results-grid');
  const empty = document.getElementById('results-empty');
  const countEl = document.getElementById('results-count');
  const warnEl = document.getElementById('results-warnings');
  const section = document.getElementById('results-section');
  if (!grid) return;

  visible = sortResults(state.results || []);

  if (section) section.hidden = visible.length === 0 && !(warnings && warnings.length);
  if (countEl) countEl.textContent = visible.length ? `${visible.length} recetas` : '';
  if (warnEl) {
    const text = (warnings || []).filter(Boolean).join(' · ');
    warnEl.hidden = !text;
    warnEl.textContent = text;
  }

  grid.innerHTML = visible.map(cardHtml).join('');
  if (empty) empty.hidden = visible.length > 0;

  grid.querySelectorAll('img').forEach((img) => attachImgFallback(img));
}

function cardHtml(r, idx) {
  const fav = book.isFavorite(r.source, r.id);
  const m = r.match;
  const total = state.queryKeys.length;
  const pct = m ? m.pct : null;
  const pctCls = pct === null ? '' : (pct >= 70 ? ' is-high' : (pct >= 40 ? ' is-mid' : ''));

  const badges = [
    r.category ? `<span class="badge">${escapeHtml(r.category)}</span>` : '',
    r.area ? `<span class="badge badge-soft">${escapeHtml(r.area)}</span>` : '',
    r.source === 'spoon' ? '<span class="badge">Spoonacular</span>' : '',
  ].filter(Boolean).join('');

  let tags = '';
  if (m) {
    const have = (m.used || []).slice(0, 3).map((t) => `<span class="tag tag-have">✓ ${escapeHtml(t)}</span>`);
    const missing = (m.required || []).slice(0, 2).map((t) => `<span class="tag tag-missing">te falta ${escapeHtml(t)}</span>`);
    const extraRest = (m.used || []).length > 3 ? `<span class="tag tag-extra">+${(m.used || []).length - 3}</span>` : '';
    const missingRest = (m.required || []).length > 2 ? `<span class="tag tag-extra">+${(m.required || []).length - 2} más</span>` : '';
    tags = `<div class="tag-row">${have.join('')}${extraRest}${missing.join('')}${missingRest}</div>`;
  }

  const matchLine = m
    ? `<span>Usa <strong>${m.count}</strong> de tus <strong>${total}</strong> ingredientes</span>`
    : `<span>Búsqueda por nombre</span>`;

  return `
    <article class="recipe-card" data-idx="${idx}">
      <button type="button" class="recipe-media" data-open="1" aria-label="Abrir ${escapeHtml(r.name)}">
        ${r.image ? `<img src="${escapeHtml(imageSize(r.image, 'medium'))}" alt="" loading="lazy">` : '<span class="placeholder">🍽️</span>'}
        ${pct !== null ? `<span class="pct-badge${pctCls}">${pct}%</span>` : ''}
        ${fav ? '<span class="fav-mark" aria-hidden="true">★</span>' : ''}
      </button>
      <div class="recipe-body">
        <h3 class="recipe-title"><button type="button" data-open="1">${escapeHtml(r.name)}</button></h3>
        <div class="recipe-meta">${badges}</div>
        <div class="match-line">${matchLine}</div>
        ${tags}
        <div class="recipe-actions">
          <button type="button" class="btn btn-ghost btn-small ${fav ? 'is-active' : ''}" data-fav="1"
            title="${fav ? 'Quitar de tu libro' : 'Guardar en tu libro'}">${fav ? '★ En tu libro' : '☆ Guardar'}</button>
          <button type="button" class="btn btn-primary btn-small" data-open="1">Ver receta</button>
        </div>
      </div>
    </article>`;
}
