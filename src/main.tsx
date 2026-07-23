import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PulseGuardApp from './PulseGuardApp';
import { I18nProvider } from './i18n/I18nContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <PulseGuardApp />
    </I18nProvider>
  </StrictMode>,
);
