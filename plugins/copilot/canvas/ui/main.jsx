import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { PrimerTheme } from './primer-theme';
import './theme.css';
const params = new URLSearchParams(location.search);
async function call(action, input = {}) {
  let response;
  try {
    response = await fetch(`/api/${encodeURIComponent(params.get('instanceId'))}?token=${encodeURIComponent(params.get('token'))}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, input }), signal: AbortSignal.timeout(30000) });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('Clips did not respond within 30 seconds. Reload the canvas before retrying; an action may still have completed.');
    throw error;
  }
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `Clips request failed (${response.status}).`);
  return payload.result;
}
createRoot(document.getElementById('root')).render(<PrimerTheme><App call={call} /></PrimerTheme>);
