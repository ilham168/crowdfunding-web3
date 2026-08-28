import { createAntigravityParticles } from './particles.js';

export function mountAntigravity(root, { fixed = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = fixed ? 'particles-canvas fixed-bg' : 'particles-canvas';
  root.prepend(canvas);
  createAntigravityParticles(canvas);
}

export function showToast(message, type = 'info') {
  let rootEl = document.querySelector('.toast-root');
  if (!rootEl) {
    rootEl = document.createElement('div');
    rootEl.className = 'toast-root';
    document.body.appendChild(rootEl);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  rootEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, 3800);
}

export function setBusy(btn, busy, busyLabel = 'Memproses...') {
  if (busy) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.innerHTML = `<span class="spin" aria-hidden="true"></span><span>${busyLabel}</span>`;
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = btn.dataset.label || '';
    delete btn.dataset.label;
  }
}

export function skeletonCards(n = 3) {
  return Array.from({ length: n }, () => `
    <div class="card skeleton-card" aria-hidden="true">
      <span class="sk sk-title"></span>
      <span class="sk sk-line"></span>
      <span class="sk sk-line" style="width:80%"></span>
      <span class="sk sk-bar"></span>
      <span class="sk sk-line" style="width:55%"></span>
    </div>`).join('');
}

export function skeletonTable(rows = 4, cols = 4) {
  const widths = ['42%', '24%', '32%', '20%', '26%'];
  const body = Array.from({ length: rows }, () => `
    <tr class="sk-row">
      ${Array.from({ length: cols }, (_, c) =>
        `<td><span class="sk" style="width:${widths[c % widths.length]}"></span></td>`).join('')}
    </tr>`).join('');
  return `<div class="table-panel" aria-hidden="true"><table class="ledger-table">${body}</table></div>`;
}

export function skeletonStat() {
  return `<div class="stat-box sk-stat" aria-hidden="true"><span class="sk" style="width:46%"></span></div>`;
}