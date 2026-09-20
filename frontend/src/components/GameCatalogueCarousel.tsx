import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Disc3 } from 'lucide-react';

export interface GameItem {
  index: number;
  id: string;
  title: string;
}

export const CATALOGUE_GAMES: GameItem[] = [
  { index: 0, id: 'gta6', title: 'Grand Theft Auto VI' },
  { index: 1, id: 'spiderman2', title: "Marvel's Spider-Man 2" },
  { index: 2, id: 'tekken8', title: 'Tekken 8' },
  { index: 3, id: 'fc26', title: 'EA Sports FC 26' },
  { index: 4, id: 'cyberpunk', title: 'Cyberpunk 2077: Phantom Liberty' },
  { index: 5, id: 'mk1', title: 'Mortal Kombat 1' },
  { index: 6, id: 'ghost_of_tsushima', title: "Ghost of Tsushima: Director's Cut" },
  { index: 7, id: 'god_of_war', title: 'God of War Ragnarök' },
  { index: 8, id: 'gta5', title: 'Grand Theft Auto V' },
  { index: 9, id: 'f1_25', title: 'EA Sports F1 25' },
  { index: 10, id: 'last_of_us_2', title: 'The Last of Us Part II Remastered' },
  { index: 11, id: 'crew_motorfest', title: 'The Crew Motorfest' },
  { index: 12, id: 'spiderman_miles', title: "Marvel's Spider-Man: Miles Morales" },
  { index: 13, id: 'ac_mirage', title: "Assassin's Creed Mirage" },
  { index: 14, id: 'mk11', title: 'Mortal Kombat 11 Ultimate' },
  { index: 15, id: 'gt7', title: 'Gran Turismo 7' },
  { index: 16, id: 'battlefield6', title: 'Battlefield 6' },
  { index: 17, id: 'rdr', title: 'Red Dead Redemption' },
  { index: 18, id: 'wwe2k26', title: 'WWE 2K26' },
  { index: 19, id: 'spiderman_remaster', title: "Marvel's Spider-Man Remastered" },
  { index: 20, id: 'forza5', title: 'Forza Horizon 5 (PS5 Edition)' },
];

// Tripled set for seamless infinite wrapping in both left and right directions
const TRIPLE_GAMES = [
  ...CATALOGUE_GAMES.map((g) => ({ item: g, uniqueKey: `set0-${g.id}` })),
  ...CATALOGUE_GAMES.map((g) => ({ item: g, uniqueKey: `set1-${g.id}` })),
  ...CATALOGUE_GAMES.map((g) => ({ item: g, uniqueKey: `set2-${g.id}` })),
];

interface GameCatalogueCarouselProps {
  userName?: string;
}

type CarouselMode = 'idle_autoscroll' | 'dragging' | 'inertial_fling' | 'snapping' | 'at_rest';

interface PointerSample {
  x: number;
  time: number;
}

