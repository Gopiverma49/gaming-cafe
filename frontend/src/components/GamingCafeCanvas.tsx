import React, { useEffect, useRef } from 'react';
import cafeBackgroundImg from '../assets/gaming-cafe-bg.png';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  type:
    | 'ps-triangle'
    | 'ps-circle'
    | 'ps-cross'
    | 'ps-square'
    | 'sparkle'
    | 'coffee'
    | 'burger'
    | 'pizza'
    | 'drink'
    | 'dot';
  color: string;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
}

interface GamingCafeCanvasProps {
  isLight?: boolean;
}

export const GamingCafeCanvas: React.FC<GamingCafeCanvasProps> = ({ isLight = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    // Mouse coordinates for gentle interactive deflection
    let mouseX = -1000;
    let mouseY = -1000;
    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // Color palettes (tuned for clean corporate lounge ambiance)
    const lightColors = [
       '#172554', // Primary Navy
       '#1E3A8A', // Primary Hover Navy
       '#EA580C', // Accent Orange
       '#15803D', // Success Green
       '#94A3B8', // Neutral Slate
       '#CBD5E1', // Border Slate
    ];

    const darkColors = [
      '#172554',
      '#EA580C',
      '#15803D',
      '#64748B',
    ];

    const colors = isLight ? lightColors : darkColors;
    const types: Particle['type'][] = [
      'ps-triangle',
      'ps-circle',
      'ps-cross',
      'ps-square',
      'sparkle',
      'coffee',
      'burger',
      'pizza',
      'drink',
      'dot',
    ];

    // Create ambient particles (well-spaced, never cluttered)
    const count = Math.min(42, Math.floor((width * height) / 28000));
    const particles: Particle[] = [];

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        size: Math.random() * 12 + 10, // 10px to 22px
        type: types[i % types.length],
        color: colors[i % colors.length],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.015,
        opacity: isLight ? Math.random() * 0.2 + 0.12 : Math.random() * 0.28 + 0.2,
      });
    }

    // Drawing helper for PlayStation & Cafe symbols
    const drawItem = (p: Particle) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.strokeStyle = p.color;
      ctx.fillStyle = p.color;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = p.opacity;

      if (!isLight) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = Math.min(p.size * 0.75, 15);
      }

      const s = p.size;

      switch (p.type) {
        case 'ps-triangle':
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.lineTo(s * 0.86, s * 0.6);
          ctx.lineTo(-s * 0.86, s * 0.6);
          ctx.closePath();
          ctx.stroke();
          break;

        case 'ps-circle':
          ctx.beginPath();
          ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2);
          ctx.stroke();
          break;

        case 'ps-cross':
          ctx.beginPath();
          ctx.moveTo(-s * 0.7, -s * 0.7);
          ctx.lineTo(s * 0.7, s * 0.7);
          ctx.moveTo(s * 0.7, -s * 0.7);
          ctx.lineTo(-s * 0.7, s * 0.7);
          ctx.stroke();
          break;

        case 'ps-square':
          ctx.beginPath();
          ctx.rect(-s * 0.65, -s * 0.65, s * 1.3, s * 1.3);
          ctx.stroke();
          break;

        case 'sparkle':
          // 4-pointed diamond star / sparkle
          ctx.beginPath();
          ctx.moveTo(0, -s * 0.85);
          ctx.quadraticCurveTo(0, 0, s * 0.85, 0);
          ctx.quadraticCurveTo(0, 0, 0, s * 0.85);
          ctx.quadraticCurveTo(0, 0, -s * 0.85, 0);
          ctx.quadraticCurveTo(0, 0, 0, -s * 0.85);
          ctx.closePath();
          ctx.fill();
          break;

        case 'coffee':
          // Cup base
          ctx.beginPath();
          ctx.moveTo(-s * 0.6, -s * 0.3);
          ctx.lineTo(s * 0.6, -s * 0.3);
          ctx.lineTo(s * 0.45, s * 0.6);
          ctx.lineTo(-s * 0.45, s * 0.6);
          ctx.closePath();
          ctx.stroke();
          // Handle
          ctx.beginPath();
          ctx.arc(s * 0.65, 0, s * 0.25, -Math.PI / 2, Math.PI / 2);
          ctx.stroke();
          // Steam wisps
          ctx.beginPath();
          ctx.moveTo(-s * 0.2, -s * 0.5);
          ctx.quadraticCurveTo(-s * 0.1, -s * 0.8, -s * 0.25, -s * 1.0);
          ctx.moveTo(s * 0.2, -s * 0.5);
          ctx.quadraticCurveTo(s * 0.3, -s * 0.8, s * 0.15, -s * 1.0);
          ctx.stroke();
          break;

        case 'burger':
          // Top bun
          ctx.beginPath();
          ctx.arc(0, -s * 0.2, s * 0.7, Math.PI, 0);
          ctx.stroke();
          // Patty
          ctx.beginPath();
          ctx.moveTo(-s * 0.7, 0);
          ctx.lineTo(s * 0.7, 0);
          ctx.stroke();
          // Bottom bun
          ctx.beginPath();
          ctx.moveTo(-s * 0.6, s * 0.3);
          ctx.lineTo(s * 0.6, s * 0.3);
          ctx.stroke();
          break;

        case 'pizza':
          // Pizza slice triangle
          ctx.beginPath();
          ctx.moveTo(0, s * 0.8);
          ctx.lineTo(s * 0.6, -s * 0.6);
          ctx.quadraticCurveTo(0, -s * 0.8, -s * 0.6, -s * 0.6);
          ctx.closePath();
          ctx.stroke();
          // Pepperoni dots
          ctx.beginPath();
          ctx.arc(0, -s * 0.2, s * 0.12, 0, Math.PI * 2);
          ctx.arc(s * 0.2, s * 0.2, s * 0.1, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'drink':
          // Cup with straw
          ctx.beginPath();
          ctx.moveTo(-s * 0.5, -s * 0.5);
          ctx.lineTo(s * 0.5, -s * 0.5);
          ctx.lineTo(s * 0.35, s * 0.7);
          ctx.lineTo(-s * 0.35, s * 0.7);
          ctx.closePath();
          ctx.stroke();
          // Straw
          ctx.beginPath();
          ctx.moveTo(0, -s * 0.5);
          ctx.lineTo(s * 0.3, -s * 1.0);
          ctx.stroke();
          break;

        case 'dot':
        default:
          ctx.beginPath();
          ctx.arc(0, 0, s * 0.35, 0, Math.PI * 2);
          ctx.fill();
          break;
      }

      ctx.restore();
    };

    // Render loop
    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Connect nearby symbols with very subtle, elegant lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 130) {
            ctx.beginPath();
            ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.08)' : 'rgba(148, 163, 184, 0.06)';
            ctx.lineWidth = 1;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Update and draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Motion
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;

        // Gentle interactive mouse deflection
        const dx = p.x - mouseX;
        const dy = p.y - mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120 && dist > 0) {
          const force = (120 - dist) / 120;
          p.x += (dx / dist) * force * 1.2;
          p.y += (dy / dist) * force * 1.2;
        }

        // Screen boundary wrap
        if (p.x < -30) p.x = width + 30;
        if (p.x > width + 30) p.x = -30;
        if (p.y < -30) p.y = height + 30;
        if (p.y > height + 30) p.y = -30;

        drawItem(p);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isLight]);

  return (
    <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden select-none">
      {/* Ambient Gaming Lounge & Cafe Background Scene */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-700"
        style={{
          backgroundImage: `url(${cafeBackgroundImg})`,
          filter: isLight
            ? 'brightness(1.02) contrast(0.98) opacity(0.04)'
            : 'brightness(0.72) contrast(1.18) saturate(1.12)',
        }}
      />

      {/* Atmospheric Vignette & Deep Lounge Gradient Overlays */}
      <div
        className="absolute inset-0"
        style={{
          background: isLight
            ? 'radial-gradient(ellipse at center, rgba(255, 247, 237, 0.7) 0%, rgba(255, 247, 237, 0.95) 100%)'
            : 'radial-gradient(ellipse at 35% 45%, rgba(10, 25, 47, 0.45) 0%, rgba(7, 11, 20, 0.78) 65%, rgba(3, 7, 18, 0.94) 100%), linear-gradient(to right, rgba(3, 7, 18, 0.62) 0%, rgba(15, 23, 42, 0.22) 50%, rgba(28, 14, 5, 0.58) 100%)',
        }}
      />

      {/* Interactive Moving Canvas Symbols Layer */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-0 transition-opacity duration-700"
        style={{ opacity: 0.95 }}
      />
    </div>
  );
};
