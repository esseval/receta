// state.js — Estado compartido en memoria (no persistente).
// Evita imports circulares entre recipes.js / detail.js / book.js.

export const state = {
  // ingredientes elegidos en la última búsqueda (texto del usuario)
  queryTerms: [],
  // claves normalizadas enviadas a la API (inglés)
  queryKeys: [],
  // resultados de la última búsqueda
  results: [],
  // modo de la última búsqueda: 'scored' | 'name'
  mode: 'scored',
  // fuente de los resultados: themealdb | spoon
  source: 'themealdb',
};

export function setQuery(terms, keys) {
  state.queryTerms = Array.isArray(terms) ? terms.slice() : [];
  state.queryKeys = Array.isArray(keys) ? keys.slice() : [];
}

export default state;
