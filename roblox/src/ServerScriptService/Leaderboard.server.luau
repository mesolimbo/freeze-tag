-- Fastest-catches leaderboard. A score is the time left on the clock when the last kid froze, so higher is faster.
-- Rounds run on each player's own device, so the server times them too and rejects a score the clock rules out.
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local shared = ReplicatedStorage:WaitForChild("FreezeTag")
local Config = require(shared.Config)
local remotes = shared.Remotes

local TOP_ROWS = 5
-- How far down the list to look for the player's own rank.
local RANK_DEPTH = 100
-- Allowance for the delay between the client's clock and ours.
local LATENCY_GRACE = 1.5
-- Scores are stored as whole milliseconds, because ordered data stores only hold integers.
local MILLIS = 1000

local store = DataStoreService:GetOrderedDataStore("FastestCatches")
local roundStartedAt: { [Player]: number } = {}
local usernames: { [number]: string } = {}

remotes.RoundStarted.OnServerEvent:Connect(function(player)
	roundStartedAt[player] = os.clock()
end)

Players.PlayerRemoving:Connect(function(player)
	roundStartedAt[player] = nil
end)

local function usernameOf(userId: number): string
	if not usernames[userId] then
		local ok, name = pcall(Players.GetNameFromUserIdAsync, Players, userId)
		usernames[userId] = if ok then name else "Player"
	end
	return usernames[userId]
end

local function isPlausible(player: Player, seconds: any): boolean
	local startedAt = roundStartedAt[player]
	if typeof(seconds) ~= "number" or seconds ~= seconds or not startedAt then
		return false
	end
	local longestPossible = Config.TIME_LIMIT - (os.clock() - startedAt) + LATENCY_GRACE
	return seconds > 0 and seconds <= Config.TIME_LIMIT and seconds <= longestPossible
end

local function readBoard(player: Player)
	local page = store:GetSortedAsync(false, RANK_DEPTH):GetCurrentPage()
	local board = { top = {}, me = nil }
	for rank, entry in page do
		local userId = tonumber(entry.key)
		local seconds = entry.value / MILLIS
		if rank <= TOP_ROWS then
			table.insert(board.top, { username = usernameOf(userId), seconds = seconds })
		end
		if userId == player.UserId then
			board.me = { rank = rank, seconds = seconds }
		end
	end
	if not board.me then
		local best = store:GetAsync(tostring(player.UserId))
		if best then
			board.me = { seconds = best / MILLIS }
		end
	end
	return board
end

-- action is "submit" (with the seconds left) after a win, or "load" after a loss. Returns nil if the store is unavailable.
remotes.Leaderboard.OnServerInvoke = function(player, action, seconds)
	local ok, result = pcall(function()
		if action == "submit" and isPlausible(player, seconds) then
			local score = math.round(seconds * MILLIS)
			store:UpdateAsync(tostring(player.UserId), function(best)
				return if best and best >= score then nil else score
			end)
		end
		roundStartedAt[player] = nil
		return readBoard(player)
	end)
	if not ok then
		warn("Leaderboard unavailable:", result)
		return nil
	end
	return result
end
