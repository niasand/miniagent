import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import "./styles.css";

const queryClient = new QueryClient();

type ErrorBoundaryState = { error: Error | null };

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: "#ef4444", fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", maxWidth: 800 }}>
          <p style={{ fontWeight: 700 }}>Something went wrong:</p>
          <p>{this.state.error.message}</p>
          <details>
            <summary style={{ cursor: "pointer", margin: "8px 0" }}>Stack trace</summary>
            <pre style={{ fontSize: 11, overflow: "auto" }}>{this.state.error.stack}</pre>
          </details>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 8, padding: "6px 12px" }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
