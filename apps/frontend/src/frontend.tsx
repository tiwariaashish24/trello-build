/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { createRoot } from "react-dom/client";

const elem = document.getElementById("root")!;
const root = import.meta.hot
  ? (import.meta.hot.data.root ??= createRoot(elem))
  : createRoot(elem);

async function startApp() {
  const response = await fetch("/env.json");
  if (!response.ok) {
    throw new Error(`Could not load frontend environment (${response.status})`);
  }

  window.__TRELLO_ENV__ = await response.json();
  const { App } = await import("./App");
  root.render(<App />);
}

void startApp().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Could not start the app";
  root.render(
    <main className="auth-shell">
      <section className="auth-card" role="alert">
        <h1>Could not start Trello Build</h1>
        <p className="muted">{message}</p>
        <p className="hint">
          Check the frontend server and its environment settings, then reload.
        </p>
      </section>
    </main>,
  );
});
