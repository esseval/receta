// storage.js — Persistencia local (localStorage) con prefijo.
// Todo se queda en el navegador: no hay backend propio para datos de usuario.

const PREFIX = 'mi_libro_recetas_';

function key(k) { return PREFIX + k; }

function get(k, fallback = null) {
  try {
    const raw = localStorage.getItem(key(k));
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    console.warn('Storage.get', k, e);
    return fallback;
  }
}

function set(k, value) {
  try {
    localStorage.setItem(key(k), JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Storage.set', k, e);
    return false;
  }
}

function remove(k) {
  try { localStorage.removeItem(key(k)); return true; } catch { return false; }
}

function keys() {
  return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
}

function clearAll() {
  keys().forEach(remove);
}

/* ---------------------------- helpers de datos ------------------------- */

export const Storage = {
  PREFIX, get, set, remove, keys, clearAll,

  getFavorites() { return get('favorites', []) || []; },
  setFavorites(list) { return set('favorites', list); },

  getHistory() { return get('history', []) || []; },
  setHistory(list) { return set('history', list); },

  getSettings() { return get('settings', {}) || {}; },
  setSettings(s) { return set('settings', s); },

  getTheme() { return get('settings', {}).theme || 'light'; },
  setTheme(theme) {
    const s = get('settings', {});
    s.theme = theme;
    return set('settings', s);
  },

  getSortMode() {
    const s = get('settings', {});
    return s.sortMode || 'match';
  },
  setSortMode(mode) {
    const s = get('settings', {});
    s.sortMode = mode;
    return set('settings', s);
  },
};

export default Storage;
