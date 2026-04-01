import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// Standalone mode: intercept /api/ calls and route to public APIs directly
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
if (!BACKEND_URL || process.env.REACT_APP_STANDALONE === 'true') {
  import('@/utils/standalone').then(({ installStandaloneMode }) => {
    installStandaloneMode();
  });
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register service worker for PWA update management
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      // Check for updates every 30 minutes
      setInterval(() => reg.update(), 30 * 60 * 1000);
    }).catch(() => {});
  });
}
