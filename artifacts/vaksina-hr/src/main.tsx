import { createRoot } from 'react-dom/client';

import App from './App';

import './index.css';
import { registerPushServiceWorker } from './lib/web-push-client';

createRoot(document.getElementById('root')!).render(<App />);

void registerPushServiceWorker();
