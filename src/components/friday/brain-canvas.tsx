"use client";

/* Friday's neural brain. A luminous, brain-shaped mesh of ~560 nodes that turns slowly, sends signals along its
   connections, and answers her state: it breathes when idle, draws rings inward while she listens, floods with
   violet signals while she thinks, and pulses outward with her actual voice while she speaks.
   Pure canvas 2D with additive blending. Reduced-motion users get a still frame that only changes brightness. */

import { useEffect, useRef } from "react";
import { buildBrain, type Brain } from "@/lib/brain-geometry";

export type BrainState = "idle" | "listening" | "thinking" | "speaking";

const CYAN: RGB = [94, 231, 255];
const VIOLET: RGB = [160, 138, 255];
const WHITE: RGB = [232, 250, 255];
type RGB = [number, number, number];

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

interface Pulse { e: number; t: number; speed: number; flip: boolean }
interface Ripple { t0: number; dir: 1 | -1 }

const ORBITS = [
  { r: 1.5, tiltX: 1.18, tiltZ: 0.35, speed: 0.22, dots: 3 },
  { r: 1.72, tiltX: 0.62, tiltZ: -0.55, speed: -0.16, dots: 2 },
  { r: 1.95, tiltX: 1.42, tiltZ: 1.05, speed: 0.11, dots: 2 },
];

