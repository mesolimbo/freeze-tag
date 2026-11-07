// tslint:disable
/* eslint-disable */
import {
  Compass,
  Play,
  RotateCw,
  Snowflake,
  Volume2,
  VolumeX,
} from 'lucide-react';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {getConfig} from './constants';
import {Game, KIDS_CONFIG} from './Game';
import BackgroundMusic from './utils/BackgroundMusic';
import {gameAudio, MenuOverlay, Overlay} from './utils/helper';
import {
  usePlayground,
  usePlaygroundGameLifecycle,
} from './utils/usePlayground';

interface CustomWindow extends Window {
  canHandleBackKey?: boolean;
}

export default function App() {
  const {sdk} = usePlayground();

  const [gameState, setGameState] = useState<{
    status: 'START' | 'PLAYING' | 'PAUSED' | 'GAME_OVER' | 'VICTORY';
    score: number;
    level: number;
    timeRemaining: number;
  }>({
    status: 'START',
    score: 0,
    level: 1,
    timeRemaining: getConfig('timeLimit'),
  });

  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false);
  const [isHowToPlayOpen, setIsHowToPlayOpen] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(false);
  const [musicMuted, setMusicMuted] = useState(false);

  // 5 Kids Freeze State
  const [frozenKids, setFrozenKids] = useState<boolean[]>([
    false,
    false,
    false,
    false,
    false,
  ]);

  const [freezeNotice, setFreezeNotice] = useState<string | null>(null);

  // Shared First Person Refs
  const playerPosRef = useRef({
    x: 0,
    y: 1.6,
    z: 16,
    yaw: 0,
    pitch: 0,
  });

  const kidsPosRef = useRef<
    Array<{x: number; y: number; z: number; isFrozen: boolean}>
  >(
    KIDS_CONFIG.map((k) => ({
      x: k.initialPos[0],
      y: k.initialPos[1],
      z: k.initialPos[2],
      isFrozen: false,
    }))
  );

  // Handle Back-Key cast
  useEffect(() => {
    (window as CustomWindow).canHandleBackKey = ['PLAYING', 'PAUSED'].includes(
      gameState.status
    );
  }, [gameState.status]);

  // Audio motifs
  useEffect(() => {
    if (gameState.status === 'GAME_OVER') {
      gameAudio.playDefeatMotif();
    } else if (gameState.status === 'VICTORY') {
      gameAudio.playVictoryFanfare();
    }
  }, [gameState.status]);

  // Global ESC key to toggle Game Menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (gameState.status === 'PLAYING') {
          setIsGameMenuOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState.status]);

  // Reset & Start Game
  const initGame = useCallback(() => {
    const totalTime = getConfig('timeLimit');
    playerPosRef.current = {
      x: 0,
      y: 1.6,
      z: 16,
      yaw: 0,
      pitch: 0,
    };
    kidsPosRef.current = KIDS_CONFIG.map((k) => ({
      x: k.initialPos[0],
      y: k.initialPos[1],
      z: k.initialPos[2],
      isFrozen: false,
    }));
    setFrozenKids([false, false, false, false, false]);
    setFreezeNotice(null);
    setGameState({
      status: 'PLAYING',
      score: 0,
      level: 1,
      timeRemaining: totalTime,
    });
    setIsGameMenuOpen(false);
    setIsHowToPlayOpen(false);

    if (sdk) {
      sdk.startGame();
    }
  }, [sdk]);

  // Register Playground SDK lifecycle
  usePlaygroundGameLifecycle(
    {
      status: gameState.status,
      score: gameState.score,
      level: gameState.level,
    },
    sdk
  );

  // Freeze action triggered automatically by radius
  const handleFreezeKid = useCallback((idx: number) => {
    setFrozenKids((prev) => {
      if (prev[idx]) return prev;
      const next = [...prev];
      next[idx] = true;

      const frozenCount = next.filter(Boolean).length;
      const kidName = KIDS_CONFIG[idx].name;
      setFreezeNotice(`FROZEN: ${kidName}! (${frozenCount}/5)`);
      setTimeout(() => setFreezeNotice(null), 1800);

      // Score bonus
      setGameState((g) => ({
        ...g,
        score: g.score + 250 + Math.floor(g.timeRemaining * 15),
      }));

      // Check win condition
      if (frozenCount === 5) {
        setTimeout(() => {
          setGameState((g) => ({
            ...g,
            status: 'VICTORY',
            score: g.score + 600 + Math.floor(g.timeRemaining * 60),
          }));
        }, 400);
      }

      return next;
    });
  }, []);

  // Main 20-second countdown loop
  useEffect(() => {
    if (gameState.status !== 'PLAYING' || isGameMenuOpen || isHowToPlayOpen)
      return;

    const timer = setInterval(() => {
      setGameState((prev) => {
        if (prev.timeRemaining <= 0.1) {
          clearInterval(timer);
          return {
            ...prev,
            timeRemaining: 0,
            status: 'GAME_OVER',
          };
        }
        return {
          ...prev,
          timeRemaining: Math.max(0, prev.timeRemaining - 0.1),
        };
      });
    }, 100);

    return () => clearInterval(timer);
  }, [gameState.status, isGameMenuOpen, isHowToPlayOpen]);

  const frozenCount = frozenKids.filter(Boolean).length;
  const isMusicPlaying =
    ['PLAYING', 'PAUSED'].includes(gameState.status) &&
    !isGameMenuOpen &&
    !isHowToPlayOpen;

  // Compute nearest runner distance for HUD radar
  const [nearestDist, setNearestDist] = useState<number>(0);
  useEffect(() => {
    if (gameState.status !== 'PLAYING') return;
    const interval = setInterval(() => {
      const p = playerPosRef.current;
      let minD = 999;
      kidsPosRef.current.forEach((k) => {
        if (!k.isFrozen) {
          const d = Math.hypot(k.x - p.x, k.z - p.z);
          if (d < minD) minD = d;
        }
      });
      setNearestDist(minD < 900 ? minD : 0);
    }, 150);
    return () => clearInterval(interval);
  }, [gameState.status]);

  return (
    <div className="fixed inset-0 overflow-hidden touch-none flex flex-col bg-zinc-950 text-white font-sans select-none">
      <BackgroundMusic
        url={getConfig('backgroundMusicUrl')}
        isPlaying={isMusicPlaying}
        isMuted={musicMuted}
      />

      {/* TOP HUD BAR - Safe Padding, flex wrap */}
      <header className="w-full bg-slate-900/90 backdrop-blur border-b border-slate-800 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 z-20 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-cyan-950/80 border border-cyan-500/40 px-2 py-0.5 rounded text-cyan-300 font-bold text-xs">
            <Snowflake size={14} className="animate-spin text-cyan-400" />
            <span>
              FROZEN: {frozenCount} / 5
            </span>
          </div>

          <div
            className={`px-2 py-0.5 rounded font-black text-xs font-mono border ${
              gameState.timeRemaining <= 5
                ? 'bg-red-950/90 border-red-500 text-red-300 animate-pulse'
                : 'bg-amber-950/70 border-amber-500/40 text-amber-300'
            }`}
          >
            TIMER: {gameState.timeRemaining.toFixed(1)}s
          </div>
        </div>

        {/* Center Target Indicator */}
        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300 font-mono">
          <Compass size={14} className="text-emerald-400" />
          <span>
            NEAREST RUNNER:{' '}
            {nearestDist > 0 ? `${nearestDist.toFixed(1)}m` : 'ALL FROZEN!'}
          </span>
        </div>

        {/* Right Safe Area: Game Menu Button exclusively in top right */}
        <div className="flex items-center gap-2">
          <div className="text-xs font-bold text-yellow-400 font-mono hidden md:inline">
            SCORE: {gameState.score}
          </div>
          <button
            onClick={() => {
              gameAudio.playCrispClick();
              setIsGameMenuOpen(true);
            }}
            className="min-w-[48px] min-h-[48px] px-3 py-1 bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-600 rounded-lg text-xs font-bold text-white transition-transform flex items-center justify-center pointer-events-auto"
          >
            MENU
          </button>
        </div>
      </header>

      {/* 3D CANVAS VIEWPORT */}
      <main className="flex-1 w-full min-h-0 relative flex items-center justify-center overflow-hidden">
        <Game
          isPlaying={
            gameState.status === 'PLAYING' &&
            !isGameMenuOpen &&
            !isHowToPlayOpen
          }
          isPaused={isGameMenuOpen || isHowToPlayOpen}
          frozenKids={frozenKids}
          setFrozenKids={setFrozenKids}
          onFreezeKid={handleFreezeKid}
          playerPosRef={playerPosRef}
          kidsPosRef={kidsPosRef}
        />

        {/* Frost Banner Popup on Freeze */}
        {freezeNotice && (
          <div className="absolute top-4 pointer-events-none z-20 flex justify-center w-full animate-bounce">
            <div className="bg-cyan-900/90 border border-cyan-300 px-4 py-1.5 rounded-full shadow-lg text-cyan-100 font-black text-xs md:text-sm tracking-wide">
              {freezeNotice}
            </div>
          </div>
        )}

        {/* Dynamic HUD Control Prompt: Shift Left & Shift Right */}
        {gameState.status === 'PLAYING' && (
          <div className="absolute bottom-4 w-full flex flex-col items-center pointer-events-none z-10 px-4">
            <div className="flex items-center gap-4 bg-black/70 backdrop-blur border border-cyan-500/40 px-5 py-2.5 rounded-2xl shadow-xl">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 bg-slate-800 border border-slate-600 rounded-lg text-cyan-300 font-mono font-bold text-xs shadow">
                  Left Shift
                </span>
                <span className="text-xs text-slate-300 font-semibold">TURN LEFT</span>
              </div>
              <div className="h-4 w-px bg-white/20" />
              <div className="text-[11px] text-amber-300 font-bold uppercase tracking-wider">
                AUTO-MOVING FORWARD
              </div>
              <div className="h-4 w-px bg-white/20" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-300 font-semibold">TURN RIGHT</span>
                <span className="px-2.5 py-1 bg-slate-800 border border-slate-600 rounded-lg text-cyan-300 font-mono font-bold text-xs shadow">
                  Right Shift
                </span>
              </div>
            </div>
            <div className="text-[11px] text-cyan-300/80 mt-1.5 font-medium">
              ❄️ Get kids inside your blue Freeze Aura circle to freeze them!
            </div>
          </div>
        )}
      </main>

      {/* START SCREEN OVERLAY */}
      {gameState.status === 'START' && (
        <MenuOverlay tone="neutral" zIndex={40}>
          <div className="bg-slate-900 border-2 border-cyan-500/40 p-6 md:p-8 rounded-2xl shadow-2xl flex flex-col items-center w-full max-w-sm text-center">
            <div className="w-14 h-14 bg-cyan-500/20 border border-cyan-400 rounded-2xl flex items-center justify-center mb-4">
              <Snowflake size={32} className="text-cyan-400 animate-pulse" />
            </div>

            <h1 className="text-2xl md:text-3xl font-black text-yellow-400 mb-2">
              PARK FREEZE TAG
            </h1>

            <p className="text-xs md:text-sm text-slate-300 mb-5 leading-relaxed">
              Keyboard only! You run constantly forward. Use the <strong className="text-cyan-300">Left Shift</strong> and <strong className="text-cyan-300">Right Shift</strong> keys to steer your freeze aura into all <strong className="text-white">5 kids</strong> in 20 seconds!
            </p>

            <div className="w-full bg-slate-800/80 border border-slate-700 p-3 rounded-xl mb-5 flex justify-around text-xs text-slate-200">
              <div>
                <kbd className="px-2 py-1 bg-slate-700 border border-slate-500 rounded font-mono font-bold text-cyan-300">
                  Left Shift
                </kbd>
                <div className="mt-1 text-[11px] text-slate-400">Steer Left</div>
              </div>
              <div className="text-amber-400 font-bold self-center">
                + Auto-Forward
              </div>
              <div>
                <kbd className="px-2 py-1 bg-slate-700 border border-slate-500 rounded font-mono font-bold text-cyan-300">
                  Right Shift
                </kbd>
                <div className="mt-1 text-[11px] text-slate-400">Steer Right</div>
              </div>
            </div>

            <button
              onClick={() => {
                gameAudio.playPowerupChime();
                initGame();
              }}
              autoFocus
              className="w-full min-h-[48px] bg-cyan-500 hover:bg-cyan-400 active:scale-95 text-slate-950 font-black text-base py-3 px-6 rounded-xl transition-all shadow-lg shadow-cyan-500/30 flex items-center justify-center gap-2 pointer-events-auto"
            >
              <Play size={20} />
              START GAME
            </button>

            <button
              onClick={() => {
                gameAudio.playCrispClick();
                setIsHowToPlayOpen(true);
              }}
              className="mt-3 text-xs text-slate-400 hover:text-white underline pointer-events-auto"
            >
              How to Play & Rules
            </button>
          </div>
        </MenuOverlay>
      )}

      {/* VICTORY OVERLAY */}
      {gameState.status === 'VICTORY' && (
        <Overlay
          title="ALL 5 FROZEN!"
          description={`Speed Tag Master! All kids frozen inside your aura. Final Score: ${gameState.score}`}
          actionLabel="PLAY AGAIN"
          onAction={initGame}
          icon={<RotateCw size={22} />}
          tone="victory"
        />
      )}

      {/* GAME OVER OVERLAY */}
      {gameState.status === 'GAME_OVER' && (
        <Overlay
          title="TIME'S UP!"
          description={`You frozen ${frozenCount} of 5 kids before the 20 seconds ran out. Final Score: ${gameState.score}`}
          actionLabel="TRY AGAIN"
          onAction={initGame}
          icon={<RotateCw size={22} />}
          tone="danger"
        />
      )}

      {/* GAME MENU / PAUSE OVERLAY */}
      {isGameMenuOpen && (
        <MenuOverlay tone="neutral" zIndex={50}>
          <div className="w-full max-w-sm flex flex-col items-center bg-gray-900 border-2 border-slate-700 rounded-2xl p-6 m-4 shadow-2xl text-center">
            <h2 className="text-2xl font-black text-yellow-400 mb-6">
              GAME MENU
            </h2>

            <div className="w-full flex flex-col gap-3">
              <button
                onClick={() => {
                  gameAudio.playCrispClick();
                  setIsGameMenuOpen(false);
                }}
                autoFocus
                className="w-full min-h-[48px] bg-white text-black font-bold rounded-xl hover:bg-yellow-400 transition-colors pointer-events-auto"
              >
                RESUME
              </button>

              <div className="grid grid-cols-2 gap-2 my-1">
                <button
                  onClick={() => {
                    const newMuted = gameAudio.toggleMute();
                    setSfxMuted(newMuted);
                  }}
                  className="min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 pointer-events-auto"
                >
                  {sfxMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  SFX: {sfxMuted ? 'Off' : 'On'}
                </button>

                <button
                  onClick={() => setMusicMuted((prev) => !prev)}
                  className="min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 pointer-events-auto"
                >
                  {musicMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  Music: {musicMuted ? 'Off' : 'On'}
                </button>
              </div>

              <button
                onClick={() => {
                  gameAudio.playCrispClick();
                  initGame();
                }}
                className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold rounded-xl transition-colors pointer-events-auto"
              >
                TRY LEVEL AGAIN
              </button>

              <button
                onClick={() => {
                  gameAudio.playCrispClick();
                  setIsHowToPlayOpen(true);
                }}
                className="w-full min-h-[48px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold rounded-xl transition-colors pointer-events-auto"
              >
                HOW TO PLAY
              </button>

              <button
                onClick={() => {
                  gameAudio.playCrispClick();
                  setIsGameMenuOpen(false);
                  setGameState((prev) => ({...prev, status: 'START'}));
                }}
                className="w-full min-h-[48px] bg-red-950/80 hover:bg-red-900 border border-red-700/60 text-red-200 font-bold rounded-xl transition-colors pointer-events-auto"
              >
                QUIT TO MENU
              </button>
            </div>
          </div>
        </MenuOverlay>
      )}

      {/* HOW TO PLAY OVERLAY */}
      {isHowToPlayOpen && (
        <MenuOverlay tone="neutral" zIndex={60}>
          <div className="w-full max-w-md bg-slate-900 border-2 border-cyan-500 rounded-2xl p-6 shadow-2xl text-left">
            <h2 className="text-xl font-black text-cyan-300 mb-3 text-center">
              HOW TO PLAY
            </h2>
            <div className="space-y-3 text-xs text-slate-300 leading-relaxed mb-6">
              <p>
                ⌨️ <strong>Keyboard Only:</strong> There are only two controls in this game:
              </p>
              <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 space-y-2">
                <div>• <kbd className="px-2 py-0.5 bg-slate-700 font-mono text-cyan-300 rounded font-bold">Left Shift</kbd>: Turn Left</div>
                <div>• <kbd className="px-2 py-0.5 bg-slate-700 font-mono text-cyan-300 rounded font-bold">Right Shift</kbd>: Turn Right</div>
              </div>
              <p>
                🏃 <strong>Auto Forward:</strong> Your tagger is always charging forward at high speed.
              </p>
              <p>
                ❄️ <strong>Freeze Radius Aura:</strong> You emit a glowing blue circular freeze aura. As soon as any runner kid touches or enters your aura circle, they instantly freeze solid!
              </p>
              <p>
                ⏱️ <strong>Goal:</strong> Freeze all 5 kids before the 20-second timer hits zero!
              </p>
            </div>

            <button
              onClick={() => {
                gameAudio.playCrispClick();
                setIsHowToPlayOpen(false);
              }}
              autoFocus
              className="w-full min-h-[48px] bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black py-3 rounded-xl transition-colors text-center pointer-events-auto"
            >
              CLOSE
            </button>
          </div>
        </MenuOverlay>
      )}
    </div>
  );
}
