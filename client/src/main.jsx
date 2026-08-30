import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import StatsPage from './components/StatsPage.jsx';
import './styles.css';
import './seasonal.css';

// The organiser stats page is a standalone route — it needs none of the app's
// config/menu, so render it directly instead of booting the whole storefront.
const isStats = window.location.pathname.replace(/\/$/, '') === '/stats';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isStats ? <StatsPage /> : <App />}
  </React.StrictMode>
);

// Register the service worker (enables install / Add to Home Screen).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
