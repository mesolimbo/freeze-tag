import './game.css';
import {createRoot} from 'react-dom/client';
import App from '../../../game/src/App';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <div style={{position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden'}}>
    <App />
  </div>,
);
