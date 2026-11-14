-- Draws one kid: the rigged mesh, its animation clips, its frozen texture and the ice around it.
-- Roblox imported the kid's skeleton but not its animations, so this poses the bones itself from KidClips.
local Config = require(script.Parent.Config)
local KidClips = require(script.Parent.KidClips)

local assets = script.Parent.Assets
local S = Config.STUDS_PER_METRE

-- Clip playback that keeps feet near the ground speed without looking frantic.
local CLIP_RATE = { idle = 1, walk = 1.5, run = 1.3, frozen = 1 }
local CROSSFADE_SECONDS = 0.2
-- A tag should read instantly.
local FREEZE_SECONDS = 0.08

local function bonesOf(mesh: MeshPart): { [string]: Bone }
	local bones = {}
	for _, descendant in mesh:GetDescendants() do
		if descendant:IsA("Bone") then
			bones[descendant.Name] = descendant
		end
	end
	return bones
end

-- Turns the clip tables into Bone.Transform values, which are offsets from each bone's rest pose.
local function compile(mesh: MeshPart)
	local compiled = {}
	for clipName, clip in KidClips do
		local tracks = {}
		for boneName, bone in bonesOf(mesh) do
			local rotation = clip.rotation[boneName]
			local translation = clip.translation[boneName]
			local rotations = if rotation then #rotation / 4 else 1
			local translations = if translation then #translation / 3 else 1
			local rest = bone.CFrame
			local keys = table.create(math.max(rotations, translations))
			for i = 1, math.max(rotations, translations) do
				local turn = CFrame.identity
				if rotation then
					local r = (math.min(i, rotations) - 1) * 4
					turn = CFrame.new(0, 0, 0, rotation[r + 1], rotation[r + 2], rotation[r + 3], rotation[r + 4])
				end
				local offset = nil
				if translation then
					local t = (math.min(i, translations) - 1) * 3
					offset = Vector3.new(translation[t + 1], translation[t + 2], translation[t + 3]) * S
				end
				if boneName == "root" then
					-- The importer gave the root bone a half turn at rest that the source rig does not have, so its
					-- clip values already are offsets from rest.
					keys[i] = CFrame.new(offset or Vector3.zero) * turn
				else
					keys[i] = rest:Inverse() * (CFrame.new(offset or rest.Position) * turn)
				end
			end
			tracks[boneName] = keys
		end
		compiled[clipName] = { duration = clip.duration, step = clip.step, tracks = tracks }
	end
	return compiled
end

local clips = nil

local function sample(keys: { CFrame }, step: number, time: number): CFrame
	if #keys == 1 then
		return keys[1]
	end
	local frame = time / step
	local index = math.floor(frame)
	local from = keys[math.min(index + 1, #keys)]
	local to = keys[math.min(index + 2, #keys)]
	return from:Lerp(to, frame - index)
end

local KidView = {}
KidView.__index = KidView

function KidView.new(name: string, parent: Instance)
	local model = assets.Kids[name]:Clone()
	local mesh = model.Mesh
	clips = clips or compile(mesh)

	local self = setmetatable({
		model = model,
		mesh = mesh,
		skin = mesh.Skin,
		frozenSkin = model.FrozenSkin,
		ice = assets.Ice:Clone(),
		parent = parent,
		bones = bonesOf(mesh),
		pose = {},
		from = {},
		frozen = false,
		-- A slight rate difference stops the kids moving in unison.
		rate = 0.94 + math.random() * 0.12,
		clipName = nil,
		time = 0,
		fade = 1,
		fadeSeconds = CROSSFADE_SECONDS,
	}, KidView)
	for boneName in self.bones do
		self.pose[boneName] = CFrame.identity
	end
	self:play("idle")
	model.Parent = parent
	return self
end

-- Switches to the "idle", "walk", "run" or "frozen" clip, blending from the current pose.
function KidView:play(clipName: string)
	if self.clipName == clipName then
		return
	end
	self.clipName = clipName
	self.from = table.clone(self.pose)
	self.fade = 0
	if clipName == "frozen" then
		self.fadeSeconds = FREEZE_SECONDS
		self.time = 0
	else
		self.fadeSeconds = CROSSFADE_SECONDS
		-- A random start means no two kids are ever on the same step.
		self.time = math.random() * clips[clipName].duration
	end
end

function KidView:setFrozen(frozen: boolean)
	if self.frozen == frozen then
		return
	end
	self.frozen = frozen
	-- Only a SurfaceAppearance parented to the mesh is drawn, so the spare one waits in the model.
	self.skin.Parent = if frozen then self.model else self.mesh
	self.frozenSkin.Parent = if frozen then self.mesh else self.model
	self.ice.Parent = if frozen then self.parent else nil
end

-- Tints the ice block to go with the player's freeze ring.
function KidView:setIceColor(ringColor: Color3)
	self.ice.PrimaryPart.Color = ringColor:Lerp(Color3.new(1, 1, 1), 0.55)
end

-- Advances the animation and moves the kid to (x, z) in metres, turned by rotY radians.
function KidView:update(dt: number, x: number, z: number, rotY: number)
	local clip = clips[self.clipName]
	self.time += dt * CLIP_RATE[self.clipName] * self.rate
	local time = if self.clipName == "frozen" then math.min(self.time, clip.duration) else self.time % clip.duration
	self.fade = math.min(1, self.fade + dt / self.fadeSeconds)

	for boneName, keys in clip.tracks do
		local target = sample(keys, clip.step, time)
		if self.fade < 1 then
			target = self.from[boneName]:Lerp(target, self.fade)
		end
		self.pose[boneName] = target
		self.bones[boneName].Transform = target
	end

	local place = CFrame.new(x * S, 0, z * S) * CFrame.Angles(0, rotY, 0)
	self.model:PivotTo(place)
	if self.frozen then
		self.ice:PivotTo(place)
	end
end

return KidView
