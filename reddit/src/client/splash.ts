import {requestExpandedMode} from '@devvit/web/client';

document.getElementById('play')?.addEventListener('click', (event) => {
  requestExpandedMode(event, 'game');
});
