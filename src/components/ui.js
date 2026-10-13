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

/**
 * Dialog konfirmasi yang accessible, menggantikan window.confirm.
 *
 * - Memakai <dialog> native: focus trap + Escape + ::backdrop sudah otomatis,
 *   jadi TIDAK ada implementasi focus trap manual yang bisa salah.
 * - Fokus awal diarahkan ke tombol batal (default aman untuk aksi destruktif).
 * - Fokus dikembalikan ke elemen pemicu setelah ditutup.
 * - resolve(true) hanya kalau pengguna menekan tombol konfirmasi.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.message]       teks paragraf (plain text, di-escape)
 * @param {string} [opts.detail]        baris detail tambahan (plain text)
 * @param {string} [opts.confirmLabel]
 * @param {string} [opts.cancelLabel]
 * @param {'primary'|'danger'} [opts.variant]
 * @param {Element} [opts.trigger]      elemen yang fokus dikembalikan ke
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title,
  message = '',
  detail = '',
  confirmLabel = 'Ya, lanjutkan',
  cancelLabel = 'Batal',
  variant = 'primary',
  trigger = null,
} = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      resolve(window.confirm ? window.confirm(message || title) : false);
      return;
    }

    const previouslyFocused = trigger || document.activeElement;
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    const uid = Math.random().toString(36).slice(2, 8);
    const titleId = `confirm-dialog-title-${uid}`;
    const msgId = `confirm-dialog-msg-${uid}`;

    dlg.setAttribute('aria-labelledby', titleId);
    if (message) dlg.setAttribute('aria-describedby', msgId);

    const titleEl = document.createElement('h2');
    titleEl.id = titleId;
    titleEl.className = 'confirm-dialog-title';
    titleEl.textContent = title;

    const msgEl = document.createElement('p');
    msgEl.id = msgId;
    msgEl.className = 'confirm-dialog-msg';
    msgEl.textContent = message;

    const detailEl = document.createElement('p');
    detailEl.className = 'confirm-dialog-detail muted';
    detailEl.textContent = detail;

    const actions = document.createElement('div');
    actions.className = 'confirm-dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-ghost';
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = variant === 'danger' ? 'btn-danger' : 'btn-primary';
    confirmBtn.textContent = confirmLabel;

    actions.append(cancelBtn, confirmBtn);

    if (message) dlg.append(titleEl, msgEl); else dlg.append(titleEl);
    if (detail) dlg.append(detailEl);
    dlg.append(actions);

    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeydown, true);
      if (dlg.open) dlg.close();
      dlg.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
      resolve(result);
    };

    // Escape menutup dialog → dianggap "batal".
    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        done(false);
      }
    };

    cancelBtn.addEventListener('click', () => done(false));
    confirmBtn.addEventListener('click', () => done(true));
    document.addEventListener('keydown', onKeydown, true);

    document.body.appendChild(dlg);
    dlg.showModal();
    // Fokus awal ke tombol batal: aksi destruktif tidak boleh di-Enter tak sengaja.
    cancelBtn.focus();
  });
}