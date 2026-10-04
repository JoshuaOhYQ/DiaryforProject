import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { loadLock, restoreSession } from './app/auth.ts';
import { store } from './data/index.ts';
import { LoginPage } from './pages/LoginPage.tsx';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
const render = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

function start() {
  void store.init();
  render(<App />);
}

// A site built with LOGBOOK_PASSWORD asks for it before loading any data.
void (async () => {
  const lock = await loadLock();
  if (lock && !(await restoreSession(lock))) render(<LoginPage lock={lock} onUnlocked={start} />);
  else start();
})();
