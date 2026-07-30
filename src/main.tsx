import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ingestion/pdfWorker.ts'; // browser-only: point pdf.js at its bundled worker
import './styles.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
