import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  // Defensive fallback if root div is somehow missing
  const fallbackDiv = document.createElement('div');
  fallbackDiv.id = 'root';
  document.body.appendChild(fallbackDiv);
  ReactDOM.createRoot(fallbackDiv).render(
    <React.StrictMode>
      <ErrorBoundary level="root" fallbackTitle="Application Failed to Initialize">
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
} else {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary level="root" fallbackTitle="Application Intercepted an Error">
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
