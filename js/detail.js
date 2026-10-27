// detail.js — Vista de receta completa en un <dialog>:
// ingredientes + medidas, pasos, favorito, puntuación, nota y traducción.

import { fetchMeal, debounce } from './api.js';
import { state } from './state.js';
import * as book from './book.js';
import { termsMatch, glossEn } from './dict.js';
import { translateDetail } from './translate.js';
import { escapeHtml, toast, openDialog, closeDialog, starsHtml, attachImgFallback, imageSize } from './ui.js';

let dialog = null;
let bodyEl = null;
let labelEl = null;
let current = null;      // detalle completo (idioma original)
let translated = null;   // { name, steps, ingNames } en español
let viewLang = 'en';
let busy = false;

export function initDetail() {
  dialog = document.getElementById('detail-dialog');
  bodyEl = document.getElementById('detail-body');
  labelEl = document.getElementById('detail-source-label');
  if (!dialog || !bodyEl) return;

  document.getElementById('detail-close').addEventListener('click', () => closeDialog(dialog));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDialog(dialog); });

  bodyEl.addEventListener('click', handleClick);
  bodyEl.addEventListener('input', handleInput);
}

function sourceLabel(source) {
  return source === 'spoon' ? 'Receta · Spoonacular' : 'Receta · TheMealDB';
}

export async function openDetail(ref) {
  if (!dialog) return;
  const { source, id, detail } = ref || {};
  current = null;
  translated = null;
  viewLang = 'en';
  if (labelEl) labelEl.textContent = sourceLabel(source);
  bodyEl.innerHTML = '<p class="hint"><span class="spinner" aria-hidden="true"></span>Cargando receta…</p>';
  openDialog(dialog);

  try {
    if (detail) current = detail;
    if (!current) {
      const fav = book.getFavorite(source, id);
      if (fav && fav.detail) current = fav.detail;
    }
    if (!current) current = await fetchMeal(source === 'spoon' ? `spoon-${id}` : String(id));
    if (!current || !current.name) throw new Error('La receta vino vacía.');
    render();
  } catch (e) {
    bodyEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">⚠️</div>
        <h3>No se pudo cargar la receta</h3>
        <p>${escapeHtml(e.message || 'Error desconocido')}</p>
      </div>`;
  }
}

/* -------------------------------- render ------------------------------- */

/** Cada ingrediente tuyo se "queda" con un solo ingrediente de la receta. */
function claimedHave(ings) {
  const claimed = new Set();
  state.queryKeys.forEach((k) => {
    const idx = ings.findIndex((x, i) => !claimed.has(i) && termsMatch(k, x.orig));
    if (idx >= 0) claimed.add(idx);
  });
  return claimed;
}

function render() {
  const d = current;
  const fav = book.getFavorite(d.source, d.id);
  const t = viewLang === 'es' && translated ? translated : null;
  const name = t ? t.name : d.name;
  const steps = t ? t.steps : (d.steps || []);
  const ingNames = t ? t.ingNames : (d.ingredients || []).map((i) => i.name);

  const ings = (d.ingredients || []).map((ing, i) => ({
    name: ingNames[i] || ing.name,
    orig: ing.name,
    gloss: glossEn(ing.name),
    measure: ing.measure || '',
    have: false,
  }));
  const claimed = state.queryKeys.length ? claimedHave(ings) : new Set();
  ings.forEach((x, i) => { x.have = claimed.has(i); });
  const haveCount = claimed.size;

  const tags = [
    d.category ? `<span class="badge">${escapeHtml(d.category)}</span>` : '',
    d.area ? `<span class="badge badge-soft">${escapeHtml(d.area)}</span>` : '',
    ...(d.tags || []).slice(0, 4).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`),
  ].filter(Boolean).join('');

  const ratingBlock = fav ? `
    <div class="detail-rating-row">
      <span class="hint">Tu puntuación:</span>
      ${starsHtml(fav.rating || 0)}
      <span class="hint">${fav.rating ? `${fav.rating}★` : 'sin puntuar'}</span>
    </div>` : '';

  const actions = [
    `<button type="button" class="btn ${fav ? 'btn-secondary is-active' : 'btn-primary'}" data-act="fav">${fav ? '★ En tu libro' : '☆ Guardar en mi libro'}</button>`,
    `<button type="button" class="btn btn-ghost" data-act="translate">${t ? '🌐 Ver original' : '🌐 Traducir al español'}</button>`,
    d.video ? `<a class="btn btn-ghost" href="${escapeHtml(d.video)}" target="_blank" rel="noopener noreferrer">▶ Vídeo</a>` : '',
    d.sourceUrl ? `<a class="btn btn-ghost" href="${escapeHtml(d.sourceUrl)}" target="_blank" rel="noopener noreferrer">🔗 Fuente</a>` : '',
    d.siteUrl ? `<a class="btn btn-ghost" href="${escapeHtml(d.siteUrl)}" target="_blank" rel="noopener noreferrer">${d.source === 'spoon' ? 'Ver en Spoonacular' : 'Ver en TheMealDB'}</a>` : '',
    `<button type="button" class="btn btn-ghost" data-act="copy">📋 Copiar</button>`,
  ].filter(Boolean).join('');

  const ingredientRows = ings.length
    ? ings.map((x) => `
        <li class="${x.have ? 'is-have' : ''}">
          <span class="ing-check" aria-hidden="true">${x.have ? '✓' : '○'}</span>
          <span class="ing-name">${escapeHtml(x.name)}${x.gloss && viewLang === 'en' ? `<span class="gloss">${escapeHtml(x.gloss)}</span>` : ''}</span>
          <span class="ing-measure">${escapeHtml(x.measure)}</span>
        </li>`).join('')
    : '<li><span></span><span class="ing-name">Esta receta no lista ingredientes.</span><span></span></li>';

  const stepsHtml = steps.length
    ? steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')
    : '<li class="hint">Esta receta no incluye instrucciones paso a paso.</li>';

  const matchLine = state.queryKeys.length
    ? `<p class="match-line">Usa <strong>${haveCount}</strong> de tus <strong>${state.queryKeys.length}</strong> ingredientes (${ings.length} en total).</p>`
    : `<p class="match-line">Ingredientes y preparación tal como los indica la fuente.</p>`;

  bodyEl.innerHTML = `
    <div class="detail-head">
      <img class="detail-img" src="${escapeHtml(imageSize(d.image || '', 'large'))}" alt="${escapeHtml(name)}">
      <div>
        <h3 class="detail-title" id="detail-title">${escapeHtml(name)}</h3>
        <div class="recipe-meta">${tags}</div>
        ${matchLine}
        ${ratingBlock}
        <div class="detail-actions">${actions}</div>
      </div>
    </div>

    <div class="detail-columns">
      <div class="detail-col">
        <h4>Ingredientes <span class="badge badge-soft">${haveCount}/${state.queryKeys.length || ings.length}</span></h4>
        <ul class="ingredient-list">${ingredientRows}</ul>
        <p class="hint">✓ = lo tienes según tu búsqueda · ○ = extra que pide la receta</p>

        <h4>Tu nota</h4>
        <label class="sr-only" for="detail-note">Nota personal</label>
        <textarea id="detail-note" class="detail-note" ${fav ? '' : 'disabled'} placeholder="${fav ? 'Tiempos reales, cambios, trucos…' : 'Guarda la receta para añadir una nota'}">${escapeHtml(fav ? (fav.note || '') : '')}</textarea>
      </div>

      <div class="detail-col">
        <h4>Preparación</h4>
        <ol class="steps">${stepsHtml}</ol>
        <p class="hint">Fuente: ${escapeHtml(d.siteUrl || d.sourceUrl || 'TheMealDB')}</p>
      </div>
    </div>`;

  bodyEl.querySelectorAll('img').forEach((img) => attachImgFallback(img, '🍲'));
}

