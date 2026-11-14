-- Park Freeze Tag: you are "it". You never stop running, and the Shift keys are the only way to steer.
-- Each player runs their own round on their own screen; the server keeps their progress and the leaderboards.
local ContentProvider = game:GetService("ContentProvider")
local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SocialService = game:GetService("SocialService")
local SoundService = game:GetService("SoundService")
local StarterGui = game:GetService("StarterGui")
local UserInputService = game:GetService("UserInputService")

local shared = ReplicatedStorage:WaitForChild("FreezeTag")
local Config = require(shared:WaitForChild("Config"))
local Sim = require(shared:WaitForChild("Sim"))
local KidView = require(shared:WaitForChild("KidView"))
local Hud = require(shared:WaitForChild("Hud"))
local Rewards = require(shared:WaitForChild("Rewards"))
local remotes = shared:WaitForChild("Remotes")

local S = Config.STUDS_PER_METRE
local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

-- After a round ends, ignore input this long so a key still held from play does not skip the result.
local RESTART_DELAY = 0.9
-- How quickly the turn speed follows the keys (per second): about 0.1 s to get most of the way there.
local TURN_RESPONSE = 10
-- Camera roll (radians) at full turn speed.
local TURN_BANK = 0.05
local CAMERA_PITCH = -0.06
-- How quickly a kid's velocity follows its chosen heading (per second).
local STEER_RATE = 10
local PLAYER_RADIUS = 0.55
local KID_RADIUS = 0.45
local FROZEN_RADIUS = 1.15
local FLEE_DISTANCE = 9.5
local RING_SEGMENTS = 32
local POLLEN_COUNT = 75

local SFX_ID = "rbxassetid://135379723884642"
-- All effects share one audio file; these are each one's start and end in seconds.
local SFX_REGIONS = {
	footstep = NumberRange.new(0.250, 0.340),
	freeze = NumberRange.new(0.590, 0.990),
	victory = NumberRange.new(1.240, 2.440),
	defeat = NumberRange.new(2.690, 3.490),
}
-- The file was normalised 2.347 times louder than the web game plays these.
local SFX_VOLUME = Config.SFX_VOLUME / 2.347

local isTouch = UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled
local hud = Hud.new(player:WaitForChild("PlayerGui"), isTouch)

for _, coreGui in { Enum.CoreGuiType.Backpack, Enum.CoreGuiType.Health, Enum.CoreGuiType.PlayerList, Enum.CoreGuiType.EmotesMenu } do
	StarterGui:SetCoreGuiEnabled(coreGui, false)
end
-- There is no avatar to move, so Roblox's thumbstick and jump button would only get in the way of steering taps.
GuiService.TouchControlsEnabled = false

-- Friends -----------------------------------------------------------------------

local inviteOptions = Instance.new("ExperienceInviteOptions")
inviteOptions.PromptMessage = "Challenge a friend to beat your time"
hud.onInviteClicked = function()
	pcall(function()
		SocialService:PromptGameInvite(player, inviteOptions)
	end)
end
task.spawn(function()
	local ok, allowed = pcall(function()
		return SocialService:CanSendGameInviteAsync(player)
	end)
	hud:setInviteAvailable(ok and allowed == true)
end)

-- Sound ---------------------------------------------------------------------

local music = shared.Assets.Music:Clone()
music.Volume = Config.MUSIC_VOLUME
music.Looped = true
music.PlaybackRegionsEnabled = true
music.LoopRegion = NumberRange.new(Config.MUSIC_LOOP.lead, Config.MUSIC_LOOP.lead + Config.MUSIC_LOOP.length)
music.Parent = SoundService

local sounds = {}
for name, region in SFX_REGIONS do
	local sound = Instance.new("Sound")
	sound.Name = name
	sound.SoundId = SFX_ID
	sound.Volume = SFX_VOLUME
	sound.PlaybackRegionsEnabled = true
	sound.PlaybackRegion = region
	sound.Parent = SoundService
	sounds[name] = sound
end

local function playSound(name: string)
	local sound = sounds[name]
	-- A small random pitch change so rapid-fire sounds do not feel robotic.
	sound.PlaybackSpeed = 0.95 + math.random() * 0.1
	sound:Play()
end

local musicMuted = false
hud.onMuteToggled = function()
	musicMuted = not musicMuted
	music.Volume = if musicMuted then 0 else Config.MUSIC_VOLUME
	hud:setMuted(musicMuted)
end

