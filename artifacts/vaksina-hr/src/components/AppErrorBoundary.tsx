import React from "react";

type Props = { children: React.ReactNode };

type State = { error: Error | null; path: string };

/** Catch render crashes so we don't get a blank white screen. */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = {
    error: null,
    path: typeof window !== "undefined" ? window.location.pathname : "",
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate() {
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    if (this.state.error && path !== this.state.path) {
      this.setState({ error: null, path });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            background: "#fff",
            color: "#111",
          }}
        >
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>Sahifa xatosi</h1>
          <p style={{ marginBottom: 12, color: "#555" }}>
            Sahifa ochilmadi. Quyidagi xabar bilan admin/dasturchiga murojaat qiling yoki sahifani yangilang
            (Ctrl+Shift+R).
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "#f4f4f5",
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            style={{
              marginTop: 16,
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
            onClick={() => {
              this.setState({
                error: null,
                path: typeof window !== "undefined" ? window.location.pathname : "",
              });
              window.location.assign(window.location.href);
            }}
          >
            Qayta yuklash
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
