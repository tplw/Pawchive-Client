import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./app/App";
import { wireNavigation } from "./app/bootstrap/wireNavigation";
import { queryClient } from "./shared/lib/queryClient";
import "./styles/index.css";

declare global {
  interface Window {
    AndroidSplash?: { hide: () => void };
  }
}

wireNavigation();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

requestAnimationFrame(() => window.AndroidSplash?.hide());
