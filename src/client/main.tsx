import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { localizeAppErrorMessage } from "./lib/error-messages.js";
import "./styles.css";

const queryClient = new QueryClient();

type ErrorBoundaryState = { error: Error | null };

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      const localizedMessage = localizeAppErrorMessage(this.state.error.message) ?? this.state.error.message;
      return (
        <div style={{ padding: 24, color: "#ef4444", fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", maxWidth: 800 }}>
          <p style={{ fontWeight: 700 }}>发生错误：</p>
          <p>{localizedMessage}</p>
          <details>
            <summary style={{ cursor: "pointer", margin: "8px 0" }}>错误堆栈</summary>
            <pre style={{ fontSize: 11, overflow: "auto" }}>{this.state.error.stack}</pre>
          </details>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 8, padding: "6px 12px" }}>
            重试
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
