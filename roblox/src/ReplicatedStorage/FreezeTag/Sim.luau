-- Movement rules shared by the chaser and the kids: obstacle collision and the kids' choice of heading.
local Config = require(script.Parent.Config)

local Sim = {}

-- How far ahead a kid checks for the fence when choosing a heading.
local FENCE_LOOKAHEAD = 5
-- Keeps kids this far inside the clamp so they turn before they scrape along the fence.
local FENCE_CLEARANCE = 1
local FENCE_PENALTY = 0.6
local HEADING_SAMPLES = 16

-- Pushes a circle of the given radius out of every tree, playground structure and bench.
function Sim.resolveObstacles(x: number, z: number, bodyRadius: number): (number, number)
	for _, tree in Config.TREES do
		local dx, dz = x - tree.x, z - tree.z
		local distSq = dx * dx + dz * dz
		local minDist = bodyRadius + tree.radius
		if distSq < minDist * minDist then
			local dist = math.sqrt(distSq)
			if dist == 0 then
				dist = 0.001
			end
			local push = minDist - dist
			x += dx / dist * push
			z += dz / dist * push
		end
	end

	for _, box in Config.BOXES do
		local minX, maxX = box.minX - bodyRadius, box.maxX + bodyRadius
		local minZ, maxZ = box.minZ - bodyRadius, box.maxZ + bodyRadius
		if x > minX and x < maxX and z > minZ and z < maxZ then
			local left, right = x - minX, maxX - x
			local bottom, top = z - minZ, maxZ - z
			local nearest = math.min(left, right, bottom, top)
			if nearest == left then
				x = minX
			elseif nearest == right then
				x = maxX
			elseif nearest == bottom then
				z = minZ
			else
				z = maxZ
			end
		end
	end
	return x, z
end

-- The heading closest to (wantX, wantZ) that does not run into the fence within the lookahead.
-- In a corner every heading away from the player hits a fence, so this picks a run along one fence instead.
function Sim.pickHeading(x: number, z: number, wantX: number, wantZ: number, limit: number): number
	local soft = limit - FENCE_CLEARANCE
	local function overrun(dx: number, dz: number): number
		return math.max(0, math.abs(x + dx * FENCE_LOOKAHEAD) - soft) + math.max(0, math.abs(z + dz * FENCE_LOOKAHEAD) - soft)
	end

	if overrun(wantX, wantZ) == 0 then
		return math.atan2(wantX, wantZ)
	end

	local best, bestScore = 0, -math.huge
	for i = 0, HEADING_SAMPLES - 1 do
		local angle = i / HEADING_SAMPLES * math.pi * 2
		local dx, dz = math.sin(angle), math.cos(angle)
		local score = dx * wantX + dz * wantZ - overrun(dx, dz) * FENCE_PENALTY
		if score > bestScore then
			bestScore = score
			best = angle
		end
	end
	return best
end

return Sim
