-- Everything drawn over the 3D view: the splash, the status bar, the result screen and the music button.
local GuiService = game:GetService("GuiService")
local TweenService = game:GetService("TweenService")

local SPLASH_IMAGE = "rbxassetid://77939503309121"
local SPLASH_FADE_SECONDS = 0.7
local LEADERBOARD_ROWS = 5
local URGENT_SECONDS = 5
-- Below this width the status line gets a row of its own above the control hints.
local NARROW_WIDTH = 640

local WHITE = Color3.new(1, 1, 1)
local BLACK = Color3.new(0, 0, 0)
local CYAN = Color3.fromRGB(103, 232, 249)
local YELLOW = Color3.fromRGB(253, 224, 71)
local SLATE = Color3.fromRGB(15, 23, 42)
local WIN_STROKE = Color3.fromRGB(30, 58, 138)
local LOSE_STROKE = Color3.fromRGB(127, 29, 29)
local RED_TAG = '<font color="#ef4444"><b>%s</b></font>'

local function make(className: string, properties: { [string]: any }, parent: Instance?): any
	local instance = Instance.new(className)
	for key, value in properties do
		instance[key] = value
	end
	instance.Parent = parent
	return instance
end

local function label(properties: { [string]: any }, parent: Instance, strokeColor: Color3?): TextLabel
	local text = make("TextLabel", { BackgroundTransparency = 1, TextColor3 = WHITE, Font = Enum.Font.LuckiestGuy }, parent)
	for key, value in properties do
		text[key] = value
	end
	if strokeColor then
		make("UIStroke", { Color = strokeColor, Thickness = 3, LineJoinMode = Enum.LineJoinMode.Round }, text)
	end
	return text
end

-- Seconds to one decimal, rounded up so the clock reads 20.0 at the start and only shows 0.0 once time is up.
local function formatSeconds(seconds: number): string
	return string.format("%.1f", math.max(0, math.ceil(seconds * 10 - 1e-6)) / 10)
end

local Hud = {}
Hud.__index = Hud

