/**
 * Desktop Entry Point — Used ONLY by the Tauri desktop build.
 *
 * The Tauri build's webpack config points to this file instead of index.js.
 * The web app's index.js is never touched.
 *
 * This boots DesktopApp which uses NodeContext (Core Wallet RPC)
 * instead of AuthContext (WIF/login).
 */

import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import DesktopApp from "@/DesktopApp";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <DesktopApp />
  </React.StrictMode>,
);
