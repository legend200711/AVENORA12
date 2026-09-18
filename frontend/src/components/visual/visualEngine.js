/**
 * AVENORA - Shared Visual Engine
 * Canvas-based: starfield, rain, particles, flames, lightning
 * Performance-conscious, mobile-aware, respects prefers-reduced-motion
 * No strobe effects. All animations smooth and low-frequency.
 */

(function (global) {
  'use strict';

  // ─── Reduced motion check ────────────────────────────────
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ─── Device tier detection ────────────────────────────────
  function getDeviceTier() {
    const cores = navigator.hardwareConcurrency || 2;
    const memory = navigator.deviceMemory || 2;
    const isMobile = window.innerWidth < 768;
    if (isMobile && (cores <= 2 || memory <= 2)) return 'low';
    if (isMobile) return 'medium';
    return 'high';
  }

  // ─── Starfield ────────────────────────────────────────────
  class Starfield {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.stars = [];
      this.tier = getDeviceTier();
      this.raf = null;
      this.resize();
      this.init();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      this.canvas.width = this.canvas.offsetWidth;
      this.canvas.height = this.canvas.offsetHeight;
      if (this.stars.length) this.init(); // Reinitialize on resize
    }

    init() {
      const count = { low: 60, medium: 120, high: 220 }[this.tier];
      this.stars = Array.from({ length: count }, () => ({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        r: Math.random() * 1.4 + 0.3,
        alpha: Math.random() * 0.6 + 0.2,
        speed: Math.random() * 0.015 + 0.005,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: (Math.random() * 0.3 + 0.1) * 0.02,
        /* Cosmic: gold, cyan, warm white */
        color: Math.random() > 0.88 ? '#c9a84c' : Math.random() > 0.75 ? '#50d8ff' : Math.random() > 0.6 ? '#ffd060' : '#f0e8d8',
      }));
    }

    draw(time) {
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.stars.forEach(star => {
        star.twinklePhase += star.twinkleSpeed;
        const currentAlpha = star.alpha * (0.6 + 0.4 * Math.sin(star.twinklePhase));
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = star.color;
        ctx.globalAlpha = currentAlpha;
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    start() {
      if (prefersReducedMotion) { this.draw(0); return; }
      const loop = (t) => {
        this.draw(t);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  // ─── Rain ─────────────────────────────────────────────────
  class Rain {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.drops = [];
      this.tier = getDeviceTier();
      this.raf = null;
      this.resize();
      this.init();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      this.canvas.width = this.canvas.offsetWidth;
      this.canvas.height = this.canvas.offsetHeight;
    }

    init() {
      const count = { low: 40, medium: 80, high: 140 }[this.tier];
      this.drops = Array.from({ length: count }, () => this.makeDrop());
    }

    makeDrop(atTop = false) {
      return {
        x: Math.random() * this.canvas.width,
        y: atTop ? 0 : Math.random() * this.canvas.height,
        length: Math.random() * 14 + 6,
        speed: Math.random() * 4 + 3,
        alpha: Math.random() * 0.3 + 0.05,
        angle: 0.15, // slight angle
        color: Math.random() > 0.6 ? '#0066aa' : '#004488',
      };
    }

    draw() {
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.drops.forEach(drop => {
        ctx.strokeStyle = drop.color;
        ctx.globalAlpha = drop.alpha;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x + drop.angle * drop.length, drop.y + drop.length);
        ctx.stroke();

        drop.y += drop.speed;
        drop.x += drop.angle * drop.speed * 0.5;

        if (drop.y > canvas.height) {
          Object.assign(drop, this.makeDrop(true));
          drop.x = Math.random() * canvas.width;
        }
      });
      ctx.globalAlpha = 1;
    }

    start() {
      if (prefersReducedMotion) { this.draw(); return; }
      const loop = () => {
        this.draw();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
    }
  }

  // ─── Blue Flame Effect ────────────────────────────────────
  class FlameEffect {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.color = opts.color || 'blue'; // 'blue' | 'green'
      this.particles = [];
      this.raf = null;
      this.tier = getDeviceTier();
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      this.canvas.width = this.canvas.offsetWidth;
      this.canvas.height = this.canvas.offsetHeight;
    }

    makeParticle() {
      const isBlue = this.color === 'blue';
      return {
        x: Math.random() * this.canvas.width,
        y: this.canvas.height,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -(Math.random() * 2.5 + 1.5),
        life: 1,
        decay: Math.random() * 0.018 + 0.008,
        r: Math.random() * 3 + 1.5,
        hue: isBlue
          ? 190 + Math.random() * 40   // blue range
          : 130 + Math.random() * 40,  // green range
      };
    }

    draw() {
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const maxParticles = { low: 60, medium: 120, high: 200 }[this.tier];
      if (this.particles.length < maxParticles) {
        const burst = { low: 1, medium: 2, high: 3 }[this.tier];
        for (let i = 0; i < burst; i++) this.particles.push(this.makeParticle());
      }

      this.particles = this.particles.filter(p => p.life > 0);

      this.particles.forEach(p => {
        p.x += p.vx + Math.sin(p.y * 0.04) * 0.4;
        p.y += p.vy;
        p.vx += (Math.random() - 0.5) * 0.1;
        p.life -= p.decay;

        const alpha = p.life * 0.7;
        const lightness = 45 + (1 - p.life) * 30;
        ctx.globalAlpha = alpha;
        ctx.shadowBlur = 12;
        ctx.shadowColor = `hsl(${p.hue}, 100%, 60%)`;
        ctx.fillStyle = `hsl(${p.hue}, 100%, ${lightness}%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }

    start() {
      if (prefersReducedMotion) return;
      const loop = () => {
        this.draw();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
    }
  }

  // ─── Lightning ────────────────────────────────────────────
  class LightningEffect {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.bolts = [];
      this.raf = null;
      this.nextBolt = 0;
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      this.canvas.width = this.canvas.offsetWidth;
      this.canvas.height = this.canvas.offsetHeight;
    }

    createBolt(x1, y1, x2, y2, depth = 0) {
      if (depth > 4) return [];
      const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * 80 * (1 / (depth + 1));
      const my = (y1 + y2) / 2 + (Math.random() - 0.5) * 80 * (1 / (depth + 1));
      return [
        { x1, y1, x2: mx, y2: my },
        { x1: mx, y1: my, x2, y2 },
        ...this.createBolt(x1, y1, mx, my, depth + 1).slice(0, 3),
      ];
    }

    draw(time) {
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Trigger a bolt occasionally — NOT frequently (no strobe)
      if (time > this.nextBolt) {
        const x = Math.random() * canvas.width;
        const segments = this.createBolt(x, 0, x + (Math.random() - 0.5) * 200, canvas.height * 0.6);
        this.bolts.push({ segments, alpha: 0.8, fade: 0.025 });
        this.nextBolt = time + 4000 + Math.random() * 8000; // 4-12 seconds between bolts
      }

      this.bolts = this.bolts.filter(bolt => bolt.alpha > 0);
      this.bolts.forEach(bolt => {
        bolt.segments.forEach(seg => {
          ctx.strokeStyle = `rgba(100, 180, 255, ${bolt.alpha})`;
          ctx.shadowColor = '#00aaff';
          ctx.shadowBlur = 8;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);
          ctx.stroke();
        });
        bolt.alpha -= bolt.fade;
      });
      ctx.shadowBlur = 0;
    }

    start() {
      if (prefersReducedMotion) return;
      const loop = (t) => {
        this.draw(t);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
    }
  }

  // ─── Particles (floating) ─────────────────────────────────
  class ParticleField {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = { color: opts.color || '#00aaff', count: opts.count || 40, connected: opts.connected || false };
      this.particles = [];
      this.raf = null;
      this.tier = getDeviceTier();
      this.resize();
      this.init();
      window.addEventListener('resize', () => { this.resize(); this.init(); });
    }

    resize() {
      this.canvas.width = this.canvas.offsetWidth;
      this.canvas.height = this.canvas.offsetHeight;
    }

    init() {
      const count = Math.floor(this.opts.count * { low: 0.4, medium: 0.7, high: 1 }[this.tier]);
      this.particles = Array.from({ length: count }, () => ({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.5 + 0.1,
      }));
    }

    draw() {
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      this.particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = this.opts.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });

      // Optional connection lines
      if (this.opts.connected && this.tier !== 'low') {
        this.particles.forEach((a, i) => {
          this.particles.slice(i + 1).forEach(b => {
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < 80) {
              ctx.strokeStyle = this.opts.color;
              ctx.globalAlpha = (1 - d / 80) * 0.15;
              ctx.lineWidth = 0.5;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          });
        });
      }

      ctx.globalAlpha = 1;
    }

    start() {
      if (prefersReducedMotion) { this.draw(); return; }
      const loop = () => {
        this.draw();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
    }
  }

  // ─── Eclipse Effect ───────────────────────────────────────
  function createEclipse(container) {
    const el = document.createElement('div');
    el.className = 'eclipse-effect';
    el.innerHTML = `
      <div class="eclipse-ring"></div>
      <div class="eclipse-glow"></div>
      <div class="eclipse-corona"></div>
    `;
    container.appendChild(el);
    return el;
  }

  // ─── Ambient glow spots ───────────────────────────────────
  function createAmbientLighting(container) {
    const style = document.createElement('style');
    style.textContent = `
      .ambient-light {
        position: absolute;
        pointer-events: none;
        border-radius: 50%;
        filter: blur(80px);
        opacity: 0.08;
        animation: ambient-drift 20s ease-in-out infinite alternate;
      }
      .ambient-blue { background: radial-gradient(circle, #00aaff 0%, transparent 70%); width: 400px; height: 400px; }
      .ambient-green { background: radial-gradient(circle, #00ff88 0%, transparent 70%); width: 300px; height: 300px; animation-delay: -7s; }
      @keyframes ambient-drift {
        from { transform: translate(0, 0); }
        to { transform: translate(40px, 30px); }
      }
    `;
    document.head.appendChild(style);

    const blue = document.createElement('div');
    blue.className = 'ambient-light ambient-blue';
    blue.style.cssText = 'position:fixed;top:-100px;right:-100px;';

    const green = document.createElement('div');
    green.className = 'ambient-light ambient-green';
    green.style.cssText = 'position:fixed;bottom:100px;left:50px;';

    container.appendChild(blue);
    container.appendChild(green);
  }

  // ─── Music visualizer (requires AudioContext) ─────────────
  class MusicVisualizer {
    constructor(canvas, analyser, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.analyser = analyser;
      this.opts = { mode: opts.mode || 'bars', color: opts.color || '#00aaff' };
      this.raf = null;
      this.dataArray = new Uint8Array(analyser.frequencyBinCount);
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      this.canvas.width = this.canvas.offsetWidth;
      this.canvas.height = this.canvas.offsetHeight;
    }

    draw() {
      const { ctx, canvas, analyser, dataArray } = this;
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (this.opts.mode === 'bars') {
        const barCount = Math.min(128, dataArray.length);
        const barW = canvas.width / barCount - 1;
        dataArray.slice(0, barCount).forEach((val, i) => {
          const h = (val / 255) * canvas.height * 0.85;
          const x = i * (barW + 1);
          const hue = 190 + (val / 255) * 60; // blue to cyan
          ctx.fillStyle = `hsl(${hue},100%,${40 + (val / 255) * 30}%)`;
          ctx.shadowColor = `hsl(${hue},100%,60%)`;
          ctx.shadowBlur = 6;
          ctx.fillRect(x, canvas.height - h, barW, h);
        });
        ctx.shadowBlur = 0;
      } else if (this.opts.mode === 'wave') {
        analyser.getByteTimeDomainData(dataArray);
        ctx.strokeStyle = this.opts.color;
        ctx.shadowColor = this.opts.color;
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const sliceW = canvas.width / dataArray.length;
        dataArray.forEach((v, i) => {
          const y = (v / 128) * canvas.height * 0.5;
          i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * sliceW, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (this.opts.mode === 'circle') {
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const baseR = Math.min(cx, cy) * 0.35;
        const barCount = Math.min(128, dataArray.length);
        dataArray.slice(0, barCount).forEach((val, i) => {
          const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
          const barLen = (val / 255) * baseR * 0.8;
          const x1 = cx + Math.cos(angle) * baseR;
          const y1 = cy + Math.sin(angle) * baseR;
          const x2 = cx + Math.cos(angle) * (baseR + barLen);
          const y2 = cy + Math.sin(angle) * (baseR + barLen);
          const hue = (i / barCount) * 120 + 160;
          ctx.strokeStyle = `hsl(${hue},100%,${50 + val/5}%)`;
          ctx.shadowColor = `hsl(${hue},100%,60%)`;
          ctx.shadowBlur = 5;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        });
        ctx.shadowBlur = 0;
      }
    }

    start() {
      if (prefersReducedMotion) return;
      const loop = () => {
        this.draw();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
    }
  }

  // ─── Public API ───────────────────────────────────────────
  global.LegendVisual = {
    Starfield,
    Rain,
    FlameEffect,
    LightningEffect,
    ParticleField,
    MusicVisualizer,
    createEclipse,
    createAmbientLighting,
    prefersReducedMotion,
    getDeviceTier,
  };

})(window);