-- Scene dressing --------------------------------------------------------------

local effects = Instance.new("Folder")
effects.Name = "FreezeTagEffects"
effects.Parent = workspace

local function effectPart(properties: { [string]: any }): Part
	local part = Instance.new("Part")
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	part.Material = Enum.Material.Neon
	for key, value in properties do
		part[key] = value
	end
	part.Parent = effects
	return part
end

-- The freeze ring on the ground around the chaser.
local ringRadius = Config.FREEZE_RADIUS * 0.95 * S
local ringSegments = {}
for i = 1, RING_SEGMENTS do
	ringSegments[i] = effectPart({
		Name = "FreezeRing",
		Color = Color3.fromRGB(56, 189, 248),
		Transparency = 0.3,
		Size = Vector3.new(2 * math.pi * ringRadius / RING_SEGMENTS * 1.05, 0.08, Config.FREEZE_RADIUS * 0.1 * S),
	})
end
local ringCFrames = table.create(RING_SEGMENTS)

-- Pollen drifting in the air.
local pollen, pollenParts, pollenCFrames = {}, {}, table.create(POLLEN_COUNT)
for i = 1, POLLEN_COUNT do
	pollen[i] = {
		x = (math.random() - 0.5) * 44,
		y = 0.5 + math.random() * 6,
		z = (math.random() - 0.5) * 44,
		speed = 0.3 + math.random() * 0.5,
		phase = math.random() * math.pi * 2,
	}
	pollenParts[i] = effectPart({
		Name = "Pollen",
		Shape = Enum.PartType.Ball,
		Color = Color3.new(1, 1, 1),
		Transparency = 0.4,
		Size = Vector3.one * 0.12 * S,
	})
end

-- Game state ------------------------------------------------------------------

type Status = "READY" | "PLAYING" | "CAUGHT_ALL" | "TIME_UP"

local status: Status = "READY"
local ready = false
local started = false
local roundStartedAt = 0
local endedAt = 0
local timeRemaining = Config.TIME_LIMIT
local roundNumber = 0
local stepTimer = 0
local turnVelocity = 0
local chaser = { x = 0, z = 0, yaw = 0 }

-- A random park corner, facing one of the two neighbouring corners.
local function placeChaserInCorner()
	local x = (if math.random() < 0.5 then -1 else 1) * Config.SPAWN_INSET
	local z = (if math.random() < 0.5 then -1 else 1) * Config.SPAWN_INSET
	local alongX = math.random() < 0.5
	local dx = if alongX then -2 * x else 0
	local dz = if alongX then 0 else -2 * z
	chaser.x, chaser.z = x, z
	-- Forward is (-sin yaw, -cos yaw), so this yaw points at the chosen corner.
	chaser.yaw = math.atan2(-dx, -dz)
end
placeChaserInCorner()

local kids = {}
for index, data in Config.KIDS do
	kids[index] = {
		data = data,
		view = KidView.new(data.name, effects),
		x = data.x,
		z = data.z,
		vx = 0,
		vz = 0,
		rotY = 0,
		frozen = false,
		wanderAngle = math.random() * math.pi * 2,
		wanderTimer = 0,
	}
end

-- The freeze ring the player picked: its colour shows on the ring and tints the ice.
local ring = Rewards.ring(Rewards.DEFAULT_RING)

local function useRing(ringId: string)
	ring = Rewards.ring(ringId) or ring
	for _, segment in ringSegments do
		segment.Color = ring.color
	end
	for _, kid in kids do
		kid.view:setIceColor(ring.color)
	end
end

hud.onRingSelected = function(ringId: string)
	useRing(ringId)
	remotes.SelectRing:FireServer(ringId)
end

task.spawn(function()
	local ok, profile = pcall(function()
		return remotes.Profile:InvokeServer()
	end)
	if ok and profile then
		hud:setProfile(profile)
		useRing(profile.ring)
	end
end)

local function kidsLeft(): number
	local count = 0
	for _, kid in kids do
		if not kid.frozen then
			count += 1
		end
	end
	return count
end

local function secondsLeftNow(): number
	return math.max(0, Config.TIME_LIMIT - (os.clock() - roundStartedAt))
end

local function startRound()
	roundNumber += 1
	placeChaserInCorner()
	for _, kid in kids do
		kid.x, kid.z = kid.data.x, kid.data.z
		kid.vx, kid.vz = 0, 0
		kid.frozen = false
		kid.view:setFrozen(false)
	end
	turnVelocity = 0
	roundStartedAt = os.clock()
	timeRemaining = Config.TIME_LIMIT
	status = "PLAYING"
	hud:hideResult()
	remotes.RoundStarted:FireServer()
