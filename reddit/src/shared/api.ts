export type LeaderboardEntry = {username: string; seconds: number};

/** `me` is absent for players who have no recorded win yet. */
export type LeaderboardData = {
  top: LeaderboardEntry[];
  me?: {rank: number; seconds: number};
};
