import { useEffect, useState } from 'react';
import { BaseStyles } from '@primer/react';
import { ThemeProvider } from '@primer/react/next';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';

export function hostColorMode() {
  for (const element of [document.documentElement, document.body]) {
    const mode = element?.getAttribute('data-color-mode');
    if (mode === 'light' || mode === 'day') return 'light';
    if (mode === 'dark' || mode === 'night') return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function PrimerTheme({ children }) {
  const [colorMode, setColorMode] = useState(hostColorMode);
  useEffect(() => {
    const update = () => setColorMode(hostColorMode());
    const observer = new MutationObserver(update);
    for (const element of [document.documentElement, document.body]) {
      if (element) observer.observe(element, { attributes: true, attributeFilter: ['data-color-mode'] });
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  }, []);
  // BaseStyles keeps Primer overlay portals inside the selected scheme.
  return <ThemeProvider colorMode={colorMode} dayScheme="light" nightScheme="dark">
    <BaseStyles className="clips-primer-root">{children}</BaseStyles>
  </ThemeProvider>;
}
