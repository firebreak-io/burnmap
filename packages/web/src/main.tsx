import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { sampleModel } from './sample-data';
import { markReady, readModel } from './ready';
import './theme.css';

const win = window as unknown as Record<string, unknown>;
const model = readModel(win, sampleModel);

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App model={model} />
    </ErrorBoundary>
  </StrictMode>,
);

// Signal readiness once fonts are loaded and two frames have painted, so a
// headless screenshot (Phase 3) captures the fully-settled layout.
const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => markReady(win)));
if (document.fonts?.ready) document.fonts.ready.then(settle);
else settle();
