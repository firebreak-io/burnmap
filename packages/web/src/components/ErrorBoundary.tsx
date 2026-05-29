import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

/**
 * Catches render errors (e.g. a malformed injected model) and shows a visible
 * error card instead of an empty crash. This keeps the DOM stable so the
 * screenshot harness captures something and the READY signal still fires.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console for debugging; render path already handled.
    console.error('burnmap render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="wrap">
          <div className="card">
            <div className="body">
              <p className="reason">burnmap failed to render this plan: {this.state.error.message}</p>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
