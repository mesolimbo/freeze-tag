import {ArrowLeft, ArrowRight} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {getConfig} from './constants';
import {Game, KIDS_CONFIG} from './Game';
import BackgroundMusic from './utils/BackgroundMusic';
import {gameAudio} from './utils/helper';

/** Distance of each spawn corner from the centre on both axes, inside the fence and clear of the corner trees. */
const SPAWN_INSET = 19;
const EYE_HEIGHT = 1.6;
/** After a round ends, ignore keys this long so a key still held from play does not skip the result. */
const RESTART_DELAY_MS = 900;
const TICK_MS = 100;
const URGENT_SECONDS = 5;

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

function ShiftKey({pressed}: {pressed: boolean}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-sm font-bold transition-all ${
        pressed
          ? 'translate-y-px border-cyan-200 bg-cyan-300 text-slate-900 shadow-[0_1px_0_#0e7490]'
          : 'border-white/70 bg-white/90 text-slate-900 shadow-[0_3px_0_#94a3b8]'
      }`}>
      <span aria-hidden>⇧</span>
      shift
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

function ResultScreen({won}: {won: boolean}) {
  const stroke = won ? '#1e3a8a' : '#7f1d1d';
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 px-4 text-center font-fun text-white">
      <div
        className="animate-blink-slow text-7xl leading-none tracking-wide drop-shadow-[0_6px_0_rgba(0,0,0,0.25)] sm:text-9xl"
        style={outline(stroke, '0.12em')}>
        {won ? 'You Win!' : 'You Lost!'}
      </div>
      <div className="text-2xl tracking-wide sm:text-3xl" style={outline(stroke, '0.18em')}>
        Press any key to continue
      </div>
    </div>
  );
}

function StatusLine({secondsLeft, playing}: {secondsLeft: number; playing: boolean}) {
  const urgent = playing && secondsLeft <= URGENT_SECONDS;
  return (
    <>
      <span className={`tabular-nums font-black text-red-500 ${urgent ? 'animate-pulse' : ''}`}>{secondsLeft}</span>{' '}
      {secondsLeft === 1 ? 'second' : 'seconds'} to catch all the kids!
    </>
  );
}

export default function App() {
  const timeLimit = getConfig('timeLimit');
  const [status, setStatus] = useState<Status>('READY');
  const [timeRemaining, setTimeRemaining] = useState(timeLimit);
  const [frozenKids, setFrozenKids] = useState<boolean[]>(() => KIDS_CONFIG.map(() => false));
  const [pressed, setPressed] = useState<Record<Side, boolean>>({left: false, right: false});
  const endedAt = useRef(0);

  const playerPosRef = useRef(randomCornerSpawn());
  const kidsPosRef = useRef(startingKids());

  const startRound = useCallback(() => {
    playerPosRef.current = randomCornerSpawn();
    kidsPosRef.current = startingKids();
    setFrozenKids(KIDS_CONFIG.map(() => false));
    setTimeRemaining(timeLimit);
    setStatus('PLAYING');
  }, [timeLimit]);

  const endRound = useCallback((result: Status) => {
    endedAt.current = performance.now();
    setStatus(result);
  }, []);

  // Shift starts a round and steers (in Game). On the result screen any key continues.
  useEffect(() => {
    const sideOf = (e: KeyboardEvent): Side | null =>
      e.code === 'ShiftLeft' ? 'left' : e.code === 'ShiftRight' ? 'right' : null;
    const onDown = (e: KeyboardEvent) => {
      const side = sideOf(e);
      if (side) setPressed((p) => (p[side] ? p : {...p, [side]: true}));
      if (e.repeat) return;
      if (status === 'READY' && side) startRound();
      if ((status === 'CAUGHT_ALL' || status === 'TIME_UP') && performance.now() - endedAt.current > RESTART_DELAY_MS) {
        startRound();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const side = sideOf(e);
      if (side) setPressed((p) => ({...p, [side]: false}));
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [status, startRound]);

  useEffect(() => {
    if (status === 'CAUGHT_ALL') gameAudio.playVictoryFanfare();
    if (status === 'TIME_UP') gameAudio.playDefeatMotif();
  }, [status]);

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
      setTimeRemaining((previous) => {
        const next = Math.max(0, previous - TICK_MS / 1000);
        if (next === 0) endRound('TIME_UP');
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [status, endRound]);

  const secondsLeft = Math.ceil(timeRemaining - 1e-6);
  const roundOver = status === 'CAUGHT_ALL' || status === 'TIME_UP';

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-zinc-950 font-sans text-white touch-none">
      <BackgroundMusic url={getConfig('backgroundMusicUrl')} isPlaying={status === 'PLAYING'} isMuted={false} />

      <div className="absolute inset-0">
        <Game
          isPlaying={status === 'PLAYING'}
          isPaused={false}
          frozenKids={frozenKids}
          setFrozenKids={setFrozenKids}
          onFreezeKid={handleFreezeKid}
          playerPosRef={playerPosRef}
          kidsPosRef={kidsPosRef}
        />
      </div>

      {/* The outcome washes over the scene: pale blue for catching everyone, pale red for running out of time. */}
      <div
        className={`pointer-events-none absolute inset-0 z-[5] transition-opacity duration-500 ${
          status === 'CAUGHT_ALL' ? 'bg-sky-200/40' : 'bg-red-300/35'
        } ${roundOver ? 'opacity-100' : 'opacity-0'}`}
      />

      {roundOver ? (
        <ResultScreen won={status === 'CAUGHT_ALL'} />
      ) : (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-black/35 px-4 py-3 backdrop-blur-sm sm:px-8"
          style={{paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))'}}>
          <SideControl side="left" pressed={pressed.left} />
          <div
            className="min-w-0 flex-1 text-center text-lg font-bold text-red-400 sm:text-2xl"
            style={outline('#000', '0.2em')}>
            <StatusLine secondsLeft={secondsLeft} playing={status === 'PLAYING'} />
          </div>
          <SideControl side="right" pressed={pressed.right} />
        </div>
      )}
    </div>
  );
}
