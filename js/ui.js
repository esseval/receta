// ui.js — Utilidades de interfaz: HTML seguro, toasts, tema, diálogos, estrellas.

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;

export function toast(message, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast' + (type ? ` is-${type}` : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
}

/* --------------------------------- tema -------------------------------- */

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
}

/* ------------------------------- diálogos ------------------------------ */

export function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

export function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

/* ------------------------------ estado texto --------------------------- */

export function setStatus(message, type = '') {
  const el = document.getElementById('search-status');
  if (!el) return;
  const loading = type === 'loading';
  el.innerHTML = loading
    ? `<span class="spinner" aria-hidden="true"></span>${escapeHtml(message)}`
    : escapeHtml(message);
  el.classList.toggle('is-error', type === 'error');
}

/* -------------------------------- estrellas ---------------------------- */

/** Devuelve el HTML de un control de estrellas (editable u readonly). */
export function starsHtml(rating, { small = false, readonly = false, id = '' } = {}) {
  const cls = ['stars', small ? 'stars-small' : '', readonly ? 'readonly' : ''].filter(Boolean).join(' ');
  let html = `<span class="${cls}"${id ? ` data-stars="${id}"` : ''} role="img" aria-label="Puntuación ${rating} de 5">`;
  for (let i = 1; i <= 5; i++) {
    const on = i <= rating ? ' is-on' : '';
    html += readonly
      ? `<span class="${on}">★</span>`
      : `<button type="button" class="${on.trim()}" data-rating="${i}" aria-label="Puntuar con ${i} estrellas">★</button>`;
  }
  return html + '</span>';
}

/** Delegación de clics en controles de estrellas. */
export function onStarClick(container, handler) {
  if (!container) return;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-rating]');
    if (!btn) return;
    e.preventDefault();
    handler(Number(btn.dataset.rating));
  });
}

/* -------------------------------- imágenes ----------------------------- */

export function attachImgFallback(img, emoji = '🍽️') {
  if (!img) return;
  img.addEventListener('error', () => {
    const wrap = document.createElement('div');
    wrap.className = 'placeholder';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.textContent = emoji;
    img.replaceWith(wrap);
  }, { once: true });
}

/** URL de imagen con sufijo de tamaño cuando venga de TheMealDB. */
export function imageSize(url, size = 'medium') {
  if (!url) return '';
  if (!/themealdb\.com\/images\/media\/meals\//.test(url)) return url;
  return url.replace(/\/(small|medium|large)$/, '') + '/' + size;
}
