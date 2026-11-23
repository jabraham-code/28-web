// Animation helpers (Web Animations API). Everything respects prefers-reduced-motion.
import { reducedMotion, rectCenter, h } from './util.js';
import { createBack } from './cards.js';

const EASE_OUT = 'cubic-bezier(.2,.8,.25,1)';
const EASE_IN_OUT = 'cubic-bezier(.6,.05,.3,1)';

/**
 * FLIP: element is already at its final place; animate it in from `fromRect`.
 * `extraFrom` lets callers add a starting rotation.
 */
export function flyFrom(el, fromRect, { duration = 420, delay = 0, rotateFrom = 0, fade = false } = {}) {
  if (!fromRect || reducedMotion() || !el.isConnected) return Promise.resolve();
  const to = el.getBoundingClientRect();
  if (!to.width) return Promise.resolve();
  const a = rectCenter(fromRect), b = rectCenter(to);
  const sc = Math.max(0.2, Math.min(2.5, fromRect.width / to.width));
  const anim = el.animate(
    [
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${sc}) rotate(${rotateFrom}deg)`, opacity: fade ? 0 : 1 },
      { transform: 'none', opacity: 1 },
    ],
    { duration, delay, easing: EASE_OUT, fill: 'backwards' },
  );
  return anim.finished.catch(() => {});
}

/** Move element (currently placed) towards a target rect and fade/shrink it. */
export function flyTo(el, toRect, { duration = 520, delay = 0, scale = 0.45, fadeOut = true } = {}) {
  if (!toRect || reducedMotion() || !el.isConnected) return Promise.resolve();
  const from = el.getBoundingClientRect();
  const a = rectCenter(from), b = rectCenter(toRect);
  const anim = el.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(${scale})`, opacity: fadeOut ? 0 : 1 },
    ],
    { duration, delay, easing: EASE_IN_OUT, fill: 'forwards' },
  );
  return anim.finished.catch(() => {});
}

/**
 * Deal: small card backs fly from the dealer to each target rect (round robin), staggered.
 * targets: [{ rect, count }] in dealing order. Returns total duration (ms).
 */
export function dealFlights(layer, fromRect, targets, { stagger = 55, duration = 380 } = {}) {
  if (!fromRect || reducedMotion()) return 0;
  const order = [];
  const maxCount = Math.max(0, ...targets.map((t) => t.count));
  for (let i = 0; i < maxCount; i++) for (const t of targets) if (i < t.count) order.push(t);
  const fc = rectCenter(fromRect);
  order.forEach((t, i) => {
    const el = createBack('flying');
    el.style.left = `${fc.x}px`;
    el.style.top = `${fc.y}px`;
    layer.append(el);
    const tc = rectCenter(t.rect);
    const jitterX = (Math.random() - 0.5) * Math.min(40, t.rect.width * 0.5);
    const jitterR = (Math.random() - 0.5) * 30;
    const anim = el.animate(
      [
        { transform: 'translate(-50%,-50%) scale(.6) rotate(0deg)', opacity: 0 },
        { opacity: 1, offset: 0.15 },
        { transform: `translate(calc(-50% + ${tc.x - fc.x + jitterX}px), calc(-50% + ${tc.y - fc.y}px)) scale(.8) rotate(${360 + jitterR}deg)`, opacity: 1, offset: 0.85 },
        { transform: `translate(calc(-50% + ${tc.x - fc.x + jitterX}px), calc(-50% + ${tc.y - fc.y}px)) scale(.8) rotate(${360 + jitterR}deg)`, opacity: 0 },
      ],
      { duration, delay: i * stagger, easing: EASE_OUT, fill: 'both' },
    );
    anim.finished.catch(() => {}).then(() => el.remove());
  });
  return order.length * stagger + duration;
}

/** Brief pulse on an element (CSS class based so reduced-motion CSS can neutralise it). */
export function pulse(el, cls = 'pulse') {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 900);
}

/** Canvas confetti for the match-end celebration. Returns a stop() function. */
export function confetti(container, { duration = 6000 } = {}) {
  if (reducedMotion()) return () => {};
  const canvas = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  container.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  };
  resize();
  addEventListener('resize', resize);
  const colors = ['#f5dc9a', '#e8c170', '#ff8a7a', '#6cc6ff', '#7ee2b0', '#ffffff'];
  const parts = Array.from({ length: 180 }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.6,
    vx: (Math.random() - 0.5) * 2.2,
    vy: 1.6 + Math.random() * 2.8,
    w: 6 + Math.random() * 6,
    hgt: 8 + Math.random() * 10,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.25,
    c: colors[(Math.random() * colors.length) | 0],
    wob: Math.random() * 6.28,
  }));
  const start = performance.now();
  let raf = 0, stopped = false;
  const frame = (t) => {
    if (stopped) return;
    const el = t - start;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = 0;
    for (const p of parts) {
      p.wob += 0.05;
      p.x += p.vx + Math.sin(p.wob) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.y > innerHeight + 20) {
        if (el < duration) { p.y = -20; p.x = Math.random() * innerWidth; } else continue;
      }
      alive++;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.hgt / 2, p.w, p.hgt * Math.abs(Math.cos(p.wob)));
      ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(frame);
    else stop();
  };
  raf = requestAnimationFrame(frame);
  function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    canvas.remove();
  }
  return stop;
}
