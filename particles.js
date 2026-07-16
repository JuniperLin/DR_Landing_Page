(() => {
  /* ═══════════════════════════════════════════════════════
   *  Canvas
   * ═══════════════════════════════════════════════════════ */
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  canvas.style.pointerEvents = 'auto';   // intercept mouse for magnifier
  let W, H;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', () => { resize(); buildTargets(); });
  resize();

  /* ═══════════════════════════════════════════════════════
   *  Mouse – smooth-tracked
   * ═══════════════════════════════════════════════════════ */
  const mouse = { x: -9999, y: -9999, active: false };
  const smooth = { x: -9999, y: -9999 };

  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (!mouse.active) { smooth.x = mouse.x; smooth.y = mouse.y; }
    mouse.active = true;
  });
  window.addEventListener('mouseleave', () => { mouse.active = false; });

  window.addEventListener('touchstart', e => {
    mouse.active = true;
    mouse.x = e.touches[0].clientX;
    mouse.y = e.touches[0].clientY;
    if (smooth.x === -9999 || smooth.x === -9999) {
      smooth.x = mouse.x;
      smooth.y = mouse.y;
    }
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    mouse.x = e.touches[0].clientX;
    mouse.y = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener('touchend', () => {
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
  });

  /* ═══════════════════════════════════════════════════════
   *  Scroll-driven spread
   * ═══════════════════════════════════════════════════════ */
  let scrollProgress = 0;          // 0 = gathered, 1 = fully spread
  const SPREAD_FACTOR = 6;         // how far particles spread (6× from center)

  function updateScroll() {
    scrollProgress = Math.min(1, window.scrollY / (window.innerHeight * 0.7));
    if (window.scrollY < 15) {
      document.body.classList.add('hide-default-cursor');
    } else {
      document.body.classList.remove('hide-default-cursor');
    }
  }
  window.addEventListener('scroll', updateScroll, { passive: true });
  updateScroll();

  /* ═══════════════════════════════════════════════════════
   *  Colours & draw batches
   * ═══════════════════════════════════════════════════════ */
  const COL_D = { r: 255, g: 255, b: 255 };
  const COL_R = { r: 255, g: 90,  b: 140 };

  const BATCH_ALPHA = [0.3, 0.72, 0.3, 0.72];
  const BATCH_STYLE = [
    'rgb(255,255,255)', 'rgb(255,255,255)',
    'rgb(255,90,140)',  'rgb(255,90,140)',
  ];

  /* ═══════════════════════════════════════════════════════
   *  Tunables
   * ═══════════════════════════════════════════════════════ */
  const GAP          = 5;
  const SPRING_BASE  = 0.014;
  const SPRING_VAR   = 0.012;
  const DAMPING      = 0.925;
  const REPULSE_R    = 70;
  const REPULSE_STR  = 2.2;

  /* Magnifier */
  const NEON         = 'rgb(210,255,0)';
  const NEON_DIM     = 'rgba(210,255,0,0.25)';
  const LENS_OUTER   = 30;
  const LENS_INNER   = 25;
  const MAG_POS      = 2.5;
  const MAG_SIZE     = 10;
  const SAMPLE_R     = LENS_INNER / MAG_POS;
  const SAMPLE_R_SQ  = SAMPLE_R * SAMPLE_R;
  const LENS_INNER_SQ = LENS_INNER * LENS_INNER;

  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  /* ═══════════════════════════════════════════════════════
   *  Text → target positions
   * ═══════════════════════════════════════════════════════ */
  let particles = [];
  let centerX, centerY;

  function sampleLetter(ch, color, offsetX) {
    const fontSize = W < H ? Math.min(W * 0.52, H * 0.35) : Math.min(W * 0.28, H * 0.55);
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const c = off.getContext('2d');
    c.fillStyle = '#fff';
    c.font = `900 ${fontSize}px Inter, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(ch, W / 2 + offsetX, H * 0.43);
    const d = c.getImageData(0, 0, W, H).data;
    const pts = [];
    for (let y = 0; y < H; y += GAP)
      for (let x = 0; x < W; x += GAP)
        if (d[(y * W + x) * 4 + 3] > 128) pts.push({ x, y, color });
    return pts;
  }

  function buildTargets() {
    const fontSize = W < H ? Math.min(W * 0.52, H * 0.35) : Math.min(W * 0.28, H * 0.55);
    const m = document.createElement('canvas').getContext('2d');
    m.font = `900 ${fontSize}px Inter, sans-serif`;
    const dW = m.measureText('D').width;
    const rW = m.measureText('R').width;
    const kern = fontSize * 0.04;
    const tot = dW + kern + rW;

    centerX = W / 2;
    centerY = H * 0.43;

    const all = [
      ...sampleLetter('D', COL_D, -tot / 2 + dW / 2),
      ...sampleLetter('R', COL_R,  tot / 2 - rW / 2),
    ];

    if (!particles.length) {
      particles = all.map(p => mkParticle(p));
    } else {
      particles = all.map((p, i) => {
        if (i < particles.length) {
          particles[i].tx = p.x;
          particles[i].ty = p.y;
          particles[i].color = p.color;
          particles[i].batch = batchFor(p.color, particles[i].alphaBin);
          return particles[i];
        }
        return mkParticle(p);
      });
    }
  }

  function batchFor(color, alphaBin) {
    return (color === COL_R ? 2 : 0) + alphaBin;
  }

  function mkParticle(p) {
    const a = Math.random() * Math.PI * 2;
    const dist = Math.max(W, H) * (0.5 + Math.random() * 0.8);
    const alphaBin = Math.random() < 0.5 ? 0 : 1;
    return {
      x:  W / 2 + Math.cos(a) * dist,
      y:  H / 2 + Math.sin(a) * dist,
      tx: p.x, ty: p.y,
      vx: 0, vy: 0,
      color:    p.color,
      size:     1.2 + Math.random() * 1.4,
      fSeed:    Math.random() * 6.2832,
      fSpd:     0.15 + Math.random() * 0.35,
      fAx:      0.25 + Math.random() * 0.6,
      fAy:      0.25 + Math.random() * 0.6,
      delay:    Math.random() * 3.0,
      spring:   SPRING_BASE + Math.random() * SPRING_VAR,
      alphaBin,
      batch:    batchFor(p.color, alphaBin),
    };
  }

  buildTargets();

  /* ═══════════════════════════════════════════════════════
   *  Hero overlay fade & subtitle reveal
   * ═══════════════════════════════════════════════════════ */
  const heroOverlay = document.getElementById('hero-overlay');
  const subtitleEl  = document.getElementById('subtitle');

  setTimeout(() => subtitleEl.classList.add('visible'), 4500);

  /* ═══════════════════════════════════════════════════════
   *  Scroll-reveal (IntersectionObserver)
   * ═══════════════════════════════════════════════════════ */
  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) e.target.classList.add('revealed');
    });
  }, { threshold: 0.08 });

  document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

  /* ═══════════════════════════════════════════════════════
   *  Render loop
   * ═══════════════════════════════════════════════════════ */
  let t = 0;
  const t0 = performance.now();

  let lightProgress = 0; // 0 = dark mode, 1 = light mode

  function frame() {
    requestAnimationFrame(frame);
    ctx.clearRect(0, 0, W, H);

    const elapsed = (performance.now() - t0) * 0.001;
    t += 0.016;

    /* ── Light / Dark Mode transition ── */
    const isLightMode = document.documentElement.classList.contains('light-mode');
    if (isLightMode) {
      lightProgress += (1 - lightProgress) * 0.065; // ~0.8s transition speed
    } else {
      lightProgress += (0 - lightProgress) * 0.065;
    }

    // Smoothly mutate colors of D and R particles
    COL_D.r = 255 - lightProgress * 235; // 255 -> 20
    COL_D.g = 255 - lightProgress * 235; // 255 -> 20
    COL_D.b = 255 - lightProgress * 230; // 255 -> 25

    COL_R.r = 255 - lightProgress * 35;  // 255 -> 220
    COL_R.g = 90 - lightProgress * 40;   // 90 -> 50
    COL_R.b = 140 - lightProgress * 40;  // 140 -> 100

    BATCH_STYLE[0] = BATCH_STYLE[1] = `rgb(${Math.round(COL_D.r)},${Math.round(COL_D.g)},${Math.round(COL_D.b)})`;
    BATCH_STYLE[2] = BATCH_STYLE[3] = `rgb(${Math.round(COL_R.r)},${Math.round(COL_R.g)},${Math.round(COL_R.b)})`;

    /* Smooth mouse */
    if (mouse.active) {
      smooth.x += (mouse.x - smooth.x) * 0.13;
      smooth.y += (mouse.y - smooth.y) * 0.13;
    }
    const mx = smooth.x;
    const my = smooth.y;

    /* ── Fade hero overlay on scroll ── */
    const heroAlpha = Math.max(0, 1 - scrollProgress * 2.5);
    heroOverlay.style.opacity = heroAlpha;

    /* ── Scroll-spread: effective multiplier ── */
    const spread = 1 + scrollProgress * SPREAD_FACTOR;

    /* ── Global particle alpha (slightly dim when spread, stay visible behind sections) ── */
    const globalDim = 1 - scrollProgress * 0.25;   // dim to 75% when fully spread

    const n = particles.length;

    /* ── Physics pass ── */
    for (let i = 0; i < n; i++) {
      const p = particles[i];
      const active = elapsed - p.delay;
      const sMul = active < 0 ? 0 : Math.min(1, active * 0.35);

      /* Idle floating drift – gentle breathing when stationary, scales up when spread */
      const driftRange = 6.0 + scrollProgress * 30.0;
      const driftT = elapsed * p.fSpd * 0.45;
      const fx = (Math.sin(driftT + p.fSeed) * p.fAx + Math.sin(driftT * 0.31 + p.fSeed * 2.3) * 0.5) * driftRange;
      const fy = (Math.cos(driftT * 0.7 + p.fSeed + 1.5) * p.fAy + Math.cos(driftT * 0.19 + p.fSeed * 1.7) * 0.5) * driftRange;

      /* Spread target: offset from center × spread, plus drift */
      const eTx = centerX + (p.tx - centerX) * spread + fx;
      const eTy = centerY + (p.ty - centerY) * spread + fy;

      let ax = (eTx - p.x) * p.spring * sMul;
      let ay = (eTy - p.y) * p.spring * sMul;

      /* Mouse repulsion (only meaningful when hero is visible) */
      if (mouse.active && scrollProgress < 0.85) {
        const dx = p.x - mx;
        const dy = p.y - my;
        const dSq = dx * dx + dy * dy;
        if (dSq > SAMPLE_R_SQ && dSq < REPULSE_R * REPULSE_R && dSq > 1) {
          const d = Math.sqrt(dSq);
          const f = Math.pow((REPULSE_R - d) / REPULSE_R, 1.6);
          ax += (dx / d) * f * REPULSE_STR;
          ay += (dy / d) * f * REPULSE_STR;
        }
      }

      p.vx = (p.vx + ax) * DAMPING;
      p.vy = (p.vy + ay) * DAMPING;
      p.x += p.vx;
      p.y += p.vy;
    }

    /* ── Draw pass – batched compound paths ── */
    for (let b = 0; b < 4; b++) {
      ctx.globalAlpha = BATCH_ALPHA[b] * globalDim;
      ctx.fillStyle = BATCH_STYLE[b];
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (particles[i].batch !== b) continue;
        const p = particles[i];
        ctx.moveTo(p.x + p.size, p.y);
        ctx.arc(p.x, p.y, p.size, 0, 6.2832);
      }
      ctx.fill();
    }

    /* ── Magnifier cursor (only when on the landing page, not a touch device, and not on mobile) ── */
    if (mouse.active && window.scrollY < 15 && !isTouchDevice && W >= 600) drawLens(mx, my);

    ctx.globalAlpha = 1;
  }

  /* ═══════════════════════════════════════════════════════
   *  Magnifier
   * ═══════════════════════════════════════════════════════ */
  function drawLens(mx, my) {
    const ringR = Math.round(210 - lightProgress * 190); // 210 -> 20
    const ringG = Math.round(255 - lightProgress * 235); // 255 -> 20
    const ringB = Math.round(0 + lightProgress * 25);    // 0 -> 25
    const currentNeon = `rgb(${ringR},${ringG},${ringB})`;
    const currentNeonDim = `rgba(${ringR},${ringG},${ringB},0.25)`;

    ctx.globalAlpha = 0.8 * (1 - scrollProgress);
    ctx.strokeStyle = currentNeon;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, LENS_OUTER, 0, 6.2832);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, LENS_INNER, 0, 6.2832);
    ctx.clip();

    const lensBgR = Math.round(6 + lightProgress * 249);  // 6 -> 255
    const lensBgG = Math.round(6 + lightProgress * 249);  // 6 -> 255
    const lensBgB = Math.round(16 + lightProgress * 239); // 16 -> 255
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = `rgb(${lensBgR},${lensBgG},${lensBgB})`;
    ctx.fill();

    const grad = ctx.createRadialGradient(mx, my, 0, mx, my, LENS_INNER);
    const stop1 = `rgba(${Math.round(20 + lightProgress * 220)},${Math.round(20 + lightProgress * 220)},${Math.round(40 + lightProgress * 210)},0)`;
    const stop2 = `rgba(0,0,0,${0.4 - lightProgress * 0.34})`;
    grad.addColorStop(0, stop1);
    grad.addColorStop(1, stop2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(mx, my, LENS_INNER, 0, 6.2832);
    ctx.fill();

    for (let i = 0, len = particles.length; i < len; i++) {
      const p = particles[i];
      const dx = p.x - mx;
      const dy = p.y - my;
      if (dx * dx + dy * dy > SAMPLE_R_SQ) continue;
      const px = mx + dx * MAG_POS;
      const py = my + dy * MAG_POS;
      const rx = px - mx, ry = py - my;
      if (rx * rx + ry * ry > LENS_INNER_SQ) continue;
      const magR = p.size * MAG_SIZE;
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = `rgb(${p.color.r},${p.color.g},${p.color.b})`;
      ctx.beginPath(); ctx.arc(px, py, magR * 1.5, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.arc(px, py, magR, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(px - magR * 0.2, py - magR * 0.2, magR * 0.3, 0, 6.2832); ctx.fill();
    }

    ctx.restore();

    ctx.globalAlpha = 0.3 * (1 - scrollProgress);
    ctx.strokeStyle = currentNeonDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(mx, my, LENS_INNER, 0, 6.2832);
    ctx.stroke();

    ctx.globalAlpha = 0.4 * (1 - scrollProgress);
    ctx.fillStyle = currentNeon;
    ctx.beginPath();
    ctx.arc(mx, my, 1.2, 0, 6.2832);
    ctx.fill();
  }

  frame();
})();
