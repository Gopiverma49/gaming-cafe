import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  level?: 'root' | 'view' | 'component';
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = '/';
  };

  toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { level = 'component', fallbackTitle } = this.props;
      const errorMessage = this.state.error?.message || 'An unexpected rendering error occurred.';
      const stackTrace = this.state.errorInfo?.componentStack || this.state.error?.stack || '';

      // Full Root Screen Error
      if (level === 'root') {
        return (
          <div className="min-h-screen bg-[#070b14] text-slate-100 flex items-center justify-center p-4 sm:p-6 select-none relative overflow-hidden">
            {/* Background subtle glow */}
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
            
            <div className="w-full max-w-xl bg-slate-900/90 backdrop-blur-2xl p-6 sm:p-8 rounded-3xl border border-rose-500/30 shadow-2xl space-y-6 relative z-10 text-center sm:text-left">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-black font-display text-white tracking-wide">
                    {fallbackTitle || 'Application Error Intercepted'}
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    An unhandled runtime error was prevented from causing a blank screen.
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs font-mono-code text-rose-300 break-words leading-relaxed text-left">
                <strong>Error:</strong> {errorMessage}
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-3 justify-center sm:justify-start">
                <button
                  onClick={this.handleReset}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Try Recovering View</span>
                </button>

                <button
                  onClick={this.handleReload}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-all border border-slate-700 flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reload Page</span>
                </button>

                <button
                  onClick={this.handleGoHome}
                  className="px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-all border border-slate-800 flex items-center gap-2"
                >
                  <Home className="w-3.5 h-3.5" />
                  <span>Return Home</span>
                </button>
              </div>

              {/* Expandable Technical Diagnostics */}
              {stackTrace && (
                <div className="pt-2 border-t border-slate-800/80 text-left">
                  <button
                    onClick={this.toggleDetails}
                    className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors font-mono-code"
                  >
                    <span>{this.state.showDetails ? 'Hide Diagnostics' : 'View Diagnostics'}</span>
                    {this.state.showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  {this.state.showDetails && (
                    <pre className="mt-2.5 p-3 rounded-xl bg-black/60 border border-slate-800 text-[10px] text-slate-400 font-mono-code overflow-x-auto max-h-48 overflow-y-auto leading-normal select-text">
                      {stackTrace}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      }

      // View or Component Level Inline Fallback (Leaves header & navigation functional)
      return (
        <div className="p-6 my-4 bg-slate-900/90 rounded-3xl border border-rose-500/30 text-slate-200 shadow-xl space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-rose-500/15 text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white font-display">
                  {fallbackTitle || 'This section encountered an issue'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  The rest of the dashboard remains operational.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={this.handleReset}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold font-mono-code border border-slate-700 flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs font-mono-code text-rose-300">
            {errorMessage}
          </div>

          {stackTrace && (
            <div>
              <button
                onClick={this.toggleDetails}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-300 font-mono-code"
              >
                <span>{this.state.showDetails ? 'Hide details' : 'Show details'}</span>
                {this.state.showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {this.state.showDetails && (
                <pre className="mt-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[10px] text-slate-400 font-mono-code overflow-x-auto max-h-36 overflow-y-auto select-text">
                  {stackTrace}
                </pre>
              )}
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
