import {ArrowLeft, ArrowRight, Volume2, VolumeX} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {getConfig, MUSIC_LOOP} from './constants';
import {Game, KIDS_CONFIG} from './Game';
import BackgroundMusic from './utils/BackgroundMusic';
import {gameAudio} from './utils/helper';
import type {LeaderboardApi, LeaderboardData} from './types';
import {IS_TOUCH_DEVICE, touchSide} from './utils/touch';

/** Distance of each spawn corner from the centre on both axes, inside the fence and clear of the corner trees. */
const SPAWN_INSET = 19;
const EYE_HEIGHT = 1.6;
/** After a round ends, ignore keys this long so a key still held from play does not skip the result. */
const RESTART_DELAY_MS = 900;
/** Fast enough that the tenths digit never visibly skips. */
const TICK_MS = 50;
const URGENT_SECONDS = 5;
const LEADERBOARD_ROWS = 5;
/** Matches the opacity transition on #splash in index.html. */
const SPLASH_FADE_MS = 700;
/** A shade deeper than the sky's zenith (#4f9de0), so the icon matches the sky but still stands out against it. */
const MUTE_ICON_COLOR = '#3b87cf';

function MuteButton({muted, blocked, onToggle}: {muted: boolean; blocked: boolean; onToggle: () => void}) {
  const Icon = muted || blocked ? VolumeX : Volume2;
  const label = blocked ? 'Click to turn on music' : muted ? 'Unmute music' : 'Mute music';
  // While the browser blocks audio, the press itself unlocks it (BackgroundMusic listens for pointerdown), which
  // clears `blocked` before the click lands. Remember the state at press time so that click does not also mute.
  const unlockingPress = useRef(false);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={muted}
      title={label}
      onPointerDown={() => {
        unlockingPress.current = blocked;
      }}
      // Blur straight away so Space or Enter on the result screen restarts the round instead of toggling music.
      onClick={(e) => {
        if (!blocked && !unlockingPress.current) onToggle();
        unlockingPress.current = false;
        e.currentTarget.blur();
      }}
      className={`fixed right-4 z-[61] flex h-10 items-center justify-center gap-2 rounded-full bg-white/75 shadow-md shadow-sky-900/20 backdrop-blur-sm transition hover:bg-white/95 sm:right-8 ${
        // Below `sm` the HUD stacks the countdown above the controls, so the bar is taller.
        'top-[calc(7rem+env(safe-area-inset-top,0px))] sm:top-[calc(4.25rem+env(safe-area-inset-top,0px))]'
      } ${blocked ? 'pl-4 pr-3' : 'w-10'}`}
      style={{color: MUTE_ICON_COLOR}}>
      {/* Chrome ignores Shift when deciding whether a page may play sound, so a Shift-only player needs this hint. */}
      {blocked && <span className="text-sm font-bold">{IS_TOUCH_DEVICE ? 'Tap' : 'Click'} for music</span>}
      <Icon size={22} strokeWidth={2.5} />
    </button>
  );
}

/** Sits over the splash art: a loading note, then the start prompt. Clicking anywhere on it also starts. */
function SplashPrompt({ready, onStart}: {ready: boolean; onStart: () => void}) {
  return (
    <div
      className={`fixed inset-0 z-[60] flex items-end justify-center px-4 pb-[8vh] font-fun text-white ${
        ready ? 'cursor-pointer' : ''
      }`}
      onClick={ready ? onStart : undefined}>
      <div
        className={`text-center text-3xl tracking-wide sm:text-5xl ${ready ? 'animate-blink-slow' : 'opacity-80'}`}
        style={outline('#1e3a8a', '0.18em')}>
        {ready ? (IS_TOUCH_DEVICE ? 'Tap to start' : 'Press Space to start') : 'Loading…'}
      </div>
    </div>
  );
}

type Status = 'READY' | 'PLAYING' | 'CAUGHT_ALL' | 'TIME_UP';
type Side = 'left' | 'right';

/** A random park corner, facing one of the two neighbouring corners. */
function randomCornerSpawn() {
  const x = (Math.random() < 0.5 ? -1 : 1) * SPAWN_INSET;
  const z = (Math.random() < 0.5 ? -1 : 1) * SPAWN_INSET;
  const alongX = Math.random() < 0.5;
  const dx = alongX ? -2 * x : 0;
  const dz = alongX ? 0 : -2 * z;
  // Forward is (-sin yaw, -cos yaw), so this yaw points at the chosen corner.
  return {x, y: EYE_HEIGHT, z, yaw: Math.atan2(-dx, -dz), pitch: 0};
}

