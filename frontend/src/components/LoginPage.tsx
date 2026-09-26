import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Gamepad2,
  UserPlus,
  Lock,
  User,
  Phone,
  Coffee,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { loginUserApi, registerCustomerApi } from '../api';
import { GamingCafeCanvas } from './GamingCafeCanvas';

type AuthMode = 'CUSTOMER_LOGIN' | 'CUSTOMER_REGISTER' | 'ADMIN_LOGIN';

export const LoginPage: React.FC = () => {
  const { currentPortal, setPortal, setAuth } = useAuthStore();
  const [mode, setMode] = useState<AuthMode>(
    currentPortal === 'admin' ? 'ADMIN_LOGIN' : 'CUSTOMER_LOGIN'
  );

  useEffect(() => {
    setMode(currentPortal === 'admin' ? 'ADMIN_LOGIN' : 'CUSTOMER_LOGIN');
    setErrorMessage(null);
  }, [currentPortal]);

  // Customer Login State
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register State
  const [regFullName, setRegFullName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Admin Login State
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCustomerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const id = loginIdentifier.trim();
    if (!id) {
      setErrorMessage('Please enter your Phone number or Name.');
      return;
    }

    if (!loginPassword) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await loginUserApi({ identifier: id, password: loginPassword });
      setAuth(res.user, res.access_token, 'customer');
    } catch (err: any) {
      setErrorMessage(err.message || 'Login failed. Please check credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCustomerRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const name = regFullName.trim();
    const phone = regPhone.trim();
    const password = regPassword;

    // 1. Full Name: at least 2 and at most 30 characters
    if (name.length < 2 || name.length > 30) {
      setErrorMessage('Full Name must be between 2 and 30 characters.');
      return;
    }

    // 2. Phone Number: strictly 10 digits
    if (!/^\d{10}$/.test(phone)) {
      setErrorMessage('Phone number must be exactly 10 digits (numbers only).');
      return;
    }

    // 3. Password: at least 4 characters
    if (password.length < 4) {
      setErrorMessage('Password must be at least 4 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await registerCustomerApi({ name, phone, password });
      setAuth(res.user, res.access_token, 'customer');
    } catch (err: any) {
      setErrorMessage(err.message || 'Registration failed. Phone may already be registered.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const user = adminUsername.trim();
    if (!user) {
      setErrorMessage('Please enter Admin ID.');
      return;
    }

    if (!adminPassword) {
      setErrorMessage('Please enter password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await loginUserApi({ identifier: user, password: adminPassword });
      if (!res.user || res.user.role?.toLowerCase() !== 'admin') {
        throw new Error('Access denied: Customer account cannot access Staff Operations Console. Administrator credentials required.');
      }
      setAuth(res.user, res.access_token, 'admin');
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid administrator credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fdfbf7] via-[#f5f8ff] to-[#fef6ee] dark:from-[#070b14] dark:via-[#090f1d] dark:to-[#080d1a] text-slate-800 dark:text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden transition-colors duration-500">
      {/* Interactive Gaming & Cafe Ambient Canvas */}
      <GamingCafeCanvas isLight={false} />

      {/* Soft Ambient Pastel Glows */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-blue-400/15 dark:bg-blue-600/10 rounded-full blur-[110px] pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-amber-400/20 dark:bg-amber-600/10 rounded-full blur-[110px] pointer-events-none animate-pulse" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-rose-400/10 dark:bg-purple-900/10 rounded-full blur-[130px] pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-md relative z-10 space-y-5">
        {/* Brand Header & Portal Info */}
        <div className="text-center space-y-2">
          {/* Dual Category Badges */}
          <div className="flex items-center justify-center gap-2 mb-2 flex-wrap">
            {currentPortal === 'admin' ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-400 text-xs font-bold tracking-wide shadow-sm">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
                Staff Operations Portal
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-700 dark:text-blue-400 text-xs font-bold tracking-wide shadow-sm">
                  <Gamepad2 className="w-3.5 h-3.5" />
                  PS5 4K Gaming Lounge
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-400 text-xs font-bold tracking-wide shadow-sm">
                  <Coffee className="w-3.5 h-3.5" />
                  Artisan Cafe & Bites
                </span>
              </>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-black tracking-wider font-display text-slate-900 dark:text-white">
            {currentPortal === 'admin' ? 'ADMIN OPERATIONS' : 'VANYA GAMING & CAFE'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium">
            {currentPortal === 'admin'
              ? 'Console Fleet Control • Real-Time KDS • Financial Ledger'
              : 'Immersive PlayStation 5 Rigs • Gourmet Burgers • Cold Brews'}
          </p>
        </div>

        {/* Card Container */}
        <div className="bg-white/90 dark:bg-slate-900/85 backdrop-blur-2xl p-6 sm:p-8 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-[0_20px_50px_-10px_rgba(30,41,59,0.08)] dark:shadow-2xl relative">
          {errorMessage && (
            <div className="mb-5 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-600/60 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* ========================================================================= */}
          {/* MODE 1: CUSTOMER LOGIN (DEFAULT) */}
          {/* ========================================================================= */}
          {mode === 'CUSTOMER_LOGIN' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <Gamepad2 className="w-4 h-4" />
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white font-display">
                    Player Sign In
                  </h2>
                </div>
              </div>

              <form onSubmit={handleCustomerLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Phone Number or Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="e.g. 9876543210 or Alex Mercer"
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-colors"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Password / PIN
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-2.5 bg-slate-50/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-colors"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-amber-500 hover:from-blue-500 hover:to-amber-400 text-white font-bold text-xs sm:text-sm rounded-xl uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Gamepad2 className="w-4 h-4" />
                  <span>{isSubmitting ? 'Verifying...' : 'Enter Lounge, Play & Order'}</span>
                </button>
              </form>

              {/* Options Below Login Box */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5 text-center">
                <div className="flex items-center justify-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>First time visiting?</span>
                  <button
                    onClick={() => {
                      setMode('CUSTOMER_REGISTER');
                      setErrorMessage(null);
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-bold transition-colors"
                  >
                    Create player profile
                  </button>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPortal('admin');
                      setErrorMessage(null);
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-500" />
                    <span>Staff Operations Login →</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* MODE 2: CREATE NEW ACCOUNT (CUSTOMER REGISTRATION) */}
          {/* ========================================================================= */}
          {mode === 'CUSTOMER_REGISTER' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white font-display">
                    Create Player Profile
                  </h2>
                </div>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800/60 font-mono-code font-bold">
                  New Player
                </span>
              </div>

              <form onSubmit={handleCustomerRegister} className="space-y-3.5">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Full Name
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono-code">
                      4–15 chars ({regFullName.length}/15)
                    </span>
                  </div>
                  <input
                    type="text"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value.slice(0, 15))}
                    minLength={4}
                    maxLength={15}
                    placeholder="e.g. Alex (4–15 characters)"
                    className="w-full px-3.5 py-2.5 bg-slate-50/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-colors"
                    required
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Phone Number
                    </label>
                    <span className={`text-[10px] font-mono-code ${regPhone.length === 10 ? 'text-emerald-500 font-bold' : 'text-slate-400'}`}>
                      {regPhone.length}/10 digits
                    </span>
                  </div>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      pattern="[0-9]{10}"
                      maxLength={10}
                      placeholder="10-digit mobile number (e.g. 9876543210)"
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-colors"
                      required
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Create Password / PIN
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono-code">
                      4–15 chars ({regPassword.length}/15)
                    </span>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value.slice(0, 15))}
                      minLength={4}
                      maxLength={15}
                      placeholder="4 to 15 characters"
                      className="w-full pl-10 pr-10 py-2.5 bg-slate-50/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-colors"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-amber-500 hover:from-blue-500 hover:to-amber-400 text-white font-bold text-xs sm:text-sm rounded-xl uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{isSubmitting ? 'Registering Account...' : 'Join Lounge & Start Gaming'}</span>
                </button>
              </form>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2 text-center text-xs">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Already registered? </span>
                  <button
                    onClick={() => {
                      setMode('CUSTOMER_LOGIN');
                      setErrorMessage(null);
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-bold transition-colors"
                  >
                    Sign in to your account
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* MODE 3: ADMIN LOGIN */}
          {/* ========================================================================= */}
          {mode === 'ADMIN_LOGIN' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white font-display">
                    Admin Login
                  </h2>
                </div>
              </div>

              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Operator Username
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      placeholder="admin"
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-500 font-mono-code"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Passcode
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-2.5 bg-slate-50/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-amber-500 font-mono-code"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-xs sm:text-sm rounded-xl uppercase tracking-wider transition-all shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isSubmitting ? 'Authenticating...' : 'Login'}</span>
                </button>
              </form>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setPortal('customer');
                    setErrorMessage(null);
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  <Gamepad2 className="w-3.5 h-3.5 text-blue-500" />
                  <span>← Back to Customer Sign In</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