end

local function endRound(result: Status)
	-- The last catch and the clock running out can land on the same frame; the first one decides the round.
	if status ~= "PLAYING" then
		return
	end
	status = result
	endedAt = os.clock()
	local won = result == "CAUGHT_ALL"
	timeRemaining = if won then secondsLeftNow() else 0
	playSound(if won then "victory" else "defeat")
	hud:showResult(won, timeRemaining)
	hud:setBoards(nil)

	local round, seconds, frozen = roundNumber, timeRemaining, #kids - kidsLeft()
	task.spawn(function()
		local ok, outcome = pcall(function()
			return remotes.RoundEnded:InvokeServer(won, seconds, frozen)
		end)
		if not (ok and outcome) then
			hud:hideBoards()
			return
		end
		hud:setProfile(outcome.profile)
		if round == roundNumber and status ~= "PLAYING" then
			hud:showUnlocks(outcome.unlocked)
			if outcome.boards then
				hud:setBoards(outcome.boards)
			else
				hud:hideBoards()
			end
		end
	end)
end

-- Space, a click or a tap fades the splash out, and the clock starts the moment it is gone.
local function leaveSplash()
	if started or not ready then
		return
	end
	started = true
	music:Play()
	hud:leaveSplash(startRound)
end
hud.onSplashClicked = leaveSplash

local function roundOverAndSettled(): boolean
	return (status == "CAUGHT_ALL" or status == "TIME_UP") and os.clock() - endedAt > RESTART_DELAY
end

-- A tap or click on the result screen, anywhere but the menus, plays again.
hud.onResultTapped = function()
	if roundOverAndSettled() then
		startRound()
	end
end

-- Input -----------------------------------------------------------------------

-- Sides currently held, most recent last. The most recent one steers, so a quick left-to-right switch never cancels out.
local held: { string } = {}
local keysDown = { left = false, right = false }
local touches: { [InputObject]: string } = {}
local SHIFT_SIDE = { [Enum.KeyCode.LeftShift] = "left", [Enum.KeyCode.RightShift] = "right" }
local SHIFT_KEY = { left = Enum.KeyCode.LeftShift, right = Enum.KeyCode.RightShift }

local function touchHolds(side: string): boolean
	for _, touchSide in touches do
		if touchSide == side then
			return true
		end
	end
	return false
end

local function refreshHeld(latest: string?)
	local nextHeld = {}
	for _, side in held do
		if side ~= latest and (keysDown[side] or touchHolds(side)) then
			table.insert(nextHeld, side)
		end
	end
	if latest then
		table.insert(nextHeld, latest)
	end
	held = nextHeld
	hud:setPressed(table.find(held, "left") ~= nil, table.find(held, "right") ~= nil)
end

UserInputService.InputBegan:Connect(function(input, processed)
	if input.UserInputType == Enum.UserInputType.Keyboard then
		local side = SHIFT_SIDE[input.KeyCode]
		if side then
			keysDown[side] = true
			refreshHeld(side)
		end
		if processed or not ready then
			return
		end
		if not started then
			if input.KeyCode == Enum.KeyCode.Space then
				leaveSplash()
			end
		elseif roundOverAndSettled() then
			startRound()
		end
	elseif input.UserInputType == Enum.UserInputType.Touch and not processed then
		-- A finger on either half of the screen acts as that side's Shift key.
		local side = if input.Position.X < camera.ViewportSize.X / 2 then "left" else "right"
		touches[input] = side
		refreshHeld(side)
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if SHIFT_SIDE[input.KeyCode] then
		-- Windows can skip the key-up for the first Shift released while the other is held, so ask which are still down.
		for side, key in SHIFT_KEY do
			keysDown[side] = UserInputService:IsKeyDown(key)
		end
		refreshHeld()
	elseif touches[input] then
		touches[input] = nil
		refreshHeld()
	end
end)

-- A system dialog (such as the Sticky Keys prompt after five Shift taps) can swallow the key-up.
UserInputService.WindowFocusReleased:Connect(function()
	keysDown.left, keysDown.right = false, false
	table.clear(touches)
	refreshHeld()
end)

-- Simulation ------------------------------------------------------------------

