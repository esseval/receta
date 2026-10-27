// app.js — Punto de entrada: tema, salud del backend y arranque de los módulos.

import { Storage } from './storage.js';
import { health } from './api.js';
import { applyTheme, openDialog, toast } from './ui.js';
import * as recipes from './recipes.js';
import * as detail from './detail.js';
import * as book from './book.js';
import * as history from './history.js';
import { initDataDialog } from './import-export.js';

document.addEventListener('DOMContentLoaded', init);

function init() {
  initTheme();
  detail.initDetail();
  recipes.initRecipes({ open: (ref) => detail.openDetail(ref) });
  book.initBook({ open: (ref) => detail.openDetail(ref) });
  history.initHistory({
    restore: (terms) => {
      const tab = document.getElementById('tab-ingredients');
      if (tab) tab.click();
      recipes.restoreTerms(terms);
      recipes.runIngredientSearch();
    },
  });

  initDataDialog({
    onChanged: () => {
      applyTheme(Storage.getTheme() || 'light');
      book.renderBook();
      document.dispatchEvent(new CustomEvent('data:changed'));
    },
  });

  const btnData = document.getElementById('btn-data');
  if (btnData) btnData.addEventListener('click', () => openDialog(document.getElementById('data-dialog')));

  checkHealth();
}

function initTheme() {
  const saved = Storage.getTheme();
  const preferred = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(saved || preferred);

  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    Storage.setTheme(next);
  });
}

async function checkHealth() {
  const el = document.getElementById('backend-status');
  const text = el ? el.querySelector('.status-text') : null;
  try {
    const h = await health(false);
    if (el) {
      el.className = 'backend-status is-ok';
      el.title = 'proxy.php responde correctamente';
    }
    if (text) text.textContent = h.hasSpoonacular ? '2 fuentes activas' : 'listo';
    const credit = document.getElementById('spoon-credit');
    if (credit && h.hasSpoonacular) credit.hidden = false;
    if (h.cacheWritable === false) {
      toast('Aviso: la carpeta cache/ no es escribible', 'error');
    }
  } catch (e) {
    if (el) {
      el.className = 'backend-status is-error';
      el.title = e.message;
    }
    if (text) text.textContent = 'sin backend';
    toast(e.message, 'error');
  }
}
