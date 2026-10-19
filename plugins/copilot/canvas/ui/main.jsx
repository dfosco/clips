import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './theme.css';
const params = new URLSearchParams(location.search);
async function call(action, input = {}) {
  const response = await fetch(`/api/${encodeURIComponent(params.get('instanceId'))}?token=${encodeURIComponent(params.get('token'))}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, input }) });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `Clips request failed (${response.status}).`);
  return payload.result;
}
createRoot(document.getElementById('root')).render(<App call={call} />);
