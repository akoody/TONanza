import { TonConnectUIProvider } from "@tonconnect/ui-react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import "./index.css";

const manifestUrl = "https://tonanza.online/tonconnect-manifest.json";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TonConnectUIProvider>
  </React.StrictMode>
);
