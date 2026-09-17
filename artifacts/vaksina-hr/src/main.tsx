import { createRoot } from 'react-dom/client';

import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';

import './index.css';
import { registerPushServiceWorker } from './lib/web-push-client';
import { installDeviceSecurityFetchGuard } from './lib/device-security-guard';

installDeviceSecurityFetchGuard();

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

void registerPushServiceWorker();