export const GameCatalogueCarousel: React.FC<GameCatalogueCarouselProps> = ({
  userName = 'gopi',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Interaction & Physics state
  const modeRef = useRef<CarouselMode>('idle_autoscroll');
  const isMouseDownRef = useRef(false);
  const startXRef = useRef(0);
  const startScrollLeftRef = useRef(0);
  const velocityRef = useRef(0); // px per second
  const targetSnapRef = useRef(0);
  const snapStartTimeRef = useRef(0);
  const pointerHistoryRef = useRef<PointerSample[]>([]);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  // Measure card pitch dynamically from rendered DOM
  const getCardPitch = (el: HTMLDivElement): number => {
    if (el.children.length >= 2) {
      const card0 = el.children[0] as HTMLElement;
      const card1 = el.children[1] as HTMLElement;
      const diff = card1.offsetLeft - card0.offsetLeft;
      if (diff > 10) return diff;
    }
    const singleSetWidth = el.scrollWidth / 3;
    if (singleSetWidth > 0) return singleSetWidth / 21;
    return 134;
  };

  // Seamless boundary wrap helper across all states
  const checkWrap = (el: HTMLDivElement) => {
    const singleSetWidth = el.scrollWidth / 3;
    if (singleSetWidth <= 0) return;

    if (el.scrollLeft >= singleSetWidth * 2) {
      el.scrollLeft -= singleSetWidth;
      if (modeRef.current === 'dragging') {
        startScrollLeftRef.current -= singleSetWidth;
      } else if (modeRef.current === 'snapping') {
        targetSnapRef.current -= singleSetWidth;
      }
    } else if (el.scrollLeft <= singleSetWidth * 0.1) {
      el.scrollLeft += singleSetWidth;
      if (modeRef.current === 'dragging') {
        startScrollLeftRef.current += singleSetWidth;
      } else if (modeRef.current === 'snapping') {
        targetSnapRef.current += singleSetWidth;
      }
    }
  };

  // Center scroll to Set 1 on initial mount
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const initScroll = () => {
      const singleSetWidth = el.scrollWidth / 3;
      if (singleSetWidth > 0 && el.scrollLeft === 0) {
        el.scrollLeft = singleSetWidth;
      }
    };

    initScroll();
    const frameId = requestAnimationFrame(initScroll);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Unified 60fps Animation Loop: Auto-Scroll, Inertial Fling Deceleration & Magnetic Snap Settle
  useEffect(() => {
    let lastTime = performance.now();

    const step = (now: number) => {
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const el = scrollRef.current;
      if (el) {
        const mode = modeRef.current;

        if (mode === 'idle_autoscroll') {
          // Continuous silky drift (~48px/sec)
          el.scrollLeft += 48 * delta;
          checkWrap(el);
        } else if (mode === 'inertial_fling') {
          // Friction deceleration (exponential decay)
          velocityRef.current *= Math.pow(0.952, delta * 60);
          el.scrollLeft += velocityRef.current * delta;
          checkWrap(el);

          // As momentum dissipates near zero speed (< 75px/s), engage gentle magnetic snap to nearest card
          if (Math.abs(velocityRef.current) < 75) {
            const pitch = getCardPitch(el);
            targetSnapRef.current = Math.round(el.scrollLeft / pitch) * pitch;
            snapStartTimeRef.current = performance.now();
            modeRef.current = 'snapping';
          }
        } else if (mode === 'snapping') {
          // Smooth ease-out lerp to nearest card snap point
          const diff = targetSnapRef.current - el.scrollLeft;
          const isTimedOut = performance.now() - snapStartTimeRef.current > 400;

          if (Math.abs(diff) < 1.8 || isTimedOut) {
            el.scrollLeft = Math.round(targetSnapRef.current);
            checkWrap(el);
            modeRef.current = 'at_rest';

            // Once settled cleanly into full alignment, smoothly resume auto-scroll after ~1s of inactivity
            if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
            resumeTimeoutRef.current = setTimeout(() => {
              modeRef.current = 'idle_autoscroll';
            }, 1000);
          } else {
            // Guarantee minimum step to prevent subpixel truncation stalls on high-DPI displays
            const stepAmount = diff * Math.min(1, delta * 14);
            const minStep = Math.sign(diff) * Math.min(Math.abs(diff), 1.5);
            const finalStep = Math.abs(stepAmount) < Math.abs(minStep) ? minStep : stepAmount;
            el.scrollLeft += finalStep;
            checkWrap(el);
          }
        }
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);
    };
  }, []);

  // Launch momentum or snap from release velocity
  const handlePointerRelease = useCallback((releaseVelocity: number) => {
    const el = scrollRef.current;
    if (!el) return;

    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);

    if (Math.abs(releaseVelocity) > 90) {
      let initialV = releaseVelocity;
      // Hard flick acceleration: boost high-velocity throws across multiple cards
      if (Math.abs(initialV) > 600) {
        const boost = 1 + Math.min(1.2, (Math.abs(initialV) - 600) / 2200);
        initialV *= boost;
      }
      velocityRef.current = initialV;
      modeRef.current = 'inertial_fling';
    } else {
      // Gentle release: directly snap to nearest card
      const pitch = getCardPitch(el);
      targetSnapRef.current = Math.round(el.scrollLeft / pitch) * pitch;
      snapStartTimeRef.current = performance.now();
      modeRef.current = 'snapping';
    }
  }, []);

  // Mouse Drag handlers (Desktop)
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Left click only
    const el = scrollRef.current;
    if (!el) return;

    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);

    isMouseDownRef.current = true;
    startXRef.current = e.pageX;
    startScrollLeftRef.current = el.scrollLeft;
    modeRef.current = 'dragging';
    setIsDragging(true);

    pointerHistoryRef.current = [{ x: e.pageX, time: performance.now() }];
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isMouseDownRef.current) return;
      const el = scrollRef.current;
      if (!el) return;

      e.preventDefault();
      const deltaX = e.pageX - startXRef.current;
      el.scrollLeft = startScrollLeftRef.current - deltaX;
      checkWrap(el);

      const now = performance.now();
      pointerHistoryRef.current.push({ x: e.pageX, time: now });
      const cutoff = now - 100;
      pointerHistoryRef.current = pointerHistoryRef.current.filter((p) => p.time >= cutoff);
    };

    const handleMouseUp = () => {
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;
      setIsDragging(false);

      const history = pointerHistoryRef.current;
      let releaseVelocity = 0;
      if (history.length >= 2) {
        const oldest = history[0];
        const newest = history[history.length - 1];
        const dt = (newest.time - oldest.time) / 1000;
        if (dt > 0.015) {
          releaseVelocity = -(newest.x - oldest.x) / dt;
        }
      }

      handlePointerRelease(releaseVelocity);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: false });
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handlePointerRelease]);

  // Touch Swipe handlers (Mobile)
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || e.touches.length === 0) return;

    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);

    isMouseDownRef.current = false;
    const touch = e.touches[0];
    startXRef.current = touch.pageX;
    startScrollLeftRef.current = el.scrollLeft;
    modeRef.current = 'dragging';

    pointerHistoryRef.current = [{ x: touch.pageX, time: performance.now() }];
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (modeRef.current !== 'dragging') return;
    const el = scrollRef.current;
    if (!el || e.touches.length === 0) return;

    const touch = e.touches[0];
    const deltaX = touch.pageX - startXRef.current;
    el.scrollLeft = startScrollLeftRef.current - deltaX;
    checkWrap(el);

    const now = performance.now();
    pointerHistoryRef.current.push({ x: touch.pageX, time: now });
    const cutoff = now - 100;
    pointerHistoryRef.current = pointerHistoryRef.current.filter((p) => p.time >= cutoff);
  };

  const handleTouchEnd = () => {
    if (modeRef.current !== 'dragging') return;

    const history = pointerHistoryRef.current;
    let releaseVelocity = 0;
    if (history.length >= 2) {
      const oldest = history[0];
      const newest = history[history.length - 1];
      const dt = (newest.time - oldest.time) / 1000;
      if (dt > 0.015) {
        releaseVelocity = -(newest.x - oldest.x) / dt;
      }
    }

    handlePointerRelease(releaseVelocity);
  };

  // Horizontal wheel / trackpad support
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;

    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current);

    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    el.scrollLeft += delta;
    checkWrap(el);

    const pitch = getCardPitch(el);
    targetSnapRef.current = Math.round(el.scrollLeft / pitch) * pitch;
    modeRef.current = 'snapping';
  };

  return (
    <div className="relative w-full rounded-2xl sm:rounded-3xl bg-gradient-to-br from-slate-900/90 via-[#0a0f1d]/90 to-slate-950/95 border border-slate-800/80 p-4 sm:p-6 lg:p-7 shadow-2xl overflow-hidden backdrop-blur-xl">
      {/* Ambient background glow & atmospheric star sparks */}
      <div className="absolute top-0 left-1/4 w-96 h-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-4 right-10 text-cyan-400/40 text-xs animate-pulse pointer-events-none">✦</div>
      <div className="absolute bottom-6 left-12 text-blue-400/30 text-sm animate-pulse pointer-events-none delay-500">✦</div>

      {/* Layout & Positioning: Desktop side-by-side (45% left / 55% right); Mobile stacked (100% full width) */}
      <div className="relative z-10 flex flex-col lg:flex-row items-center gap-6 lg:gap-8">
        
        {/* LEFT PANEL (~45% on desktop, stacks on mobile) */}
        <div className="w-full lg:w-[45%] shrink-0 flex flex-col justify-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-400/30 text-blue-300 text-xs font-semibold tracking-wide w-fit">
            <Disc3 className="w-3.5 h-3.5 text-cyan-400 animate-spin" style={{ animationDuration: '6s' }} />
            <span>PS5 Ultra 4K Game Vault</span>
          </div>

          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black font-display tracking-tight text-white leading-tight">
            Welcome to the Lounge, <span className="text-cyan-400 uppercase">{userName}!</span>
          </h2>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-lg">
            High-performance 4K PS5 gaming meets elevated comfort food. Savor gourmet snacks, craft coffee, and chilled refreshments brought directly to your setup.
          </p>
        </div>

        {/* RIGHT PANEL (~55% on desktop, expands to 100% full width on mobile) */}
        <div className="w-full lg:w-[55%] relative overflow-hidden py-1">
          {/* Continuous Marquee Mask fade at the left and right edges */}
          <div className="marquee-mask relative w-full overflow-hidden select-none">
            <div
              ref={scrollRef}
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onWheel={handleWheel}
              className={`flex items-center gap-3 sm:gap-4 overflow-x-auto select-none py-2 px-1 no-scrollbar touch-pan-y ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              style={{
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {TRIPLE_GAMES.map(({ item, uniqueKey }) => (
                <GameCard key={uniqueKey} game={item} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface GameCardProps {
  game: GameItem;
}

const GameCard: React.FC<GameCardProps> = ({ game }) => {
  return (
    <div
      title={game.title}
      aria-label={game.title}
      draggable={false}
      className="group shrink-0 select-none snap-start transition-transform duration-300 hover:-translate-y-1"
    >
      <div
        className="relative h-[130px] sm:h-[165px] aspect-[250/350] rounded-[8px] overflow-hidden border border-slate-700/80 bg-slate-900 transition-all duration-300 group-hover:border-cyan-400 group-hover:shadow-[0_0_22px_rgba(6,182,212,0.65),0_0_40px_rgba(59,130,246,0.35)] pointer-events-none"
        style={{
          backgroundImage: "url('/games/games_sprite_strip.webp')",
          backgroundSize: '2100% 100%',
          backgroundPosition: `${(game.index / 20) * 100}% 0%`,
          backgroundRepeat: 'no-repeat',
        }}
      >
        {/* Gloss diagonal light sheen over the case sleeve */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent pointer-events-none" />

        {/* Floor sheen overlay */}
        <div className="absolute inset-0 bg-cyan-400/0 group-hover:bg-cyan-400/10 transition-colors duration-300 pointer-events-none" />
      </div>
    </div>
  );
};
