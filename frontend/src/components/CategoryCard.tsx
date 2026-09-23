import React from 'react';
import {
  Gamepad2,
  Users,
  Sparkles,
  Lock,
  Cpu,
} from 'lucide-react';
import { CategoryAvailability, PricingTier } from '../types';

interface CategoryCardProps {
  category: CategoryAvailability;
  onSelectCategory: (category: CategoryAvailability, tier?: PricingTier) => void;
}

export const CategoryCard: React.FC<CategoryCardProps> = ({
  category,
  onSelectCategory,
}) => {
  const isAvailable = category.is_available && category.available_units > 0;

  // Category Icon & Accent Colors
  const getCategoryTheme = (id: string, name?: string, tier?: string) => {
    const key = `${id} ${name || ''} ${tier || ''}`.toLowerCase();
    if (key.includes('car') || key.includes('sim')) {
      return {
        icon: <Sparkles className="w-4 h-4 text-amber-400" />,
        badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        borderHover: 'hover:border-amber-500/60 hover:shadow-amber-500/10',
        accentColor: 'text-amber-400',
      };
    }
    if (key.includes('vr')) {
      return {
        icon: <Cpu className="w-4 h-4 text-teal-400" />,
        badge: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
        borderHover: 'hover:border-teal-500/60 hover:shadow-teal-500/10',
        accentColor: 'text-teal-400',
      };
    }
    if (key.includes('multi')) {
      return {
        icon: <Users className="w-4 h-4 text-purple-400" />,
        badge: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
        borderHover: 'hover:border-purple-500/60 hover:shadow-purple-500/10',
        accentColor: 'text-purple-400',
      };
    }
    return {
      icon: <Gamepad2 className="w-4 h-4 text-blue-400" />,
      badge: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
      borderHover: 'hover:border-blue-500/60 hover:shadow-blue-500/10',
      accentColor: 'text-blue-400',
    };
  };

  const theme = getCategoryTheme(category.id, category.name, category.tier);

  // Fallback Pricing Tiers if not provided
  const pricingTiers: PricingTier[] = Array.isArray(category.pricing_tiers) && category.pricing_tiers.length > 0
    ? category.pricing_tiers
    : [
        { duration_min: 30, price: Math.round(Number(category.hourly_rate || 180) * 0.55), label: '30 mins' },
        { duration_min: 60, price: Number(category.hourly_rate || 180), label: '1 hr' },
        { duration_min: 120, price: Math.round(Number(category.hourly_rate || 180) * 1.8), label: '2 hrs' },
      ];

  return (
    <div
      className={`bg-slate-900/85 backdrop-blur-xl p-5 sm:p-6 rounded-3xl border transition-all duration-300 flex flex-col justify-between shadow-lg hover:shadow-2xl ${
        isAvailable
          ? `border-slate-800 ${theme.borderHover}`
          : 'border-slate-800/80 opacity-80'
      }`}
    >
      <div>
        {/* Header: Experience Badge */}
        <div className="flex items-center justify-between gap-2 mb-3.5">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-mono-code font-bold uppercase px-2.5 py-1 rounded-full border ${theme.badge}`}
            >
              {theme.icon}
              <span>{category.tier}</span>
            </span>
          </div>
        </div>

        {/* Category Name */}
        <div className="mb-4">
          <h4 className="text-xl font-black text-white font-display tracking-wide">
            {category.name}
          </h4>
        </div>
      </div>

      {/* Dynamic Action Area: Duration Selection or Busy Shield */}
      <div className="pt-3 border-t border-slate-800 space-y-2.5">
        {isAvailable ? (
          <div>
            <div className="text-[11px] font-mono-code uppercase text-slate-400 mb-2 font-bold">
              <span>Select Duration:</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {pricingTiers.map((pt, i) => (
                <button
                  key={i}
                  onClick={() => onSelectCategory(category, pt)}
                  className="py-2.5 px-2 rounded-xl bg-slate-950 hover:bg-blue-600/20 border border-slate-800 hover:border-blue-500/60 text-white font-bold transition-all flex flex-col items-center justify-center gap-0.5 shadow-sm group active:scale-95 cursor-pointer"
                  title={`Book ${category.name} for ${pt.label || `${pt.duration_min}m`}`}
                >
                  <span className="text-xs font-display tracking-wide group-hover:text-blue-300 transition-colors">
                    {pt.label || `${pt.duration_min} mins`}
                  </span>
                  <span className="text-[11px] font-mono-code font-bold text-emerald-400">
                    ₹{Number(pt.price).toFixed(0)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="w-full py-3 px-4 bg-slate-950/70 border border-slate-800 text-slate-500 font-bold rounded-2xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-not-allowed select-none">
            <Lock className="w-3.5 h-3.5 text-slate-600" />
            <span>Currently Busy (All Units In Use)</span>
          </div>
        )}
      </div>
    </div>
  );
};
