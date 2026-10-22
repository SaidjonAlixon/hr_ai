import React from "react";
import { isChunkLoadError, reloadForFreshBuild } from "../lib/chunk-reload";

type Props = { children: React.ReactNode };

type State = { error: Error | null; path: string; recovering: boolean };

const RECOVER_KEY = "hr_ui_recover_ts";

function isTransientRenderError(error: Error): boolean {
  const msg = String(error?.message || "");
  return (
    /Cannot read properties of undefined \(reading 'icon'\)/i.test(msg) ||
    /Cannot read property 'icon' of undefined/i.test(msg) ||
    /is not a function/i.test(msg) ||
    /Minified React error/i.test(msg)
  );
}

function trySoftRecover(): boolean {
  try {
    const prev = Number(sessionStorage.getItem(RECOVER_KEY) || 0);
    const now = Date.now();
    // 15 soniyada 1 marta — loop bo‘lmasin
    if (now - prev < 15_000) return false;
    sessionStorage.setItem(RECOVER_KEY, String(now));
    const url = new URL(window.location.href);
    url.searchParams.set("_r", String(now % 1_000_000));
    window.location.replace(url.toString());
    return true;
  } catch {
    return false;
  }
}

/** Catch render crashes so we don't get a blank white screen. */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = {
    error: null,
    path: typeof window !== "undefined" ? window.location.pathname : "",
    recovering: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
    if (isChunkLoadError(error)) {
      reloadForFreshBuild();
      return;
    }
    if (isTransientRenderError(error) && trySoftRecover()) {
      this.setState({ recovering: true });
    }
  }

  componentDidUpdate() {
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    if (this.state.error && path !== this.state.path) {
      this.setState({ error: null, path, recovering: false });
    }
  }

  render() {
    if (this.state.recovering) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            fontFamily: "system-ui, sans-serif",
            color: "#555",
          }}
        >
          Sahifa yangilanmoqda…
        </div>
      );
    }

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
            Vaqtinchalik nosozlik. Sahifani yangilang yoki bosh sahifaga o‘ting.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "#f4f4f5",
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              maxHeight: 180,
              overflow: "auto",
            }}
          >
            {this.state.error.message}
          </pre>
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button
              type="button"
              style={{
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
                  recovering: false,
                });
                window.location.assign(window.location.pathname + window.location.search);
              }}
            >
              Qayta yuklash
            </button>
            <button
              type="button"
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #ccc",
                background: "#fff",
                color: "#111",
                cursor: "pointer",
              }}
              onClick={() => {
                window.location.assign("/");
              }}
            >
              Bosh sahifa
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
