import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronRight, Check, Sparkles, Loader2 } from 'lucide-react';

interface SlideToConfirmProps {
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  label?: string;
  confirmedLabel?: string;
}

export const SlideToConfirm: React.FC<SlideToConfirmProps> = ({
  onConfirm,
  disabled = false,
  isLoading = false,
  label = 'SLIDE TO START SESSION',
  confirmedLabel = 'CONFIRMED!',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);

  const [dragProgress, setDragProgress] = useState(0); // 0 to 1
  const [isDragging, setIsDragging] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);

  const startXRef = useRef(0);
  const trackWidthRef = useRef(0);
  const knobWidthRef = useRef(0);

  const resetSlider = useCallback(() => {
    setIsDragging(false);
    setDragProgress(0);
    setIsConfirmed(false);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || isLoading || isConfirmed) return;

    const container = containerRef.current;
    const knob = knobRef.current;
    if (!container || !knob) return;

    // Set pointer capture to track moves outside element bounds
    knob.setPointerCapture(e.pointerId);

    trackWidthRef.current = container.offsetWidth;
    knobWidthRef.current = knob.offsetWidth;
    startXRef.current = e.clientX;
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || isConfirmed || disabled || isLoading) return;

    const maxSlide = trackWidthRef.current - knobWidthRef.current;
    if (maxSlide <= 0) return;

    const deltaX = Math.max(0, e.clientX - startXRef.current);
    const progress = Math.min(1, Math.max(0, deltaX / maxSlide));
    setDragProgress(progress);
  };

  const handlePointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || isConfirmed) return;

    try {
      knobRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if capture already lost
    }

    setIsDragging(false);

    // 85% threshold check
    if (dragProgress >= 0.85 && !disabled && !isLoading) {
      setDragProgress(1);
      setIsConfirmed(true);
      try {
        await onConfirm();
      } catch (err) {
        console.error('Confirm action failed:', err);
        resetSlider();
      }
    } else {
      // Spring back to start
      setDragProgress(0);
    }
  };

  useEffect(() => {
    if (!isLoading && !isConfirmed && dragProgress > 0 && !isDragging) {
      setDragProgress(0);
    }
  }, [isLoading, isConfirmed, dragProgress, isDragging]);

  const maxSlide = (containerRef.current?.offsetWidth || 300) - (knobRef.current?.offsetWidth || 56);
  const knobTranslateX = dragProgress * Math.max(0, maxSlide);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-14 rounded-2xl p-1 select-none overflow-hidden transition-all duration-300 ${
        disabled
          ? 'bg-slate-900/60 border border-slate-800 opacity-60 cursor-not-allowed'
          : isConfirmed
          ? 'bg-emerald-950/80 border border-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
          : 'bg-slate-950 border border-slate-800 hover:border-slate-700 shadow-inner'
      }`}
    >
      {/* Background Fill Progress Bar */}
      <div
        className={`absolute top-0 left-0 bottom-0 rounded-2xl transition-all ${
          isDragging ? 'duration-0' : 'duration-300'
        } ${
          isConfirmed
            ? 'bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-400 opacity-90'
            : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 opacity-40'
        }`}
        style={{ width: `${Math.max(0, Math.min(100, (dragProgress * 100) + 8))}%` }}
      />

      {/* Shimmer / Action Label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-12">
        <span
          className={`text-xs sm:text-sm font-black font-display tracking-widest uppercase transition-opacity duration-200 ${
            isConfirmed
              ? 'text-white'
              : dragProgress > 0.4
              ? 'text-white/40'
              : 'text-slate-300 animate-pulse'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              <span>LAUNCHING SESSION...</span>
            </span>
          ) : isConfirmed ? (
            <span className="flex items-center gap-1.5 text-emerald-300">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>{confirmedLabel}</span>
            </span>
          ) : (
            <span>{label}</span>
          )}
        </span>
      </div>

      {/* Draggable Knob */}
      <div
        ref={knobRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          transform: `translateX(${knobTranslateX}px)`,
          touchAction: 'none',
        }}
        className={`relative z-10 w-12 h-12 rounded-xl flex items-center justify-center cursor-grab active:cursor-grabbing transition-transform ${
          isDragging ? 'duration-0' : 'duration-300 ease-out'
        } ${
          isConfirmed
            ? 'bg-emerald-400 text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.8)]'
            : disabled
            ? 'bg-slate-800 text-slate-500'
            : 'bg-gradient-to-br from-blue-500 via-indigo-500 to-cyan-400 text-white shadow-lg shadow-blue-500/40 hover:scale-105'
        }`}
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : isConfirmed ? (
          <Check className="w-6 h-6 stroke-[3]" />
        ) : (
          <div className="flex items-center -space-x-1">
            <ChevronRight className="w-5 h-5 text-white animate-pulse" />
          </div>
        )}
      </div>
    </div>
  );
};
