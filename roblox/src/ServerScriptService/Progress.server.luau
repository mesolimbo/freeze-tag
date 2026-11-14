-- Everything the game remembers about a player: stats, the freeze ring they picked, badges, and the fastest-catches
-- leaderboards. Rounds run on each player's own device, so the server times them too and ignores a result its own
-- clock rules out.
local BadgeService = game:GetService("BadgeService")
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local shared = ReplicatedStorage:WaitForChild("FreezeTag")
local Config = require(shared.Config)
local Rewards = require(shared.Rewards)
local remotes = shared.Remotes

local TOP_ROWS = 5
-- How far down a board to look for the player's own rank.
local RANK_DEPTH = 100
-- Sorted reads are tightly rationed, so each board is read at most this often and shared by everyone on the server.
local BOARD_REFRESH_SECONDS = 45
-- Allowance for the delay between the client's clock and ours.
local LATENCY_GRACE = 1.5
-- Scores are stored as whole milliseconds, because ordered data stores only hold integers.
local MILLIS = 1000
local WEEK_SECONDS = 7 * 24 * 60 * 60
-- 1 January 1970 was a Thursday; this shift makes weeks roll over on Monday at 00:00 UTC.
local MONDAY_OFFSET = 4 * 24 * 60 * 60
local ALL_TIME_BOARD = "FastestCatches"

local profileStore = DataStoreService:GetDataStore("PlayerProgress")

type Profile = {
	stats: Rewards.Stats,
	ring: string,
	badges: { [string]: boolean },
	week: number,
	weekBest: number,
	-- False when the saved data could not be read, so a default profile never overwrites real progress.
	canSave: boolean,
}

local profiles: { [Player]: Profile } = {}
local roundStartedAt: { [Player]: number } = {}
local usernames: { [number]: string } = {}
local boardCache: { [string]: { readAt: number, entries: { { userId: number, score: number } } } } = {}

local function currentWeek(): number
	return math.floor((os.time() - MONDAY_OFFSET) / WEEK_SECONDS)
end

local function weeklyBoard(): string
	return "FastestCatches_Week" .. currentWeek()
end

-- Profiles -------------------------------------------------------------------

local awardBadges

local function loadProfile(player: Player)
	local ok, saved = pcall(profileStore.GetAsync, profileStore, tostring(player.UserId))
	local profile: Profile = {
		stats = Rewards.newStats(),
		ring = Rewards.DEFAULT_RING,
		badges = {},
		week = currentWeek(),
		weekBest = 0,
		canSave = ok,
	}
	if ok and typeof(saved) == "table" then
		for key in profile.stats do
			if typeof(saved.stats) == "table" and typeof(saved.stats[key]) == "number" then
				profile.stats[key] = saved.stats[key]
			end
		end
		if typeof(saved.ring) == "string" and Rewards.ring(saved.ring) then
			profile.ring = saved.ring
		end
		if typeof(saved.badges) == "table" then
			profile.badges = saved.badges
		end
		if saved.week == profile.week and typeof(saved.weekBest) == "number" then
			profile.weekBest = saved.weekBest
		end
	elseif not ok then
		warn("Could not load progress for", player.Name, ":", saved)
	end
	if player.Parent then
		profiles[player] = profile
		-- Catches up on badges created after the player earned them.
		awardBadges(player, profile)
	end
end

local function saveProfile(player: Player)
	local profile = profiles[player]
	if not profile or not profile.canSave then
		return
	end
	local ok, problem = pcall(profileStore.SetAsync, profileStore, tostring(player.UserId), {
		stats = profile.stats,
		ring = profile.ring,
		badges = profile.badges,
		week = profile.week,
		weekBest = profile.weekBest,
	})
	if not ok then
		warn("Could not save progress for", player.Name, ":", problem)
	end
end

local function waitForProfile(player: Player): Profile?
	local deadline = os.clock() + 10
	while not profiles[player] and player.Parent and os.clock() < deadline do
		task.wait(0.1)
	end
	return profiles[player]
