// translate.js — Traducción EN→ES de una receta vía proxy.php (MyMemory + fallback).
// La caché vive en el servidor; aquí solo guardamos en memoria por sesión.

import { translate } from './api.js';

const cache = new Map();

/**
 * Devuelve { name, steps[], ingNames[] } en español.
 * Lanza error si el servidor no pudo traducir (el caller lo muestra como toast).
 */
export async function translateDetail(detail) {
  const key = `${detail.source}:${detail.id}`;
  if (cache.has(key)) return cache.get(key);

  const texts = [
    detail.name || '',
    ...(detail.steps || []),
    ...(detail.ingredients || []).map((i) => i.name || ''),
  ].filter((t) => t && t.trim());

  const res = await translate(texts);
  if (!res || !Array.isArray(res.texts)) throw new Error('No se pudo traducir la receta.');

  let i = 0;
  const out = {
    name: res.texts[i++] || detail.name,
    steps: [],
    ingNames: [],
    engine: res.engine || '',
    partial: !!res.partial,
  };
  for (const s of detail.steps || []) out.steps.push(res.texts[i++] || s);
  for (const ing of detail.ingredients || []) out.ingNames.push(res.texts[i++] || ing.name);

  cache.set(key, out);
  return out;
}

export function clearTranslationCache() {
  cache.clear();
}