function Hud.new(playerGui: PlayerGui, isTouch: boolean)
	local self = setmetatable({ isTouch = isTouch, muted = false, onMuteToggled = nil, onSplashClicked = nil }, Hud)

	local gui = make("ScreenGui", {
		Name = "FreezeTagHud",
		IgnoreGuiInset = true,
		ResetOnSpawn = false,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
	}, playerGui)
	self.gui = gui

	-- The outcome washes over the scene: pale blue for catching everyone, pale red for running out of time.
	self.tint = make("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, BorderSizePixel = 0 }, gui)

	self.bar = make("Frame", { BackgroundColor3 = BLACK, BackgroundTransparency = 0.65, BorderSizePixel = 0, ZIndex = 2 }, gui)
	self.status = label({
		Font = Enum.Font.GothamBold,
		RichText = true,
		TextColor3 = Color3.fromRGB(248, 113, 113),
		AnchorPoint = Vector2.new(0.5, 0),
		ZIndex = 3,
	}, self.bar, BLACK)
	self.sides = { left = self:_sideControl("left"), right = self:_sideControl("right") }

	self.result = make("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Visible = false, ZIndex = 4 }, gui)
	make("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		HorizontalAlignment = Enum.HorizontalAlignment.Center,
		VerticalAlignment = Enum.VerticalAlignment.Center,
		SortOrder = Enum.SortOrder.LayoutOrder,
		Padding = UDim.new(0.025, 0),
	}, self.result)
	self.title = label({ LayoutOrder = 1, AutomaticSize = Enum.AutomaticSize.XY }, self.result, WIN_STROKE)
	self.spare = label({ LayoutOrder = 2, AutomaticSize = Enum.AutomaticSize.XY }, self.result, WIN_STROKE)
	self.board = make("Frame", {
		LayoutOrder = 3,
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = BLACK,
		BackgroundTransparency = 0.55,
		Visible = false,
	}, self.result)
	make("UICorner", { CornerRadius = UDim.new(0, 16) }, self.board)
	make("UIPadding", {
		PaddingTop = UDim.new(0, 10),
		PaddingBottom = UDim.new(0, 10),
		PaddingLeft = UDim.new(0, 16),
		PaddingRight = UDim.new(0, 16),
	}, self.board)
	make("UIListLayout", { SortOrder = Enum.SortOrder.LayoutOrder, Padding = UDim.new(0, 2) }, self.board)
	self.continue = label({ LayoutOrder = 4, AutomaticSize = Enum.AutomaticSize.XY }, self.result, WIN_STROKE)
	self.continue.Text = if isTouch then "Tap to continue" else "Press any key to continue"

	self.splash = make("ImageButton", {
		Size = UDim2.fromScale(1, 1),
		Image = SPLASH_IMAGE,
		ScaleType = Enum.ScaleType.Crop,
		BackgroundColor3 = Color3.fromRGB(135, 206, 235),
		BorderSizePixel = 0,
		AutoButtonColor = false,
		ZIndex = 50,
	}, gui)
	self.prompt = label({
		Text = "Loading…",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.fromScale(0.5, 0.92),
		AutomaticSize = Enum.AutomaticSize.XY,
		TextTransparency = 0.2,
		ZIndex = 51,
	}, self.splash, WIN_STROKE)
	self.splash.Activated:Connect(function()
		if self.onSplashClicked then
			self.onSplashClicked()
		end
	end)

	self.mute = make("TextButton", {
		AnchorPoint = Vector2.new(1, 0),
		BackgroundColor3 = WHITE,
		BackgroundTransparency = 0.25,
		Text = "🔊",
		TextColor3 = Color3.fromRGB(59, 135, 207),
		Font = Enum.Font.GothamBold,
		ZIndex = 61,
	}, gui)
	make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, self.mute)
	self.mute.Activated:Connect(function()
		if self.onMuteToggled then
			self.onMuteToggled()
		end
	end)

	local camera = workspace.CurrentCamera
	camera:GetPropertyChangedSignal("ViewportSize"):Connect(function()
		self:_layout()
	end)
	self:_layout()
	return self
end

-- The control hint: an arrow, a Shift keycap ("tap" on touch screens) and the side's name.
function Hud:_sideControl(side: string)
	local right = side == "right"
	local frame = make("Frame", {
		BackgroundTransparency = 1,
		AutomaticSize = Enum.AutomaticSize.X,
		AnchorPoint = Vector2.new(if right then 1 else 0, 0),
		ZIndex = 3,
	}, self.bar)
	make("UIListLayout", {
		FillDirection = Enum.FillDirection.Horizontal,
		VerticalAlignment = Enum.VerticalAlignment.Center,
		HorizontalAlignment = if right then Enum.HorizontalAlignment.Right else Enum.HorizontalAlignment.Left,
		SortOrder = Enum.SortOrder.LayoutOrder,
		Padding = UDim.new(0, 8),
	}, frame)
	local function order(index: number): number
		return if right then -index else index
	end
	local arrow = label({
		Text = if right then "→" else "←",
		Font = Enum.Font.GothamBold,
		AutomaticSize = Enum.AutomaticSize.XY,
		LayoutOrder = order(1),
		ZIndex = 3,
	}, frame)
	local cap = label({
		Text = if self.isTouch then "tap" else "⇧ shift",
		Font = Enum.Font.RobotoMono,
		TextColor3 = SLATE,
		BackgroundTransparency = 0.1,
		BackgroundColor3 = WHITE,
		AutomaticSize = Enum.AutomaticSize.XY,
		LayoutOrder = order(2),
		ZIndex = 3,
	}, frame)
	make("UICorner", { CornerRadius = UDim.new(0, 6) }, cap)
	make("UIPadding", {
		PaddingLeft = UDim.new(0, 8),
		PaddingRight = UDim.new(0, 8),
		PaddingTop = UDim.new(0, 3),
		PaddingBottom = UDim.new(0, 3),
	}, cap)
	local name = label({
		Text = side,
		Font = Enum.Font.GothamBold,
		AutomaticSize = Enum.AutomaticSize.XY,
		LayoutOrder = order(3),
		ZIndex = 3,
	}, frame)
	return { frame = frame, arrow = arrow, cap = cap, name = name }
