// api.js — Cliente de proxy.php (mismo origen, sin CORS ni claves en el browser).
// Soporta arrays con la sintaxis PHP: ing[]=pollo&ing[]=ajo

const PROXY = 'proxy.php';

export function debounce(fn, delay = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function buildUrl(action, params = {}) {
  const usp = new URLSearchParams({ action });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      v.forEach((x) => { if (x !== '' && x !== null && x !== undefined) usp.append(`${k}[]`, String(x)); });
    } else {
      usp.append(k, String(v));
    }
  }
  return `${PROXY}?${usp.toString()}`;
}

function friendlyError(payload, status) {
  if (payload && typeof payload === 'object') {
    const parts = [payload.error, payload.hint, payload.detail].filter(Boolean);
    if (parts.length) return parts.join(' — ');
  }
  return `proxy.php respondió ${status}`;
}

async function request(url, { method = 'GET', body = null, timeout = 90000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('El servidor tardó demasiado en responder. Reintenta en unos segundos.');
    if (e instanceof TypeError) throw new Error('No se pudo contactar a proxy.php. ¿Está Apache corriendo en Laragon?');
    throw e;
  }
  clearTimeout(timer);

  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* respuesta no JSON */ }

  if (!res.ok || (data && data.ok === false)) {
    throw new Error(friendlyError(data, res.status));
  }
  if (data === null) throw new Error('proxy.php devolvió una respuesta no válida.');
  return data;
}

/* ------------------------------ endpoints ------------------------------ */

export function health(deep = false) {
  return request(buildUrl('health', deep ? { deep: 1 } : {}), { timeout: 20000 });
}

export function fetchRecipes(terms) {
  return request(buildUrl('recipes', { ing: terms }), { timeout: 120000 });
}

export function searchByName(q) {
  return request(buildUrl('search', { q }), { timeout: 40000 });
}

export function fetchMeal(id) {
  return request(buildUrl('meal', { id }), { timeout: 40000 });
}

export function fetchList(what) {
  return request(buildUrl('list', { what }), { timeout: 40000 });
}

export function translate(texts) {
  return request(buildUrl('translate'), { method: 'POST', body: { action: 'translate', texts }, timeout: 120000 });
}
