import './game.css';
import {createRoot} from 'react-dom/client';
import App from '../../../game/src/App';
import type {LeaderboardApi} from '../../../game/src/types';
import type {LeaderboardData} from '../shared/api';

async function request(path: string, body?: unknown): Promise<LeaderboardData> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}),
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return response.json();
}

const leaderboard: LeaderboardApi = {
  submit: (secondsLeft) => request('/api/score', {secondsLeft}),
  load: () => request('/api/leaderboard'),
};

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <div style={{position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden'}}>
    <App leaderboard={leaderboard} />
  </div>,
);
