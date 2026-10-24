import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { i18n } from "./i18n";
import { setupLanguage } from "./i18n/language";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles/tokens.css";
import "./index.css";
import "./styles/redesign.css";

// El idioma se fija antes del primer pintado: si no es el español, primero se
// descargan sus textos.
void setupLanguage().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nextProvider>
    </StrictMode>,
  );
});
