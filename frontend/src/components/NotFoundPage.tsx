import React from 'react';
import { Home, ArrowLeft, Compass } from 'lucide-react';
import { GamingCafeCanvas } from './GamingCafeCanvas';

interface NotFoundPageProps {
  onReturnHome?: () => void;
}

export const NotFoundPage: React.FC<NotFoundPageProps> = ({ onReturnHome }) => {
  const handleHome = () => {
    if (onReturnHome) {
      onReturnHome();
    } else {
      window.location.href = '/';
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF7ED] text-[#0F172A] flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden select-none">
      <GamingCafeCanvas isLight={true} />

      <div className="w-full max-w-lg bg-white/95 backdrop-blur-xl p-8 sm:p-10 rounded-3xl border border-[#FED7AA] shadow-2xl space-y-6 relative z-10 text-center">
        {/* Badge & Icon */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-[#EA580C]/10 border border-[#EA580C]/30 flex items-center justify-center text-[#EA580C] shadow-lg shadow-[#EA580C]/10 animate-bounce">
            <Compass className="w-8 h-8" />
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-[#EA580C] bg-[#FFEDD5] px-3 py-1 rounded-full border border-[#FDBA74]">
            404 • LEVEL NOT FOUND
          </span>
        </div>

        {/* Heading & Description */}
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-black font-display text-[#172554] tracking-tight">
            Station Disconnected
          </h1>
          <p className="text-xs sm:text-sm text-[#64748B] leading-relaxed max-w-sm mx-auto font-sans">
            The seat, console room, or route you are attempting to reach does not exist or has been relocated to another station.
          </p>
        </div>

        {/* Action CTAs */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={handleHome}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#EA580C]/25 cursor-pointer min-h-[44px]"
          >
            <Home className="w-4 h-4" />
            <span>Return to Gaming Lounge</span>
          </button>

          <button
            onClick={() => window.history.back()}
            className="w-full sm:w-auto px-5 py-3 rounded-xl bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#172554] font-semibold text-xs transition-all border border-[#CBD5E1] flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go Back</span>
          </button>
        </div>

        {/* Footer help note */}
        <div className="pt-4 border-t border-[#F1F5F9] text-[11px] text-[#94A3B8]">
          Need help finding your station? Inquire at the front desk or contact staff operations.
        </div>
      </div>
    </div>
  );
};
