import {Hono} from 'hono';
import {context, redis} from '@devvit/web/server';
import type {LeaderboardData} from '../../shared/api';

export const api = new Hono();

const BOARD_KEY = 'leaderboard:seconds-left';
const TOP_COUNT = 10;
/** The game's longest configurable round. A win cannot leave more time than this. */
const MAX_SECONDS = 40;

async function readBoard(username: string | undefined): Promise<LeaderboardData> {
  const rows = await redis.zRange(BOARD_KEY, 0, TOP_COUNT - 1, {by: 'rank', reverse: true});
  const data: LeaderboardData = {top: rows.map((row) => ({username: row.member, seconds: row.score}))};
  if (!username) return data;

  const [seconds, ascendingRank, total] = await Promise.all([
    redis.zScore(BOARD_KEY, username),
    redis.zRank(BOARD_KEY, username),
    redis.zCard(BOARD_KEY),
  ]);
  if (seconds !== undefined && ascendingRank !== undefined) data.me = {rank: total - ascendingRank, seconds};
  return data;
}

api.get('/leaderboard', async (c) => c.json<LeaderboardData>(await readBoard(context.username)));

// Only a player's best win counts. The score is the time left on the clock, so higher is faster.
api.post('/score', async (c) => {
  const {username} = context;
  const body = await c.req.json<{secondsLeft?: unknown}>().catch(() => ({}) as {secondsLeft?: unknown});
  const {secondsLeft} = body;

  if (username && typeof secondsLeft === 'number' && Number.isFinite(secondsLeft) && secondsLeft > 0 && secondsLeft <= MAX_SECONDS) {
    const seconds = Math.round(secondsLeft * 10) / 10;
    const best = await redis.zScore(BOARD_KEY, username);
    if (best === undefined || seconds > best) await redis.zAdd(BOARD_KEY, {member: username, score: seconds});
  }
  return c.json<LeaderboardData>(await readBoard(username));
});
