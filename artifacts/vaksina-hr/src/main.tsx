import { createRoot } from 'react-dom/client';

import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';

import './index.css';
import { registerPushServiceWorker } from './lib/web-push-client';
import { installDeviceSecurityFetchGuard } from './lib/device-security-guard';
import { installChunkReload } from './lib/chunk-reload';
import { installDomMutationGuard } from './lib/dom-mutation-guard';

installChunkReload();
installDeviceSecurityFetchGuard();
installDomMutationGuard();

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

void registerPushServiceWorker();