end

local function unlockedRings(stats: Rewards.Stats): { string }
	local ids = {}
	for _, ring in Rewards.RINGS do
		if ring.earned(stats) then
			table.insert(ids, ring.id)
		end
	end
	return ids
end

local function describe(profile: Profile)
	return { stats = profile.stats, rings = unlockedRings(profile.stats), ring = profile.ring }
end

function awardBadges(player: Player, profile: Profile)
	for _, badge in Rewards.BADGES do
		if badge.id ~= 0 and not profile.badges[badge.key] and badge.earned(profile.stats) then
			-- Marked first so a slow award is not started twice. AwardBadge does nothing if they already own it.
			profile.badges[badge.key] = true
			task.spawn(function()
				local ok, problem = pcall(BadgeService.AwardBadge, BadgeService, player.UserId, badge.id)
				if not ok then
					profile.badges[badge.key] = nil
					warn("Could not award badge", badge.key, ":", problem)
				end
			end)
		end
	end
end

-- Leaderboards ---------------------------------------------------------------

local function usernameOf(userId: number): string
	if not usernames[userId] then
		local ok, name = pcall(Players.GetNameFromUserIdAsync, Players, userId)
		usernames[userId] = if ok then name else "Player"
	end
	return usernames[userId]
end

-- The board's top entries, highest first, or nil if it has never been readable.
local function boardEntries(boardName: string)
	local cached = boardCache[boardName]
	if not cached or os.clock() - cached.readAt > BOARD_REFRESH_SECONDS then
		local ok, page = pcall(function()
			return DataStoreService:GetOrderedDataStore(boardName):GetSortedAsync(false, RANK_DEPTH):GetCurrentPage()
		end)
		if ok then
			local entries = {}
			for _, entry in page do
				table.insert(entries, { userId = tonumber(entry.key), score = entry.value })
			end
			-- Scores posted since the last read may be missing from the store's own ordering for a moment.
			if cached then
				for _, old in cached.entries do
					if os.clock() - (old.postedAt or 0) < BOARD_REFRESH_SECONDS then
						table.insert(entries, old)
					end
				end
			end
			cached = { readAt = os.clock(), entries = {} }
			boardCache[boardName] = cached
			for _, entry in entries do
				local existing = nil
				for _, kept in cached.entries do
					if kept.userId == entry.userId then
						existing = kept
					end
				end
				if not existing then
					table.insert(cached.entries, entry)
				elseif entry.score > existing.score then
					existing.score = entry.score
				end
			end
			table.sort(cached.entries, function(a, b)
				return a.score > b.score
			end)
		else
			warn("Leaderboard", boardName, "unavailable:", page)
		end
	end
	return if cached then cached.entries else nil
end

-- Writes a better score to the store and to the shared copy, so the player sees it at once.
local function postScore(boardName: string, userId: number, score: number)
	local ok, problem = pcall(function()
		DataStoreService:GetOrderedDataStore(boardName):UpdateAsync(tostring(userId), function(best)
			return if best and best >= score then nil else score
		end)
	end)
	if not ok then
		warn("Could not post score to", boardName, ":", problem)
		return
	end
	local entries = boardEntries(boardName)
	if not entries then
		return
	end
	local mine = nil
	for _, entry in entries do
		if entry.userId == userId then
			mine = entry
		end
	end
	if not mine then
		mine = { userId = userId, score = 0 }
		table.insert(entries, mine)
	end
	mine.score = math.max(mine.score, score)
	mine.postedAt = os.clock()
	table.sort(entries, function(a, b)
		return a.score > b.score
	end)
end

local function boardView(boardName: string, player: Player, bestSeconds: number)
	local entries = boardEntries(boardName)
	if not entries then
		return nil
	end
	local view = { top = {}, me = nil }
	for rank, entry in entries do
		if rank <= TOP_ROWS then
			table.insert(view.top, { username = usernameOf(entry.userId), seconds = entry.score / MILLIS })
		end
		if entry.userId == player.UserId and rank <= RANK_DEPTH then
			view.me = { rank = rank, seconds = entry.score / MILLIS }
		end
	end
	if not view.me and bestSeconds > 0 then
		view.me = { seconds = bestSeconds }
	end
	return view
