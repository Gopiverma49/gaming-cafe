import React from 'react';
import { X, Shield, FileText } from 'lucide-react';

interface LegalModalProps {
  type: 'privacy' | 'terms' | null;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ type, onClose }) => {
  if (!type) return null;

  const isPrivacy = type === 'privacy';
  const title = isPrivacy ? 'Privacy Policy' : 'Terms of Service';
  const Icon = isPrivacy ? Shield : FileText;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm select-none animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[85vh] overflow-hidden text-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-[#FFF7ED]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black font-display text-slate-900">{title}</h2>
              <p className="text-xs text-slate-500">Effective Date: October 2026</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 min-h-[44px] min-w-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-600 leading-relaxed font-sans">
          {isPrivacy ? (
            <>
              <h3 className="font-bold text-slate-900 text-sm">1. Information Collection & Use</h3>
              <p>
                Vanya Gaming Lounge collects minimal personal information necessary to deliver gaming sessions, seat allocations, and cafe orders. This includes your name, contact phone number, and optional session preferences.
              </p>

              <h3 className="font-bold text-slate-900 text-sm">2. Payments & Transaction Security</h3>
              <p>
                All digital transactions are processed using encrypted UPI and NPCI protocols. We never store debit/credit card numbers or banking passwords on our local servers.
              </p>

              <h3 className="font-bold text-slate-900 text-sm">3. Data Retention & Cookies</h3>
              <p>
                We use strictly functional storage (such as session tokens and display preferences) to maintain login states and prevent fraud. Anonymous operational telemetry is only initialized after explicit user consent.
              </p>

              <h3 className="font-bold text-slate-900 text-sm">4. Contact & Player Rights</h3>
              <p>
                Players can request verification or deletion of their guest records at any time by speaking to front-desk staff or emailing privacy@vanyagaming.com.
              </p>
            </>
          ) : (
            <>
              <h3 className="font-bold text-slate-900 text-sm">1. Gaming Station Guidelines</h3>
              <p>
                Players agree to handle consoles, controllers, VR headsets, and simulator steering rigs with reasonable care. Willful physical damage to equipment is subject to replacement repair assessments.
              </p>

              <h3 className="font-bold text-slate-900 text-sm">2. Billing & Grace Periods</h3>
              <p>
                Gaming sessions are billed based on pre-selected tiers or hourly durations. A 5-minute complimentary grace period is provided prior to the commencement of the subsequent billing cycle.
              </p>

              <h3 className="font-bold text-slate-900 text-sm">3. Code of Conduct</h3>
              <p>
                Respectful behavior towards fellow gamers and lounge staff is mandatory. Harassment, excessive disruption, or software tampering will result in session termination.
              </p>

              <h3 className="font-bold text-slate-900 text-sm">4. Food & Beverage Policy</h3>
              <p>
                Outside commercial food and beverages are not permitted inside active console and simulator pods. In-seat kitchen orders are delivered directly to your designated station.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="min-h-[44px] px-6 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
};
