-- What players earn: freeze-ring colours and badges, each tied to a milestone in their saved stats.
-- The server decides what is earned; the client reads the same rules to draw the ring picker.
local Rewards = {}

-- Seconds left on the clock that count as a quick win and as an exceptional one.
Rewards.QUICK_WIN_SECONDS = 4
Rewards.EXCEPTIONAL_WIN_SECONDS = 8
Rewards.STREAK_WINS = 3
Rewards.RING_KIDS = 25
Rewards.BADGE_KIDS = 100

export type Stats = {
	wins: number,
	rounds: number,
	bestSeconds: number,
	streak: number,
	bestStreak: number,
	kidsFrozen: number,
}

function Rewards.newStats(): Stats
	return { wins = 0, rounds = 0, bestSeconds = 0, streak = 0, bestStreak = 0, kidsFrozen = 0 }
end

local function always(): boolean
	return true
end

local function firstWin(stats: Stats): boolean
	return stats.wins >= 1
end

local function quickWin(stats: Stats): boolean
	return stats.bestSeconds >= Rewards.QUICK_WIN_SECONDS
end

local function exceptionalWin(stats: Stats): boolean
	return stats.bestSeconds >= Rewards.EXCEPTIONAL_WIN_SECONDS
end

local function winStreak(stats: Stats): boolean
	return stats.bestStreak >= Rewards.STREAK_WINS
end

Rewards.DEFAULT_RING = "ice"

-- In the order the picker shows them. `goal` completes the sentence "To unlock: ...".
Rewards.RINGS = {
	{ id = "ice", name = "Ice", color = Color3.fromRGB(56, 189, 248), goal = "", earned = always },
	{ id = "bubblegum", name = "Bubblegum", color = Color3.fromRGB(244, 114, 182), goal = "win a round", earned = firstWin },
	{
		id = "sunset",
		name = "Sunset",
		color = Color3.fromRGB(251, 146, 60),
		goal = string.format("freeze %d kids", Rewards.RING_KIDS),
		earned = function(stats: Stats): boolean
			return stats.kidsFrozen >= Rewards.RING_KIDS
		end,
	},
	{
		id = "gold",
		name = "Gold",
		color = Color3.fromRGB(250, 204, 21),
		goal = string.format("win with %d seconds to spare", Rewards.QUICK_WIN_SECONDS),
		earned = quickWin,
	},
	{
		id = "violet",
		name = "Violet",
		color = Color3.fromRGB(192, 132, 252),
		goal = string.format("win %d rounds in a row", Rewards.STREAK_WINS),
		earned = winStreak,
	},
	{
		id = "rainbow",
		name = "Rainbow",
		color = Color3.new(1, 1, 1),
		rainbow = true,
		goal = string.format("win with %d seconds to spare", Rewards.EXCEPTIONAL_WIN_SECONDS),
		earned = exceptionalWin,
	},
}

-- Badge ids come from the Creator Dashboard, where each badge's description quotes the same numbers as above.
-- A badge with id 0 is skipped.
Rewards.BADGES = {
	{ key = "firstFreezeOut", id = 2092791668873480, earned = firstWin },
	{ key = "coolCustomer", id = 3163016254691972, earned = quickWin },
	{ key = "absoluteZero", id = 153521912408112, earned = exceptionalWin },
	{ key = "coldStreak", id = 2052583161888697, earned = winStreak },
	{
		key = "deepFreeze",
		id = 2322020131668958,
		earned = function(stats: Stats): boolean
			return stats.kidsFrozen >= Rewards.BADGE_KIDS
		end,
	},
}

function Rewards.ring(id: string)
	for _, ring in Rewards.RINGS do
		if ring.id == id then
			return ring
		end
	end
	return nil
end

-- The colour a ring shows at a given time; only the rainbow ring changes.
function Rewards.colorAt(ring, now: number): Color3
	return if ring.rainbow then Color3.fromHSV(now * 0.25 % 1, 0.75, 1) else ring.color
end

return Rewards