function startingKids() {
  return KIDS_CONFIG.map((k) => ({x: k.initialPos[0], y: k.initialPos[1], z: k.initialPos[2], isFrozen: false}));
}

/** The control hint: a Shift keycap on desktop, a "tap" keycap of the same look on touch screens. */
function ShiftKey({pressed}: {pressed: boolean}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-sm font-bold transition-all ${
        pressed
          ? 'translate-y-px border-cyan-200 bg-cyan-300 text-slate-900 shadow-[0_1px_0_#0e7490]'
          : 'border-white/70 bg-white/90 text-slate-900 shadow-[0_3px_0_#94a3b8]'
      }`}>
      {IS_TOUCH_DEVICE ? (
        'tap'
      ) : (
        <>
          <span aria-hidden>⇧</span>
          shift
        </>
      )}
    </span>
  );
}

function SideControl({side, pressed}: {side: Side; pressed: boolean}) {
  const arrow = side === 'left' ? <ArrowLeft size={22} strokeWidth={2.5} /> : <ArrowRight size={22} strokeWidth={2.5} />;
  return (
    <div className={`flex shrink-0 items-center gap-2 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
      <span className={pressed ? 'text-cyan-300' : 'text-white/90'}>{arrow}</span>
      <span className={`flex items-center gap-1.5 ${side === 'right' ? 'flex-row-reverse' : ''}`}>
        <ShiftKey pressed={pressed} />
        <span className="text-sm font-semibold text-white/90">{side}</span>
      </span>
    </div>
  );
}

function outline(color: string, width: string) {
  // paint-order puts the stroke behind the fill, so the outline thickens the letters instead of eating into them.
  return {WebkitTextStroke: `${width} ${color}`, paintOrder: 'stroke fill'} as const;
}

/** Seconds to one decimal, rounded up so the clock reads 20.0 at the start and only shows 0.0 once time is up. */
function formatSeconds(seconds: number) {
  return (Math.ceil(seconds * 10 - 1e-6) / 10).toFixed(1);
}

/** Top scores by time left, with the player's own place when they are outside the list. */
function LeaderboardPanel({data}: {data: LeaderboardData | null}) {
  const top = data?.top.slice(0, LEADERBOARD_ROWS) ?? [];
  const me = data?.me;
  return (
    <div className="w-full max-w-xs rounded-2xl bg-black/45 px-4 py-3 text-base tracking-wide sm:text-xl">
      <div className="mb-1 text-center text-lg text-yellow-300 sm:text-2xl">Fastest catches</div>
      {data === null ? (
        <div className="text-center opacity-80">Loading…</div>
      ) : top.length === 0 ? (
        <div className="text-center opacity-80">No scores yet</div>
      ) : (
        <ol className="space-y-0.5">
          {top.map((entry, index) => (
            <li
              key={entry.username}
              className={`flex justify-between gap-3 ${me?.rank === index + 1 ? 'text-cyan-300' : ''}`}>
              <span className="truncate">
                {index + 1}. {entry.username}
              </span>
              <span className="tabular-nums">{entry.seconds.toFixed(1)}s</span>
            </li>
          ))}
        </ol>
      )}
      {me && me.rank > LEADERBOARD_ROWS && (
        <div className="mt-1 flex justify-between gap-3 border-t border-white/30 pt-1 text-cyan-300">
          <span>You: #{me.rank}</span>
          <span className="tabular-nums">{me.seconds.toFixed(1)}s</span>
        </div>
      )}
    </div>
  );
}

function ResultScreen({won, secondsLeft, board}: {won: boolean; secondsLeft: number; board?: LeaderboardData | null | undefined}) {
  const stroke = won ? '#1e3a8a' : '#7f1d1d';
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 px-4 text-center font-fun text-white">
      <div
        className="animate-blink-slow text-7xl leading-none tracking-wide drop-shadow-[0_6px_0_rgba(0,0,0,0.25)] sm:text-9xl"
        style={outline(stroke, '0.12em')}>
        {won ? 'You Win!' : 'You Lost!'}
      </div>
      {won && (
        <div className="text-3xl tracking-wide sm:text-5xl" style={outline(stroke, '0.16em')}>
          with <span className="tabular-nums">{formatSeconds(secondsLeft)}</span> seconds to spare!
        </div>
      )}
      {board !== undefined && <LeaderboardPanel data={board} />}
      <div className="text-2xl tracking-wide sm:text-3xl" style={outline(stroke, '0.18em')}>
        {IS_TOUCH_DEVICE ? 'Tap to continue' : 'Press any key to continue'}
      </div>
    </div>
  );
}

