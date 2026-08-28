// Router SPA sederhana berbasis hash (#/dashboard, #/campaign/:id, dst)
const routes = {};

export function registerRoute(path, renderFn) {
  routes[path] = renderFn;
}

export function navigate(path) {
  window.location.hash = path;
}

export function matchRoute(hash) {
  const path = hash.replace(/^#/, '') || '/';
  const parts = path.split('/').filter(Boolean);

  for (const routePath in routes) {
    const routeParts = routePath.split('/').filter(Boolean);
    if (routeParts.length !== parts.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = decodeURIComponent(parts[i]);
      } else if (routeParts[i] !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { render: routes[routePath], params };
  }
  return null;
}

export function startRouter(rootEl) {
  async function render() {
    const match = matchRoute(window.location.hash);
    if (match) {
      try {
        await match.render(rootEl, match.params);
      } catch (err) {
        console.error('Gagal merender halaman:', err);
        rootEl.innerHTML = `<section class="page"><p class="error">Terjadi kesalahan saat memuat halaman.</p></section>`;
      }
    } else {
      rootEl.innerHTML = `<section class="page"><h2>404 - Halaman tidak ditemukan</h2><a href="#/dashboard">Kembali ke Dashboard</a></section>`;
    }
  }
  window.addEventListener('hashchange', render);
  render();
}
