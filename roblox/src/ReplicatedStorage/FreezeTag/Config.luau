-- Game rules and park layout. The simulation runs in metres, like the web game, so these values match it one for one.
-- Only rendering converts to studs.
local Config = {}

Config.STUDS_PER_METRE = 1 / 0.28

Config.TIME_LIMIT = 20
Config.PLAYER_SPEED = 9
Config.PLAYER_TURN_RATE = 3.2 -- radians per second
Config.FREEZE_RADIUS = 3.2
Config.KID_FLEE_SPEED = 6.25
Config.FIELD_OF_VIEW = 75
Config.EYE_HEIGHT = 1.6
Config.MUSIC_VOLUME = 0.5
Config.SFX_VOLUME = 0.6
-- The music file has one second of wrap-around padding before a 28-bar loop.
Config.MUSIC_LOOP = { lead = 1.0, length = 47.99657596371882 }

Config.HALF_PARK = 22
-- Distance of each spawn corner from the centre on both axes, inside the fence and clear of the corner trees.
Config.SPAWN_INSET = 19

Config.KIDS = {
	{ id = 1, name = "leo", speedMultiplier = 1.1, x = 6, z = -8 },
	{ id = 2, name = "maya", speedMultiplier = 0.95, x = -7, z = -10 },
	{ id = 3, name = "sam", speedMultiplier = 1.05, x = 8, z = 8 },
	{ id = 4, name = "zoe", speedMultiplier = 1.0, x = -8, z = 7 },
	{ id = 5, name = "toby", speedMultiplier = 1.0, x = 0, z = -14 },
}

-- Tree trunks, as circles.
Config.TREES = {
	{ x = -15, z = -15, radius = 1.1 },
	{ x = 16, z = -16, radius = 1.1 },
	{ x = -17, z = 14, radius = 1.1 },
	{ x = 15, z = 16, radius = 1.1 },
	{ x = -14, z = -3, radius = 1.1 },
	{ x = 16, z = 4, radius = 1.1 },
	{ x = 0, z = -18, radius = 1.1 },
	{ x = 0, z = 18, radius = 1.1 },
}

-- Playground structures and benches, as boxes.
Config.BOXES = {
	{ minX = -3.8, maxX = -0.2, minZ = -3.8, maxZ = -0.2 }, -- red tower
	{ minX = 0.8, maxX = 4.2, minZ = -3.2, maxZ = 0.2 }, -- blue tower
	{ minX = -1.0, maxX = 1.5, minZ = -2.7, maxZ = -0.9 }, -- bridge
	{ minX = -2.8, maxX = -1.2, minZ = -0.4, maxZ = 2.6 }, -- slide
	{ minX = -2.9, maxX = -1.1, minZ = -5.6, maxZ = -3.6 }, -- stairs
	{ minX = -3.6, maxX = 3.6, minZ = 3.8, maxZ = 6.2 }, -- swing set
	{ minX = -10.4, maxX = -5.6, minZ = -0.8, maxZ = 0.8 }, -- seesaw
	{ minX = 5.6, maxX = 10.4, minZ = -6.4, maxZ = -1.6 }, -- sandbox
	{ minX = -13.3, maxX = -10.7, minZ = -9.2, maxZ = -6.8 }, -- benches
	{ minX = 10.7, maxX = 13.3, minZ = -9.2, maxZ = -6.8 },
	{ minX = -13.3, maxX = -10.7, minZ = 6.8, maxZ = 9.2 },
	{ minX = 10.7, maxX = 13.3, minZ = 6.8, maxZ = 9.2 },
}

return Config