end

-- Rounds ---------------------------------------------------------------------

local function isPlausibleWin(startedAt: number, seconds: any): boolean
	if typeof(seconds) ~= "number" or seconds ~= seconds then
		return false
	end
	local longestPossible = Config.TIME_LIMIT - (os.clock() - startedAt) + LATENCY_GRACE
	return seconds > 0 and seconds <= Config.TIME_LIMIT and seconds <= longestPossible
end

remotes.RoundStarted.OnServerEvent:Connect(function(player)
	roundStartedAt[player] = os.clock()
end)

remotes.Profile.OnServerInvoke = function(player)
	local profile = waitForProfile(player)
	return if profile then describe(profile) else nil
end

remotes.SelectRing.OnServerEvent:Connect(function(player, ringId)
	local profile = profiles[player]
	local ring = if typeof(ringId) == "string" then Rewards.ring(ringId) else nil
	if profile and ring and ring.earned(profile.stats) then
		profile.ring = ring.id
	end
end)

-- Called when a round ends, with whether it was won, the seconds left and how many kids were frozen.
-- Returns the updated profile, any rings this round unlocked, and both leaderboards (nil if they cannot be read).
remotes.RoundEnded.OnServerInvoke = function(player, won, seconds, kidsFrozen)
	local profile = waitForProfile(player)
	if not profile then
		return nil
	end
	local stats = profile.stats
	local startedAt = roundStartedAt[player]
	roundStartedAt[player] = nil
	local unlocked = {}

	if startedAt then
		local elapsed = os.clock() - startedAt
		local realWin = won == true and isPlausibleWin(startedAt, seconds)
		local realLoss = won ~= true and elapsed >= Config.TIME_LIMIT - LATENCY_GRACE
		if realWin or realLoss then
			local before = {}
			for _, id in unlockedRings(stats) do
				before[id] = true
			end

			local frozen = if realWin then #Config.KIDS else math.clamp(math.floor(tonumber(kidsFrozen) or 0), 0, #Config.KIDS - 1)
			stats.rounds += 1
			stats.kidsFrozen += frozen
			if profile.week ~= currentWeek() then
				profile.week = currentWeek()
				profile.weekBest = 0
			end
			if realWin then
				local score = math.round(seconds * MILLIS)
				stats.wins += 1
				stats.streak += 1
				stats.bestStreak = math.max(stats.bestStreak, stats.streak)
				if seconds > stats.bestSeconds then
					stats.bestSeconds = seconds
					postScore(ALL_TIME_BOARD, player.UserId, score)
				end
				if seconds > profile.weekBest then
					profile.weekBest = seconds
					postScore(weeklyBoard(), player.UserId, score)
				end
			else
				stats.streak = 0
			end

			for _, ring in Rewards.RINGS do
				if ring.earned(stats) and not before[ring.id] then
					table.insert(unlocked, ring.name)
				end
			end
			awardBadges(player, profile)
			task.spawn(saveProfile, player)
		end
	end

	local weekly = boardView(weeklyBoard(), player, profile.weekBest)
	local allTime = boardView(ALL_TIME_BOARD, player, stats.bestSeconds)
	return {
		profile = describe(profile),
		unlocked = unlocked,
		boards = if weekly and allTime then { weekly = weekly, allTime = allTime } else nil,
	}
end

Players.PlayerAdded:Connect(loadProfile)
for _, player in Players:GetPlayers() do
	task.spawn(loadProfile, player)
end

Players.PlayerRemoving:Connect(function(player)
	saveProfile(player)
	profiles[player] = nil
	roundStartedAt[player] = nil
end)

game:BindToClose(function()
	for _, player in Players:GetPlayers() do
		task.spawn(saveProfile, player)
	end
	task.wait(2)
end)
