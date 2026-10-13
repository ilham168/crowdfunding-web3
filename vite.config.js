import { defineConfig } from 'vite';

// `base: './'` membuat path asset di dist/index.html relatif (./assets/...),
// sehingga hasil build jalan di root domain MAUPUN subpath hosting statis
// (Vercel/Netlify/Cloudflare Pages/GitHub Pages). Router berbasis hash
// (#/dashboard) tidak butuh rewrite server.
export default defineConfig({
  base: './',
});
