import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "../../shared/ui";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Pawchive interface error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-screen place-items-center bg-base px-6 text-center">
          <div className="max-w-md">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/10 text-red-400">
              <AlertTriangle className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-lg font-semibold text-ink">
              The interface hit an unexpected error
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {this.state.error.message}
            </p>
            <Button
              className="mt-5"
              variant="primary"
              onClick={() => window.location.reload()}
            >
              Reload Pawchive
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
