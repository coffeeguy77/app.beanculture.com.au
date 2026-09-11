import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import StatsPage from './components/StatsPage.jsx';
import PosDisplay from './components/PosDisplay.jsx';
import './styles.css';
import './seasonal.css';

// Standalone routes render directly instead of booting the whole storefront:
//  /stats   — the organiser stats page
//  /display — the customer-facing display (a second screen mirroring the POS order)
const path = window.location.pathname.replace(/\/$/, '');
const isStats = path === '/stats';
const isDisplay = path === '/display';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isStats ? <StatsPage /> : isDisplay ? <PosDisplay /> : <App />}
  </React.StrictMode>
);

// Register the service worker (enables install / Add to Home Screen).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
