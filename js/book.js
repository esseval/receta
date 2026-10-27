// book.js — "Mi libro": favoritos con puntuación y notas (localStorage).

import Storage from './storage.js';
import { fetchMeal, debounce } from './api.js';
import { escapeHtml, toast, starsHtml, attachImgFallback, imageSize } from './ui.js';

let onOpen = null;
let filterText = '';
let minRating = 0;
let busy = false;

export function mealIdOf(recipe) {
  if (!recipe) return null;
  return recipe.source === 'spoon' ? `spoon-${recipe.id}` : String(recipe.id);
}

export function keyOf(source, id) {
  return `${source}:${id}`;
}

export function getFavorite(source, id) {
  return Storage.getFavorites().find((f) => f.source === source && String(f.id) === String(id)) || null;
}

export function isFavorite(source, id) {
  return getFavorite(source, id) !== null;
}

export function initBook({ open } = {}) {
  onOpen = open;
  const filter = document.getElementById('book-filter');
  const rating = document.getElementById('book-rating');

  if (filter) filter.addEventListener('input', debounce(() => { filterText = filter.value.trim().toLowerCase(); renderBook(); }, 220));
  if (rating) rating.addEventListener('change', () => { minRating = Number(rating.value) || 0; renderBook(); });

  const grid = document.getElementById('book-grid');
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-key]');
    if (!card) return;
    const [source, id] = card.dataset.key.split('|');

    const starBtn = e.target.closest('button[data-rating]');
    if (starBtn) {
      e.preventDefault();
      setRating(source, id, Number(starBtn.dataset.rating));
      return;
    }
    if (e.target.closest('[data-remove]')) {
      e.preventDefault();
      removeFavorite(source, id);
      return;
    }
    if (e.target.closest('[data-open]')) {
      e.preventDefault();
      const fav = getFavorite(source, id);
      if (fav && onOpen) onOpen({ source, id, summary: fav, detail: fav.detail });
    }
  });

  renderBook();
}

function visibleFavorites() {
  return Storage.getFavorites().filter((f) => {
    if (minRating && (f.rating || 0) < minRating) return false;
    if (filterText) {
      const hay = `${f.name} ${f.category || ''} ${f.area || ''} ${f.note || ''}`.toLowerCase();
      if (!hay.includes(filterText)) return false;
    }
    return true;
  });
}

export function renderBook() {
  const grid = document.getElementById('book-grid');
  const empty = document.getElementById('book-empty');
  if (!grid) return;

  const list = visibleFavorites().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  grid.innerHTML = list.map(cardHtml).join('');
  if (empty) empty.hidden = list.length > 0 || !!(filterText || minRating);

  grid.querySelectorAll('.recipe-media img, .detail-img').forEach((img) => attachImgFallback(img));
  document.dispatchEvent(new CustomEvent('book:changed'));
}

function cardHtml(f) {
  const key = keyOf(f.source, f.id);
  const rating = f.rating || 0;
  const note = f.note ? `<p class="match-line">${escapeHtml(f.note.slice(0, 90))}${f.note.length > 90 ? '…' : ''}</p>` : '';
  return `
    <article class="recipe-card" data-key="${escapeHtml(f.source)}|${escapeHtml(String(f.id))}">
      <button type="button" class="recipe-media" data-open="1" aria-label="Abrir ${escapeHtml(f.name)}">
        ${f.image ? `<img src="${escapeHtml(imageSize(f.image))}" alt="" loading="lazy">` : '<span class="placeholder">🍽️</span>'}
        <span class="fav-mark" aria-hidden="true">★</span>
      </button>
      <div class="recipe-body">
        <h3 class="recipe-title"><button type="button" data-open="1">${escapeHtml(f.name)}</button></h3>
        <div class="recipe-meta">
          ${f.category ? `<span class="badge">${escapeHtml(f.category)}</span>` : ''}
          ${f.area ? `<span class="badge badge-soft">${escapeHtml(f.area)}</span>` : ''}
        </div>
        ${note}
        <div class="detail-rating-row">${starsHtml(rating, { small: true })}</div>
        <div class="recipe-actions">
          <button type="button" class="btn btn-ghost btn-small" data-remove="1" title="Quitar del libro">✕ Quitar</button>
          <button type="button" class="btn btn-primary btn-small" data-open="1">Ver receta</button>
        </div>
      </div>
    </article>`;
}

export async function addFavorite(recipe) {
  const source = recipe.source || 'themealdb';
  const id = String(recipe.id);
  if (getFavorite(source, id)) return getFavorite(source, id);

  let detail = null;
  try {
    detail = await fetchMeal(recipe.source === 'spoon' ? `spoon-${id}` : id);
  } catch (e) {
    console.warn('addFavorite detail', e);
  }

  const record = {
    source,
    id,
    name: recipe.name || (detail && detail.name) || 'Receta',
    image: recipe.image || (detail && detail.image) || '',
    category: recipe.category || (detail && detail.category) || null,
    area: recipe.area || (detail && detail.area) || null,
    rating: 0,
    note: '',
    addedAt: Date.now(),
    detail: detail || null,
  };

  const list = Storage.getFavorites();
  list.unshift(record);
  Storage.setFavorites(list);
  renderBook();
  toast('Guardada en tu libro ★', 'success');
  return record;
}

export function removeFavorite(source, id) {
  const list = Storage.getFavorites().filter((f) => !(f.source === source && String(f.id) === String(id)));
  Storage.setFavorites(list);
  renderBook();
  toast('Quitada de tu libro');
}

export async function toggleFavorite(recipe) {
  const source = recipe.source || 'themealdb';
  const id = String(recipe.id);
  if (isFavorite(source, id)) {
    removeFavorite(source, id);
    return null;
  }
  return addFavorite(recipe);
}

export function updateFavorite(source, id, patch) {
  const list = Storage.getFavorites();
  const idx = list.findIndex((f) => f.source === source && String(f.id) === String(id));
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  Storage.setFavorites(list);
  renderBook();
  return list[idx];
}

export function setRating(source, id, value) {
  const rec = updateFavorite(source, id, { rating: Math.max(0, Math.min(5, value)) });
  if (rec) toast(`Puntuación: ${rec.rating}★`, 'success');
  return rec;
}

export function setNote(source, id, note) {
  return updateFavorite(source, id, { note: String(note).slice(0, 2000) });
}

/** Estrella para tarjetas de resultados (añadir/quitar del libro). */
export function bindCardFavorites(container, getRecipe) {
  if (!container) return;
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fav]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      const card = btn.closest('[data-recipe], [data-idx]');
      if (!card) return;
      const recipe = card.dataset.recipe
        ? JSON.parse(card.dataset.recipe)
        : (getRecipe ? getRecipe(card) : null);
      if (!recipe) return;
      const added = await toggleFavorite(recipe);
      const fav = added !== null && isFavorite(recipe.source, recipe.id);
      btn.classList.toggle('is-active', fav);
      btn.textContent = fav ? '★ En tu libro' : '☆ Guardar';
      btn.title = fav ? 'Quitar de tu libro' : 'Guardar en tu libro';
      const mark = card.querySelector('.fav-mark');
      if (fav && !mark) {
        const media = card.querySelector('.recipe-media');
        if (media) media.insertAdjacentHTML('beforeend', '<span class="fav-mark" aria-hidden="true">★</span>');
      } else if (!fav && mark) {
        mark.remove();
      }
    } catch (err) {
      toast(err.message || 'No se pudo guardar la receta', 'error');
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });
}