local function freezeKid(kid)
	if kid.frozen then
		return
	end
	kid.frozen = true
	kid.view:setFrozen(true)
	playSound("freeze")
	if kidsLeft() == 0 then
		endRound("CAUGHT_ALL")
	end
end

local function stepChaser(dt: number)
	local turnRate = Config.PLAYER_TURN_RATE
	local steering = held[#held]
	local turnInput = if steering == "left" then 1 elseif steering == "right" then -1 else 0

	-- Ease into and out of turns instead of snapping to full speed, which reads as a jolt on every tap.
	turnVelocity += (turnInput * turnRate - turnVelocity) * (1 - math.exp(-TURN_RESPONSE * dt))
	chaser.yaw += turnVelocity * dt

	local x = chaser.x - math.sin(chaser.yaw) * Config.PLAYER_SPEED * dt
	local z = chaser.z - math.cos(chaser.yaw) * Config.PLAYER_SPEED * dt

	stepTimer += dt * 2.2
	if stepTimer >= 1 then
		stepTimer = 0
		playSound("footstep")
	end

	-- The chaser cannot run through kids or frozen statues.
	for _, kid in kids do
		local dx, dz = x - kid.x, z - kid.z
		local distSq = dx * dx + dz * dz
		local minDist = if kid.frozen then FROZEN_RADIUS else PLAYER_RADIUS + KID_RADIUS
		if distSq < minDist * minDist then
			local dist = math.max(math.sqrt(distSq), 0.001)
			x += dx / dist * (minDist - dist)
			z += dz / dist * (minDist - dist)
		end
	end

	x, z = Sim.resolveObstacles(x, z, PLAYER_RADIUS)
	local bound = Config.HALF_PARK - 1.2
	chaser.x, chaser.z = math.clamp(x, -bound, bound), math.clamp(z, -bound, bound)

	-- Anyone inside the freeze radius is tagged.
	for _, kid in kids do
		if not kid.frozen and math.sqrt((kid.x - chaser.x) ^ 2 + (kid.z - chaser.z) ^ 2) <= Config.FREEZE_RADIUS then
			freezeKid(kid)
		end
	end
end

local function stepKid(kid, dt: number)
	local awayX, awayZ = kid.x - chaser.x, kid.z - chaser.z
	local distToChaser = math.sqrt(awayX * awayX + awayZ * awayZ)
	local baseSpeed = Config.KID_FLEE_SPEED * kid.data.speedMultiplier
	local limit = Config.HALF_PARK - 2.5

	kid.wanderTimer -= dt
	if kid.wanderTimer <= 0 then
		kid.wanderTimer = 1 + math.random() * 2
		kid.wanderAngle += (math.random() - 0.5) * 1.5
	end

	local wantX, wantZ
	if distToChaser < FLEE_DISTANCE then
		local scale = 1 / math.max(distToChaser, 0.001)
		local heading = Sim.pickHeading(kid.x, kid.z, awayX * scale, awayZ * scale, limit)
		local zigzag = math.sin(os.clock() * 6 + kid.data.id) * 0.4
		wantX = math.sin(heading + zigzag) * baseSpeed * 1.15
		wantZ = math.cos(heading + zigzag) * baseSpeed * 1.15
		kid.view:play("run")
	else
		kid.wanderAngle = Sim.pickHeading(kid.x, kid.z, math.sin(kid.wanderAngle), math.cos(kid.wanderAngle), limit)
		wantX = math.sin(kid.wanderAngle) * baseSpeed * 0.6
		wantZ = math.cos(kid.wanderAngle) * baseSpeed * 0.6
		kid.view:play("walk")
	end

	-- Keep clear of the playground in the middle.
	local distCentre = math.sqrt(kid.x * kid.x + kid.z * kid.z)
	if distCentre < 3.8 then
		wantX += kid.x / (distCentre + 0.1) * 6
		wantZ += kid.z / (distCentre + 0.1) * 6
	end

	local follow = 1 - math.exp(-STEER_RATE * dt)
	kid.vx += (wantX - kid.vx) * follow
	kid.vz += (wantZ - kid.vz) * follow
	local x, z = kid.x + kid.vx * dt, kid.z + kid.vz * dt

	-- Kids do not blend into each other; a frozen one is a wider, immovable block.
	for _, other in kids do
		if other ~= kid then
			local dx, dz = x - other.x, z - other.z
			local distSq = dx * dx + dz * dz
			local minDist = if other.frozen then FROZEN_RADIUS else KID_RADIUS * 2
			if distSq < minDist * minDist then
				local dist = math.max(math.sqrt(distSq), 0.001)
				local push = (minDist - dist) * (if other.frozen then 1 else 0.5)
				x += dx / dist * push
				z += dz / dist * push
			end
		end
	end

	local dx, dz = x - chaser.x, z - chaser.z
	local distSq = dx * dx + dz * dz
	local minDist = PLAYER_RADIUS + KID_RADIUS
	if distSq < minDist * minDist then
		local dist = math.max(math.sqrt(distSq), 0.001)
		x += dx / dist * (minDist - dist)
		z += dz / dist * (minDist - dist)
	end

	x, z = Sim.resolveObstacles(x, z, KID_RADIUS)
	kid.x, kid.z = math.clamp(x, -limit, limit), math.clamp(z, -limit, limit)

	-- The model faces -Z, so it turns to put its back to +Z of the velocity.
	if kid.vx * kid.vx + kid.vz * kid.vz > 0.1 then
		local target = math.atan2(kid.vx, kid.vz) + math.pi
		local turn = (target - kid.rotY + math.pi) % (2 * math.pi) - math.pi
		kid.rotY += math.clamp(turn, -10 * dt, 10 * dt)
	end
end

local shownStatus = ""

local function step(frameSeconds: number)
	local dt = math.min(frameSeconds, 0.05)
	local now = os.clock()
	local playing = status == "PLAYING"

	-- The chaser moves first, so the ring, the camera and the kids all read this frame's position.
	if playing then
		stepChaser(dt)
		playing = status == "PLAYING"
	else
		turnVelocity = 0
	end

	for _, kid in kids do
		if kid.frozen then
			kid.view:play("frozen")
		elseif playing then
			stepKid(kid, dt)
		else
			kid.view:play("idle")
		end
		kid.view:update(dt, kid.x, kid.z, kid.rotY)
	end

	if playing then
		timeRemaining = secondsLeftNow()
		if timeRemaining == 0 then
			endRound("TIME_UP")
		end
	end

	-- First-person camera at eye height, tilted slightly down to see the runners and the ring. It banks with the eased
	-- turn speed, so the tilt rises and settles with the turn rather than with the key.
	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = Config.FIELD_OF_VIEW
	local roll = -TURN_BANK * turnVelocity / Config.PLAYER_TURN_RATE
	camera.CFrame = CFrame.new(chaser.x * S, Config.EYE_HEIGHT * S, chaser.z * S)
		* CFrame.fromEulerAnglesYXZ(CAMERA_PITCH, chaser.yaw, roll)

	local ringCentre = CFrame.new(chaser.x * S, 0.05 * S, chaser.z * S) * CFrame.Angles(0, now * 1.5, 0)
	local pulse = ringRadius * (1 + math.sin(now * 6) * 0.05)
	for i = 1, RING_SEGMENTS do
		ringCFrames[i] = ringCentre * CFrame.Angles(0, i / RING_SEGMENTS * math.pi * 2, 0) * CFrame.new(0, 0, -pulse)
	end
	workspace:BulkMoveTo(ringSegments, ringCFrames, Enum.BulkMoveMode.FireCFrameChanged)
	if ring.rainbow then
		for i, segment in ringSegments do
			segment.Color = Rewards.colorAt(ring, now + i / RING_SEGMENTS * 4)
		end
	end

	for i, mote in pollen do
		pollenCFrames[i] = CFrame.new(mote.x * S, (mote.y + math.sin(now * mote.speed + mote.phase) * 0.4) * S, mote.z * S)
	end
	workspace:BulkMoveTo(pollenParts, pollenCFrames, Enum.BulkMoveMode.FireCFrameChanged)

	local left = kidsLeft()
	local key = string.format("%.1f/%d/%s", math.ceil(timeRemaining * 10 - 1e-6) / 10, left, tostring(playing))
	if key ~= shownStatus then
		shownStatus = key
		hud:setStatus(timeRemaining, left, #kids, playing)
	end
	hud:step(now)
end

RunService:BindToRenderStep("FreezeTag", Enum.RenderPriority.Camera.Value + 1, step)

-- Show the start prompt only once the models, textures and sounds are in, so the first round does not pop in.
task.spawn(function()
	pcall(function()
		ContentProvider:PreloadAsync({ workspace:WaitForChild("Park"), shared.Assets, music, sounds.freeze, hud.gui })
	end)
	ready = true
	hud:setReady()
end)