end

function Hud:_layout()
	local viewport = workspace.CurrentCamera.ViewportSize
	local unit = math.clamp(viewport.Y / 720, 0.55, 1.6)
	local narrow = viewport.X < NARROW_WIDTH
	-- Roblox draws its own menu button in this strip at the top.
	local inset = GuiService:GetGuiInset().Y
	local margin = if narrow then 16 else 32
	local row = math.round(34 * unit)
	local barHeight = if narrow then row * 2 + 20 else row + 20

	self.bar.Position = UDim2.fromOffset(0, inset)
	self.bar.Size = UDim2.new(1, 0, 0, barHeight)
	self.status.TextSize = math.round((if narrow then 18 else 24) * unit)
	self.status.Position = UDim2.new(0.5, 0, 0, 10)
	self.status.Size = UDim2.new(1, if narrow then -2 * margin else -420 * unit, 0, row)
	for side, control in self.sides do
		control.frame.Size = UDim2.fromOffset(0, row)
		control.frame.Position = UDim2.new(if side == "right" then 1 else 0, if side == "right" then -margin else margin, 0, barHeight - row - 10)
		control.arrow.TextSize = math.round(24 * unit)
		control.cap.TextSize = math.round(15 * unit)
		control.name.TextSize = math.round(15 * unit)
	end

	local button = math.round(40 * unit)
	self.mute.Size = UDim2.fromOffset(button, button)
	self.mute.Position = UDim2.new(1, -margin, 0, inset + barHeight + 12)
	self.mute.TextSize = math.round(20 * unit)

	self.prompt.TextSize = math.round((if narrow then 30 else 48) * unit)
	self.title.TextSize = math.round((if narrow then 72 else 120) * unit)
	self.spare.TextSize = math.round((if narrow then 30 else 46) * unit)
	self.continue.TextSize = math.round((if narrow then 24 else 30) * unit)
	self.boardTextSize = math.round((if narrow then 16 else 20) * unit)
	self.board.Size = UDim2.fromOffset(math.round(320 * unit), 0)
	for _, child in self.board:GetChildren() do
		if child:IsA("TextLabel") then
			child.TextSize = self.boardTextSize
			child.Size = UDim2.new(1, 0, 0, self.boardTextSize + 6)
		end
	end
end

-- Call every frame: the start prompt and the result title blink slowly, and the clock pulses when time is short.
function Hud:step(now: number)
	local blink = 0.5 - 0.5 * math.cos(now * math.pi)
	if self.ready and self.splash.Visible and not self.leaving then
		self.prompt.TextTransparency = blink * 0.75
	end
	if self.result.Visible then
		self.title.TextTransparency = blink * 0.6
	end
	self.status.TextTransparency = if self.urgent then 0.25 + 0.25 * math.cos(now * math.pi * 2) else 0
end

function Hud:setReady()
	self.ready = true
	self.prompt.Text = if self.isTouch then "Tap to start" else "Press Space to start"
end

-- Fades the splash out, then calls done.
function Hud:leaveSplash(done: () -> ())
	self.leaving = true
	local info = TweenInfo.new(SPLASH_FADE_SECONDS)
	TweenService:Create(self.splash, info, { ImageTransparency = 1, BackgroundTransparency = 1 }):Play()
	TweenService:Create(self.prompt, info, { TextTransparency = 1 }):Play()
	TweenService:Create(self.prompt.UIStroke, info, { Transparency = 1 }):Play()
	task.delay(SPLASH_FADE_SECONDS, function()
		self.splash.Visible = false
		done()
	end)
end

