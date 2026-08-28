/**
 * Efek partikel "antigravity": titik-titik cahaya yang mengambang naik
 * perlahan (kebalikan dari gravitasi), saling terhubung garis tipis saat
 * berdekatan, dan bereaksi halus terhadap gerakan kursor.
 *
 * Pemakaian:
 *   const fx = createAntigravityParticles(canvasEl, { particleCount: 60 });
 *   // otomatis berhenti sendiri saat canvas dilepas dari DOM (route berganti)
 */
export function createAntigravityParticles(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const config = {
    particleCount: options.particleCount ?? 70,
    speed: options.speed ?? 0.5,
    linkDistance: options.linkDistance ?? 120,
    color: options.color ?? readAccentColor(),
  };

  const rgb = hexToRgb(config.color);
  let width = 0;
  let height = 0;
  let particles = [];
  let animationId = null;
  let running = true;
  const mouse = { x: null, y: null };

  function readAccentColor() {
    const val = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim();
    return val || '#aa3bff';
  }

  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const num = parseInt(h, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeParticle() {
    return {
      x: Math.random() * width,
      y: Math.random() * height + 40,
      r: Math.random() * 1.8 + 0.8,
      vy: -(Math.random() * config.speed + 0.12), // selalu naik (antigravity)
      vx: (Math.random() - 0.5) * 0.25,
      drift: Math.random() * Math.PI * 2,
      driftSpeed: Math.random() * 0.012 + 0.006,
      alpha: Math.random() * 0.5 + 0.25,
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: config.particleCount }, makeParticle);
  }

  function step() {
    if (!canvas.isConnected) {
      destroy();
      return;
    }
    if (!running) return;

    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      p.drift += p.driftSpeed;
      p.x += p.vx + Math.sin(p.drift) * 0.2;
      p.y += p.vy;

      // tarikan halus menuju kursor, kesan medan gaya terbalik
      if (mouse.x !== null) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < 130) {
          p.x -= (dx / dist) * 0.5;
          p.y -= (dy / dist) * 0.5;
        }
      }

      if (p.y < -10) { p.y = height + 10; p.x = Math.random() * width; }
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${p.alpha})`;
      ctx.fill();
    }

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < config.linkDistance) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.14 * (1 - dist / config.linkDistance)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    animationId = requestAnimationFrame(step);
  }

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  }
  function onMouseLeave() {
    mouse.x = null;
    mouse.y = null;
  }
  function onResize() {
    resize();
  }

  init();
  step();

  // pointer-events canvas dibuat none (lihat particles.css), jadi kita
  // dengarkan mousemove di window supaya klik tombol/link tetap tembus
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseleave', onMouseLeave);
  window.addEventListener('resize', onResize);

  function destroy() {
    running = false;
    if (animationId) cancelAnimationFrame(animationId);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseleave', onMouseLeave);
    window.removeEventListener('resize', onResize);
  }

  return { destroy };
}