function StatusLine({secondsLeft, kidsLeft, playing}: {secondsLeft: number; kidsLeft: number; playing: boolean}) {
  const urgent = playing && secondsLeft <= URGENT_SECONDS;
  const count = <span className="tabular-nums font-black text-red-500">{kidsLeft}</span>;
  return (
    <>
      <span className={`tabular-nums font-black text-red-500 ${urgent ? 'animate-pulse' : ''}`}>
        {formatSeconds(secondsLeft)}
      </span>{' '}
      seconds to catch{' '}
      {kidsLeft === KIDS_CONFIG.length ? (
        <>all {count} kids!</>
      ) : kidsLeft === 1 ? (
        <>the last kid!</>
      ) : (
        <>{count} more kids!</>
      )}
    </>
  );
}

export default function App({leaderboard}: {leaderboard?: LeaderboardApi}) {
  const timeLimit = getConfig('timeLimit');
  const [status, setStatus] = useState<Status>('READY');
  const [timeRemaining, setTimeRemaining] = useState(timeLimit);
  const [frozenKids, setFrozenKids] = useState<boolean[]>(() => KIDS_CONFIG.map(() => false));
  const [pressed, setPressed] = useState<Record<Side, boolean>>({left: false, right: false});
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [board, setBoard] = useState<LeaderboardData | null>(null);
  // Once the first round starts the music keeps going through results and restarts.
  const [musicStarted, setMusicStarted] = useState(false);
  const [musicMuted, setMusicMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const endedAt = useRef(0);

  const toggleMusic = useCallback(() => setMusicMuted((muted) => !muted), []);
  const handleReady = useCallback(() => setReady(true), []);

  const playerPosRef = useRef(randomCornerSpawn());
  const kidsPosRef = useRef(startingKids());

  // The clock reads real elapsed time rather than counting interval ticks, which drift visibly once tenths show.
  const roundStartedAt = useRef(0);
  const roundOverRef = useRef(true);
  const secondsLeftNow = useCallback(
    () => Math.max(0, timeLimit - (performance.now() - roundStartedAt.current) / 1000),
    [timeLimit],
  );

  const startRound = useCallback(() => {
    playerPosRef.current = randomCornerSpawn();
    kidsPosRef.current = startingKids();
    setFrozenKids(KIDS_CONFIG.map(() => false));
    setBoard(null);
    roundStartedAt.current = performance.now();
    roundOverRef.current = false;
    setTimeRemaining(timeLimit);
    setStatus('PLAYING');
    setMusicStarted(true);
  }, [timeLimit]);

  const endRound = useCallback(
    (result: Status) => {
      // The last catch and the clock running out can land on the same tick; the first one decides the round.
      if (roundOverRef.current) return;
      roundOverRef.current = true;
      endedAt.current = performance.now();
      setTimeRemaining(result === 'TIME_UP' ? 0 : secondsLeftNow());
      setStatus(result);
    },
    [secondsLeftNow],
  );

  // The splash lives in index.html so it shows while the bundle downloads. Once the scene is ready, Space fades it
  // out and the clock starts the moment it is gone. Space rather than Shift: Chrome ignores modifier keys when
  // deciding whether a page may play sound, so only a key like Space lets the music start with the round.
  const leaveSplash = useCallback(() => {
    setStarted(true);
    setMusicStarted(true);
    const splash = document.getElementById('splash');
    splash?.classList.add('done');
    window.setTimeout(() => {
      splash?.remove();
      startRound();
    }, SPLASH_FADE_MS);
  }, [startRound]);

  // Fingers currently on the screen and the side each one holds; kept across re-subscriptions of the listeners below.
  const touchesRef = useRef(new Map<number, Side>());

  // Space leaves the splash. Shift steers (in Game). On the result screen any key starts the next round.
  useEffect(() => {
    const sideOf = (e: KeyboardEvent): Side | null =>
      e.code === 'ShiftLeft' ? 'left' : e.code === 'ShiftRight' ? 'right' : null;
    const onDown = (e: KeyboardEvent) => {
      const side = sideOf(e);
      if (side) setPressed((p) => (p[side] ? p : {...p, [side]: true}));
      if (e.repeat || !ready) return;
      if (!started) {
        if (e.code === 'Space') leaveSplash();
        return;
      }
      if ((status === 'CAUGHT_ALL' || status === 'TIME_UP') && performance.now() - endedAt.current > RESTART_DELAY_MS) {
        startRound();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const side = sideOf(e);
      if (!side) return;
      // Same Windows quirk as the steering: with no Shift down any more, clear both keycaps.
      setPressed((p) => (e.getModifierState('Shift') ? {...p, [side]: false} : {left: false, right: false}));
    };
    // Touch screens: light the side being held, and a tap on the result screen starts the next round.
    const touches = touchesRef.current;
    const onPointerDown = (e: PointerEvent) => {
      const side = touchSide(e);
      if (!side) return;
      touches.set(e.pointerId, side);
      setPressed((p) => (p[side] ? p : {...p, [side]: true}));
      if ((status === 'CAUGHT_ALL' || status === 'TIME_UP') && performance.now() - endedAt.current > RESTART_DELAY_MS) {
        startRound();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      const side = touches.get(e.pointerId);
      if (!side) return;
      touches.delete(e.pointerId);
      if (![...touches.values()].includes(side)) setPressed((p) => ({...p, [side]: false}));
    };
    const onBlur = () => {
      touches.clear();
      setPressed({left: false, right: false});
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [status, startRound, ready, started, leaveSplash]);

  useEffect(() => {
    if (status === 'CAUGHT_ALL') gameAudio.playVictoryFanfare();
    if (status === 'TIME_UP') gameAudio.playDefeatMotif();
  }, [status]);

  useEffect(() => {
    if (!leaderboard || (status !== 'CAUGHT_ALL' && status !== 'TIME_UP')) return;
    let stale = false;
    const request = status === 'CAUGHT_ALL' ? leaderboard.submit(timeRemaining) : leaderboard.load();
    request.then((data) => !stale && setBoard(data)).catch(() => {});
    return () => {
      stale = true;
    };
  }, [leaderboard, status, timeRemaining]);

  const handleFreezeKid = useCallback(
    (index: number) => {
      setFrozenKids((previous) => {
        if (previous[index]) return previous;
        const next = [...previous];
        next[index] = true;
        if (next.every(Boolean)) endRound('CAUGHT_ALL');
        return next;
      });
    },
    [endRound],
  );

  useEffect(() => {
    if (status !== 'PLAYING') return;
    const timer = setInterval(() => {
      const left = secondsLeftNow();
      if (left === 0) endRound('TIME_UP');
      else setTimeRemaining(left);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [status, endRound, secondsLeftNow]);

  const secondsLeft = timeRemaining;
  const roundOver = status === 'CAUGHT_ALL' || status === 'TIME_UP';

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-zinc-950 font-sans text-white touch-none">
      <BackgroundMusic
        url={getConfig('backgroundMusicUrl')}
        isPlaying={musicStarted}
        isMuted={musicMuted}
        volume={getConfig('defaultMusicVolume')}
        onBlockedChange={setAudioBlocked}
        preparedLoop={MUSIC_LOOP}
      />
      {/* The splash is outside the React tree at z-50, so the prompt and the mute button go in a layer above it. */}
      {createPortal(
        <>
          {!started && <SplashPrompt ready={ready} onStart={leaveSplash} />}
          <MuteButton muted={musicMuted} blocked={started && audioBlocked && !musicMuted} onToggle={toggleMusic} />
        </>,
        document.body,
      )}

      <div className="absolute inset-0">
        <Game
          isPlaying={status === 'PLAYING'}
          isPaused={false}
          frozenKids={frozenKids}
          setFrozenKids={setFrozenKids}
          onFreezeKid={handleFreezeKid}
          playerPosRef={playerPosRef}
          kidsPosRef={kidsPosRef}
          onReady={handleReady}
        />
      </div>

      {/* The outcome washes over the scene: pale blue for catching everyone, pale red for running out of time. */}
      <div
        className={`pointer-events-none absolute inset-0 z-[5] transition-opacity duration-500 ${
          status === 'CAUGHT_ALL' ? 'bg-sky-200/40' : 'bg-red-300/35'
        } ${roundOver ? 'opacity-100' : 'opacity-0'}`}
      />

      {roundOver ? (
        <ResultScreen won={status === 'CAUGHT_ALL'} secondsLeft={secondsLeft} board={leaderboard ? board : undefined} />
      ) : (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-black/35 px-4 py-3 backdrop-blur-sm sm:flex-nowrap sm:px-8"
          style={{paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))'}}>
          <SideControl side="left" pressed={pressed.left} />
          <div
            className="order-first min-w-0 basis-full text-center text-lg font-bold text-red-400 sm:order-none sm:flex-1 sm:basis-auto sm:text-2xl"
            style={outline('#000', '0.2em')}>
            <StatusLine
              secondsLeft={secondsLeft}
              kidsLeft={frozenKids.filter((frozen) => !frozen).length}
              playing={status === 'PLAYING'}
            />
          </div>
          <SideControl side="right" pressed={pressed.right} />
        </div>
      )}
    </div>
  );
}
