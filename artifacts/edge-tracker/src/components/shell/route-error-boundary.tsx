import * as React from "react";
import { ErrorState } from "@/components/ds/states";

/**
 * Catches render errors inside one route so a broken section doesn't take the whole shell down.
 * `resetKey` (the current location) clears the error when the user navigates elsewhere.
 */
export class RouteErrorBoundary extends React.Component<
  { resetKey: string; children: React.ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[route]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-xl py-16">
        <ErrorState
          error={this.state.error}
          title="Раздел не загрузился"
          message="В этом разделе произошла ошибка. Остальное приложение работает."
          onRetry={() => this.setState({ error: null })}
        />
      </div>
    );
  }
}