function Hud:setStatus(secondsLeft: number, kidsLeft: number, totalKids: number, playing: boolean)
	local catch
	if kidsLeft == totalKids then
		catch = "all " .. RED_TAG:format(kidsLeft) .. " kids!"
	elseif kidsLeft == 1 then
		catch = "the last kid!"
	else
		catch = RED_TAG:format(kidsLeft) .. " more kids!"
	end
	self.status.Text = RED_TAG:format(formatSeconds(secondsLeft)) .. " seconds to catch " .. catch
	self.urgent = playing and secondsLeft <= URGENT_SECONDS
end

function Hud:setPressed(left: boolean, right: boolean)
	for side, pressed in { left = left, right = right } do
		local control = self.sides[side]
		control.arrow.TextColor3 = if pressed then CYAN else WHITE
		control.cap.BackgroundColor3 = if pressed then CYAN else WHITE
	end
end

function Hud:setMuted(muted: boolean)
	self.mute.Text = if muted then "🔇" else "🔊"
end

function Hud:showResult(won: boolean, secondsLeft: number)
	local stroke = if won then WIN_STROKE else LOSE_STROKE
	self.title.Text = if won then "You Win!" else "You Lost!"
	self.spare.Text = "with " .. formatSeconds(secondsLeft) .. " seconds to spare!"
	self.spare.Visible = won
	for _, text in { self.title, self.spare, self.continue } do
		text.UIStroke.Color = stroke
	end
	self.tint.BackgroundColor3 = if won then Color3.fromRGB(186, 230, 253) else Color3.fromRGB(252, 165, 165)
	TweenService:Create(self.tint, TweenInfo.new(0.5), { BackgroundTransparency = if won then 0.6 else 0.65 }):Play()
	self.board.Visible = false
	self.bar.Visible = false
	self.result.Visible = true
end

function Hud:hideResult()
	TweenService:Create(self.tint, TweenInfo.new(0.5), { BackgroundTransparency = 1 }):Play()
	self.result.Visible = false
	self.bar.Visible = true
end

-- For when the scores cannot be read, such as in Studio without API access.
function Hud:hideBoard()
	self.board.Visible = false
end

-- Top scores by time left, with the player's own place when they are outside the list.
-- data is { top = { { username, seconds } }, me = { rank?, seconds }? }, or nil while it loads.
function Hud:setBoard(data)
	for _, child in self.board:GetChildren() do
		if child:IsA("TextLabel") then
			child:Destroy()
		end
	end
	local function line(order: number, text: string, color: Color3?, alignment: Enum.TextXAlignment?)
		return label({
			Text = text,
			TextColor3 = color or WHITE,
			TextSize = self.boardTextSize,
			TextXAlignment = alignment or Enum.TextXAlignment.Center,
			TextTruncate = Enum.TextTruncate.AtEnd,
			Size = UDim2.new(1, 0, 0, self.boardTextSize + 6),
			LayoutOrder = order,
			ZIndex = 5,
		}, self.board)
	end
	local function row(order: number, name: string, seconds: number, color: Color3?)
		local left = line(order, name, color, Enum.TextXAlignment.Left)
		label({
			Text = string.format("%.1fs", seconds),
			TextColor3 = color or WHITE,
			TextSize = self.boardTextSize,
			TextXAlignment = Enum.TextXAlignment.Right,
			Size = UDim2.fromScale(1, 1),
			ZIndex = 5,
		}, left)
	end

	line(0, "Fastest catches", YELLOW)
	if data == nil then
		line(1, "Loading…")
	elseif #data.top == 0 then
		line(1, "No scores yet")
	else
		local me = data.me
		for index = 1, math.min(#data.top, LEADERBOARD_ROWS) do
			local entry = data.top[index]
			row(index, index .. ". " .. entry.username, entry.seconds, if me and me.rank == index then CYAN else nil)
		end
		if me and (me.rank == nil or me.rank > LEADERBOARD_ROWS) then
			row(LEADERBOARD_ROWS + 1, if me.rank then "You: #" .. me.rank else "Your best", me.seconds, CYAN)
		end
	end
	self.board.Visible = true
end

return Hud