export function BrainCanvas({ state, level, className }: { state: BrainState; level?: () => number; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  const redraw = useRef<(() => void) | null>(null);

  useEffect(() => { stateRef.current = state; redraw.current?.(); }, [state]);
  useEffect(() => { levelRef.current = level; }, [level]);

  useEffect(() => {
    const el = canvas.current, box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const brain: Brain = buildBrain();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const phase = brain.points.map((_, i) => (i * 12.9898) % (Math.PI * 2));
    const pulses: Pulse[] = [];
    const ripples: Ripple[] = [];
    const proj = brain.points.map(() => ({ x: 0, y: 0, d: 0 }));

    let w = 0, h = 0, dpr = 1, raf = 0, last = performance.now(), visible = true;
    let rot = 0.6, energy = 0.15, think = 0, listen = 0, speak = 0, rippleClock = 0;

    const resize = () => {
      const r = box.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(r.width * dpr));
      h = Math.max(1, Math.round(r.height * dpr));
      el.width = w; el.height = h;
      if (reduce.matches) frame(performance.now(), true);
    };

    // rotate a unit-space point (Y turn, then a fixed forward tilt) and project with mild perspective
    const project = (x: number, y: number, z: number, cx: number, cy: number, R: number, out: { x: number; y: number; d: number }) => {
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const x1 = x * cr + z * sr, z1 = -x * sr + z * cr;
      const ct = Math.cos(0.32), st = Math.sin(0.32);
      const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
      const p = 1 / (1 - z2 * 0.32);
      out.x = cx + x1 * R * p; out.y = cy + y2 * R * p; out.d = (z2 + 1.4) / 2.8;
    };

    const frame = (now: number, still = false) => {
      const dt = still ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = still ? 0 : now / 1000;
      const s = stateRef.current;

      // ease the state mixers so changes glide instead of snap
      const k = 1 - Math.exp(-dt * 4);
      think += ((s === "thinking" ? 1 : 0) - think) * (still ? 1 : k);
      listen += ((s === "listening" ? 1 : 0) - listen) * (still ? 1 : k);
      speak += ((s === "speaking" ? 1 : 0) - speak) * (still ? 1 : k);
      const voice = s === "speaking" ? Math.min(1, Math.max(0, levelRef.current?.() ?? 0.4)) : 0;
      const target = 0.16 + 0.05 * Math.sin(t * 0.9) + listen * (0.26 + 0.08 * Math.sin(t * 2.4)) + think * (0.42 + 0.1 * Math.sin(t * 5)) + speak * (0.2 + voice * 0.9);
      energy += (target - energy) * (still ? 1 : 1 - Math.exp(-dt * 7));
      rot += dt * (0.11 + think * 0.5 + speak * 0.08);

      // Framing: a wide, short stage seats the brain a little high (the talk button sits below it) and stretches the
      // orbits sideways to use the width; a phone-sized stage gets a slightly smaller brain.
      const wide = w / h > 1.5;
      const narrow = w / dpr < 380;
      const stretch = wide ? Math.min(2.6, (w / h) * 0.62) : 1;
      const cx = w / 2, cy = wide ? h * 0.44 : h / 2;
      const R = (wide ? h * 0.345 : Math.min(w, h) * (narrow ? 0.3 : 0.335)) * (1 + speak * voice * 0.07 + energy * 0.02);
      const col = mix(CYAN, VIOLET, think * 0.85);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      // core glow
      const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 2.1);
      g.addColorStop(0, rgba(col, 0.2 + energy * 0.3));
      g.addColorStop(0.5, rgba(col, 0.07 + energy * 0.1));
      g.addColorStop(1, rgba(col, 0));
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(stretch, 1); ctx.translate(-cx, -cy); // wider glow on a wide stage
      ctx.fillStyle = g; ctx.fillRect(cx - w, 0, w * 2, h);
      ctx.restore();

      // orbits: faint 3D rings with a few bright travellers
      const o = { x: 0, y: 0, d: 0 };
      for (const ring of ORBITS) {
        ctx.beginPath();
        const steps = 72;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const pt = orbitPoint(ring, a);
          project(pt[0], pt[1], pt[2], cx, cy, R, o);
          o.x = cx + (o.x - cx) * stretch;
          if (i === 0) ctx.moveTo(o.x, o.y); else ctx.lineTo(o.x, o.y);
        }
        ctx.strokeStyle = rgba(col, 0.07 + energy * 0.1);
        ctx.lineWidth = dpr * 0.8;
        ctx.stroke();
        for (let d = 0; d < ring.dots; d++) {
          const a = t * ring.speed * (1 + think * 2.5) + (d / ring.dots) * Math.PI * 2;
          const pt = orbitPoint(ring, a);
          project(pt[0], pt[1], pt[2], cx, cy, R, o);
          o.x = cx + (o.x - cx) * stretch;
          ctx.beginPath();
          ctx.arc(o.x, o.y, dpr * (1.4 + o.d * 1.6), 0, Math.PI * 2);
          ctx.fillStyle = rgba(WHITE, 0.35 + o.d * 0.5);
          ctx.fill();
        }
      }

      // project every node once
      for (let i = 0; i < brain.points.length; i++) {
        const p = brain.points[i];
        const breathe = 1 + 0.018 * Math.sin(t * 1.3 + phase[i]) * (0.5 + energy) + speak * voice * 0.05 * Math.sin(phase[i] * 3 + t * 7);
        project(p.x * breathe, p.y * breathe, p.z * breathe, cx, cy, R, proj[i]);
      }

      // connections, batched into depth bands (one stroke per band keeps this cheap)
      const bands = 4;
      for (let b = 0; b < bands; b++) {
        ctx.beginPath();
        for (const [a, c] of brain.edges) {
          const d = (proj[a].d + proj[c].d) / 2;
          if (Math.min(bands - 1, Math.floor(d * bands)) !== b) continue;
          ctx.moveTo(proj[a].x, proj[a].y);
          ctx.lineTo(proj[c].x, proj[c].y);
        }
        const depth = (b + 0.5) / bands;
        ctx.strokeStyle = rgba(col, (0.04 + depth * 0.2) * (0.55 + energy * 1.1));
        ctx.lineWidth = dpr * (0.5 + depth * 0.5);
        ctx.stroke();
      }

      // signals travelling along connections; thinking floods the mesh with them
      if (!still) {
        const rate = 3 + energy * 22 + think * 40;
        let spawn = rate * dt;
        while (spawn > 0 && pulses.length < 90) {
          if (Math.random() < Math.min(1, spawn)) pulses.push({ e: (Math.random() * brain.edges.length) | 0, t: 0, speed: 0.9 + Math.random() * 1.6 + think, flip: Math.random() < 0.5 });
          spawn -= 1;
        }
        for (let i = pulses.length - 1; i >= 0; i--) {
          const pl = pulses[i];
          pl.t += dt * pl.speed;
          if (pl.t >= 1) { pulses.splice(i, 1); continue; }
          const [a0, b0] = brain.edges[pl.e];
          const A = proj[pl.flip ? b0 : a0], B = proj[pl.flip ? a0 : b0];
          const x = A.x + (B.x - A.x) * pl.t, y = A.y + (B.y - A.y) * pl.t;
          const tx = A.x + (B.x - A.x) * Math.max(0, pl.t - 0.22), ty = A.y + (B.y - A.y) * Math.max(0, pl.t - 0.22);
          const d = (A.d + B.d) / 2;
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y);
          ctx.strokeStyle = rgba(WHITE, 0.25 + d * 0.5); ctx.lineWidth = dpr * 1.1; ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, dpr * (1 + d * 1.4), 0, Math.PI * 2);
          ctx.fillStyle = rgba(mix(WHITE, col, 0.35), 0.55 + d * 0.4); ctx.fill();
        }
      }

      // nodes
      for (let i = 0; i < proj.length; i++) {
        const p = proj[i];
        const tw = 0.5 + 0.5 * Math.sin(t * 2.1 + phase[i]);
        const a = (0.18 + Math.pow(p.d, 1.6) * 0.75) * (0.55 + energy * 0.9 + tw * 0.25 * energy);
        ctx.beginPath();
        ctx.arc(p.x, p.y, dpr * (0.7 + p.d * 1.5) * (1 + energy * 0.35), 0, Math.PI * 2);
        ctx.fillStyle = rgba(mix(col, WHITE, p.d * 0.45), a);
        ctx.fill();
      }

      // rings: inward while listening (taking her in), outward with her voice while speaking
      if (!still) {
        rippleClock += dt;
        const every = s === "speaking" ? 0.42 - voice * 0.2 : s === "listening" ? 0.9 : 99;
        if (rippleClock > every && ripples.length < 8 && (s === "listening" || (s === "speaking" && voice > 0.12))) {
          rippleClock = 0;
          ripples.push({ t0: t, dir: s === "listening" ? -1 : 1 });
        }
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        const age = (t - rp.t0) / 1.6;
        if (age >= 1) { ripples.splice(i, 1); continue; }
        const e = 1 - Math.pow(1 - age, 3);
        const r = R * (rp.dir === 1 ? 1.05 + e * 1.05 : 2.05 - e * 1.05);
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.92, 0, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(col, (1 - age) * 0.32);
        ctx.lineWidth = dpr * 1.2;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const orbitPoint = (ring: (typeof ORBITS)[number], a: number): [number, number, number] => {
      const x0 = Math.cos(a) * ring.r, y0 = Math.sin(a) * ring.r * 0.94;
      const y1 = y0 * Math.cos(ring.tiltX), z1 = y0 * Math.sin(ring.tiltX);
      return [x0 * Math.cos(ring.tiltZ) - y1 * Math.sin(ring.tiltZ), x0 * Math.sin(ring.tiltZ) + y1 * Math.cos(ring.tiltZ), z1];
    };

    const loop = (now: number) => {
      if (visible && !reduce.matches) frame(now);
      raf = requestAnimationFrame(loop);
    };

    redraw.current = () => { if (reduce.matches) frame(performance.now(), true); };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) last = performance.now(); });
    io.observe(box);
    const onMotion = () => { resize(); if (!reduce.matches) last = performance.now(); };
    reduce.addEventListener("change", onMotion);
    resize();
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); reduce.removeEventListener("change", onMotion); redraw.current = null; };
  }, []);

  return (
    <div ref={wrap} className={className}>
      <canvas ref={canvas} aria-hidden="true" className="block h-full w-full" />
    </div>
  );
}
