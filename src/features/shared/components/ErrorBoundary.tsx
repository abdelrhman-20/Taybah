import { Component, type ErrorInfo, type ReactNode } from 'react';

// GENERIC RECOVERY BOUNDARY — catches a render/commit error anywhere in its
// subtree so one broken page never blanks the whole app. Used once around
// the Storefront <Outlet/>, once around the Admin <Outlet/> (so the
// surrounding header/nav/sidebar survive a page-level crash and stay usable
// for recovery), and once at the very root as a last-resort catch-all.
//
// Must be a class component — React has no hook equivalent for
// getDerivedStateFromError/componentDidCatch.
interface ErrorBoundaryProps {
  children: ReactNode;
  title: string;
  body: string;
  retryLabel: string;
  recoveryLabel?: string;
  recoveryHref?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Diagnostic only — logged to the console, never sent anywhere (no
    // backend exists yet) and never includes customer/order data, only the
    // error itself and the React component stack.
    console.error('[ErrorBoundary] Unhandled render error:', error, info.componentStack);
  }

  // Lets the customer try again without a full reload for a transient
  // failure. If the same state reliably throws, this is a no-op from their
  // point of view — they still have the hard-navigation recovery link below.
  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 py-16 text-center"
      >
        <h2 className="font-display text-xl text-espresso">{this.props.title}</h2>
        <p className="max-w-md text-sm leading-relaxed text-espresso/60">{this.props.body}</p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={this.retry}
            className="rounded-[27px] bg-burgundy px-6 py-2.5 text-sm font-medium text-white transition hover:bg-burgundy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {this.props.retryLabel}
          </button>
          {this.props.recoveryHref && this.props.recoveryLabel && (
            // Plain <a>, not <Link> — a hard navigation forces a full reload,
            // which clears whatever in-memory state may have caused the
            // crash. A client-side route change could re-render the same
            // broken state.
            <a
              href={this.props.recoveryHref}
              className="text-sm font-medium text-burgundy underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              {this.props.recoveryLabel}
            </a>
          )}
        </div>
      </div>
    );
  }
}