/* ------------------------------- acciones ------------------------------ */

const saveNote = debounce(() => {
  const d = current;
  const ta = document.getElementById('detail-note');
  if (!d || !ta) return;
  if (!book.isFavorite(d.source, d.id)) return;
  book.setNote(d.source, d.id, ta.value);
}, 600);

async function handleClick(e) {
  const star = e.target.closest('button[data-rating]');
  if (star) {
    const d = current;
    if (!d) return;
    if (!book.isFavorite(d.source, d.id)) {
      toast('Guarda la receta antes de puntuarla', 'error');
      return;
    }
    book.setRating(d.source, d.id, Number(star.dataset.rating));
    render();
    return;
  }

  const btn = e.target.closest('button[data-act]');
  if (!btn || !current) return;
  const d = current;
  const act = btn.dataset.act;

  if (act === 'fav') {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      const rec = await book.toggleFavorite({
        source: d.source, id: d.id, name: d.name, image: d.image,
        category: d.category, area: d.area,
      });
      if (rec) book.updateFavorite(d.source, d.id, { detail: current });
      render();
    } catch (err) {
      toast(err.message || 'No se pudo guardar', 'error');
    } finally {
      busy = false;
      btn.disabled = false;
    }
    return;
  }

  if (act === 'translate') {
    if (viewLang === 'es') {
      viewLang = 'en';
      render();
      return;
    }
    if (busy) return;
    busy = true;
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Traduciendo…';
    try {
      translated = await translateDetail(d);
      viewLang = 'es';
      render();
      toast(translated.partial ? 'Traducción parcial (algunos fragmentos se mantienen en inglés)' : 'Receta traducida', 'success');
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = original;
      toast(err.message || 'No se pudo traducir', 'error');
    } finally {
      busy = false;
    }
    return;
  }

  if (act === 'copy') {
    try {
      await navigator.clipboard.writeText(plainText(d));
      toast('Receta copiada al portapapeles', 'success');
    } catch {
      toast('No se pudo copiar (permiso del navegador)', 'error');
    }
  }
}

function handleInput(e) {
  if (e.target && e.target.id === 'detail-note') saveNote();
}

function plainText(d) {
  const t = viewLang === 'es' && translated ? translated : null;
  const name = t ? t.name : d.name;
  const steps = t ? t.steps : (d.steps || []);
  const ingNames = t ? t.ingNames : (d.ingredients || []).map((i) => i.name);
  const lines = [name, ''];
  if (d.category || d.area) lines.push([d.category, d.area].filter(Boolean).join(' · '), '');
  lines.push('Ingredientes:');
  (d.ingredients || []).forEach((ing, i) => {
    lines.push(`- ${ing.measure ? `${ing.measure} ` : ''}${ingNames[i] || ing.name}`);
  });
  lines.push('', 'Preparación:');
  steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push('', `Fuente: ${d.siteUrl || d.sourceUrl || 'TheMealDB'}`);
  return lines.join('\n');
}
