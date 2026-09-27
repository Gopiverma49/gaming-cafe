import React, { useState, useEffect } from 'react';
import { Cookie, ShieldCheck } from 'lucide-react';

interface CookieBannerProps {
  onOpenPrivacy?: () => void;
}

export const CookieBanner: React.FC<CookieBannerProps> = ({ onOpenPrivacy }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('vanya_cookie_consent');
    if (!consent) {
      // Show banner after brief delay
      const timer = setTimeout(() => setIsVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = (level: 'all' | 'essential') => {
    localStorage.setItem('vanya_cookie_consent', level);
    setIsVisible(false);

    if (level === 'all') {
      window.dispatchEvent(new CustomEvent('analytics_consent_granted'));
    }
  };

  if (!isVisible) return null;

  return (
    <aside
      aria-label="Cookie consent banner"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-50 bg-[#172554] text-white p-4 sm:p-5 rounded-2xl shadow-2xl border border-blue-900/50 backdrop-blur-md animate-in slide-in-from-bottom-5 duration-300"
    >
      <div className="flex items-start gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-orange-500/20 border border-orange-500/30 text-orange-400 flex items-center justify-center shrink-0">
          <Cookie className="w-5 h-5" />
        </div>
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-1.5">
            <h4 className="text-sm font-bold text-white font-display">Player Privacy & Cookies</h4>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-xs text-blue-200/80 leading-relaxed font-sans">
            We use functional storage to maintain seat orders and sessions.{' '}
            {onOpenPrivacy && (
              <button
                onClick={onOpenPrivacy}
                className="underline hover:text-white transition-colors cursor-pointer text-orange-300 inline font-semibold"
              >
                Read our Privacy Policy.
              </button>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2.5 mt-3.5 pt-3 border-t border-blue-900/40">
        <button
          onClick={() => handleAccept('essential')}
          className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-blue-950/60 hover:bg-blue-900/60 text-slate-300 hover:text-white text-xs font-semibold transition-colors border border-blue-800/40 cursor-pointer"
        >
          Essential Only
        </button>
        <button
          onClick={() => handleAccept('all')}
          className="min-h-[44px] px-4 py-1.5 rounded-xl bg-[#EA580C] hover:bg-orange-600 text-white text-xs font-bold uppercase tracking-wider transition-colors shadow-md shadow-orange-500/20 cursor-pointer"
        >
          Accept All
        </button>
      </div>
    </aside>
  );
};
