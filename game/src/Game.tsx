import {Canvas, useFrame, useLoader, useThree} from '@react-three/fiber';
import React, {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {KidCharacter, type KidName, preloadKids} from './components/KidCharacter';
import {getConfig} from './constants';
import {gameAudio} from './utils/helper';

export interface KidData {
  id: number;
  name: string;
  shirtColor: string;
  pantsColor: string;
  skinColor: string;
  hairColor: string;
  speedMultiplier: number;
  initialPos: [number, number, number];
}

export const KIDS_CONFIG: KidData[] = [
  {
    id: 1,
    name: 'Leo (Speedy)',
    shirtColor: '#ef4444', // Red
    pantsColor: '#1e3a8a',
    skinColor: '#fcd5b5',
    hairColor: '#451a03',
    speedMultiplier: 1.1,
    initialPos: [6, 0, -8],
  },
  {
    id: 2,
    name: 'Maya (Climber)',
    shirtColor: '#3b82f6', // Blue
    pantsColor: '#374151',
    skinColor: '#e0ac69',
    hairColor: '#171717',
    speedMultiplier: 0.95,
    initialPos: [-7, 0, -10],
  },
  {
    id: 3,
    name: 'Sam (Zigzag)',
    shirtColor: '#eab308', // Yellow
    pantsColor: '#1e40af',
    skinColor: '#fcd5b5',
    hairColor: '#d97706',
    speedMultiplier: 1.05,
    initialPos: [8, 0, 8],
  },
  {
    id: 4,
    name: 'Zoe (Dodger)',
    shirtColor: '#a855f7', // Purple
    pantsColor: '#047857',
    skinColor: '#8d5524',
    hairColor: '#0f172a',
    speedMultiplier: 1.0,
    initialPos: [-8, 0, 7],
  },
  {
    id: 5,
    name: 'Toby (Sneaky)',
    shirtColor: '#f97316', // Orange
    pantsColor: '#1f2937',
    skinColor: '#ffdbac',
    hairColor: '#78350f',
    speedMultiplier: 1.0,
    initialPos: [0, 0, -14],
  },
];

interface GameProps {
  isPlaying: boolean;
  isPaused: boolean;
  frozenKids: boolean[];
  setFrozenKids: React.Dispatch<React.SetStateAction<boolean[]>>;
  onFreezeKid: (index: number) => void;
  playerPosRef: React.MutableRefObject<{x: number; y: number; z: number; yaw: number; pitch: number}>;
  kidsPosRef: React.MutableRefObject<Array<{x: number; y: number; z: number; isFrozen: boolean}>>;
  /** Called once every model and texture has loaded and the scene has drawn. */
  onReady: () => void;
}

/** Frames to draw before reporting ready, so shader compiles happen behind the splash instead of as a visible stall. */
const WARMUP_FRAMES = 3;

// It sits inside the Suspense boundary, so it only mounts after every loader there has resolved.
function ReadySignal({onReady}: {onReady: () => void}) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === WARMUP_FRAMES) onReady();
  });
  return null;
}

// Scratch variables to avoid allocations in useFrame
const _tempForward = new THREE.Vector3();
const _tempKidDir = new THREE.Vector3();
const _tempToPlayer = new THREE.Vector3();

// Play Area Boundary
const HALF_PARK = 22; // -22 to 22 bounds

/** Obstacle definitions for player and kid collision resolution (radii and AABBs) */
interface CircleObstacle {
  x: number;
  z: number;
  radius: number;
}
interface BoxObstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const TREE_OBSTACLES: CircleObstacle[] = [
  {x: -15, z: -15, radius: 1.1},
  {x: 16, z: -16, radius: 1.1},
  {x: -17, z: 14, radius: 1.1},
  {x: 15, z: 16, radius: 1.1},
  {x: -14, z: -3, radius: 1.1},
  {x: 16, z: 4, radius: 1.1},
  {x: 0, z: -18, radius: 1.1},
  {x: 0, z: 18, radius: 1.1},
];

const PLAYGROUND_OBSTACLES: BoxObstacle[] = [
  // Tower 1 (at x=-2, z=-2, size 3x3)
  {minX: -3.8, maxX: -0.2, minZ: -3.8, maxZ: -0.2},
  // Tower 2 (at x=2.5, z=-1.5, size 3x3)
  {minX: 0.8, maxX: 4.2, minZ: -3.2, maxZ: 0.2},
  // Connecting Bridge (at x=0.25, z=-1.8, size 2x1.4)
  {minX: -1.0, maxX: 1.5, minZ: -2.7, maxZ: -0.9},
  // Yellow Slide (at x=-2, z=0.8, length ~3.2)
  {minX: -2.8, maxX: -1.2, minZ: -0.4, maxZ: 2.6},
  // Ladder Stairs (at x=-2, z=-4.2)
  {minX: -2.9, maxX: -1.1, minZ: -5.6, maxZ: -3.6},
  // Swing Set (at x=0, z=5, size ~6.8 x 2.2)
  {minX: -3.6, maxX: 3.6, minZ: 3.8, maxZ: 6.2},
  // Seesaw (at x=-8, z=0, length 4.4 x width 1.2)
  {minX: -10.4, maxX: -5.6, minZ: -0.8, maxZ: 0.8},
  // Sandbox (at x=8, z=-4, size 4.4 x 4.4)
  {minX: 5.6, maxX: 10.4, minZ: -6.4, maxZ: -1.6},
  // Benches (4 benches)
  {minX: -13.3, maxX: -10.7, minZ: -9.2, maxZ: -6.8},
  {minX: 10.7, maxX: 13.3, minZ: -9.2, maxZ: -6.8},
  {minX: -13.3, maxX: -10.7, minZ: 6.8, maxZ: 9.2},
  {minX: 10.7, maxX: 13.3, minZ: 6.8, maxZ: 9.2},
];

/**
 * Resolves 2D capsule/circle collision against all trees, playground structures, and benches.
 */
function resolveObstacleCollision(pos: {x: number; z: number}, bodyRadius = 0.5) {
  // 1. Check tree trunks (cylinder circle colliders)
  for (let i = 0; i < TREE_OBSTACLES.length; i++) {
    const tree = TREE_OBSTACLES[i];
    const dx = pos.x - tree.x;
    const dz = pos.z - tree.z;
    const distSq = dx * dx + dz * dz;
    const minDist = bodyRadius + tree.radius;
    if (distSq < minDist * minDist) {
      const dist = Math.sqrt(distSq) || 0.001;
      const push = minDist - dist;
      pos.x += (dx / dist) * push;
      pos.z += (dz / dist) * push;
    }
  }

  // 2. Check playground structures & benches (expanded AABBs)
  for (let i = 0; i < PLAYGROUND_OBSTACLES.length; i++) {
    const box = PLAYGROUND_OBSTACLES[i];
    const minX = box.minX - bodyRadius;
    const maxX = box.maxX + bodyRadius;
    const minZ = box.minZ - bodyRadius;
    const maxZ = box.maxZ + bodyRadius;

    if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
      const distLeft = pos.x - minX;
      const distRight = maxX - pos.x;
      const distBottom = pos.z - minZ;
      const distTop = maxZ - pos.z;

      const minDist = Math.min(distLeft, distRight, distBottom, distTop);
      if (minDist === distLeft) {
        pos.x = minX;
      } else if (minDist === distRight) {
        pos.x = maxX;
      } else if (minDist === distBottom) {
        pos.z = minZ;
      } else {
        pos.z = maxZ;
      }
    }
  }
}

const PARK_URL = `${import.meta.env.BASE_URL}assets/park.glb`;
const KID_NAMES: KidName[] = ['leo', 'maya', 'sam', 'zoe', 'toby'];

useLoader.preload(GLTFLoader, PARK_URL);
preloadKids(KID_NAMES);

/** Half the width of the grass beyond the fence. A multiple of the 6 m tile keeps the pattern continuous. */
const FAR_GROUND_HALF = 804;
const GRASS_TILE_METRES = 6;

/** Grass running from the fence to the horizon, with UVs that continue the park ground's tiling. */
function makeFarGround(material: THREE.Material) {
  const s = FAR_GROUND_HALF;
  const corners = [
    [-s, -s],
    [-s, s],
    [s, s],
    [s, -s],
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap(([x, z]) => [x, 0, z]), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(corners.flatMap(() => [0, 1, 0]), 3));
  // Matches the export of the park ground: u = x / tile, v = 1 + z / tile.
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(corners.flatMap(([x, z]) => [x / GRASS_TILE_METRES, 1 + z / GRASS_TILE_METRES]), 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new THREE.Mesh(geometry, material);
  // Just under the park ground, which covers it inside the fence.
  mesh.position.y = -0.02;
  return mesh;
}

/** The whole playground, exported from Blender. Collision stays in resolveObstacleCollision. */
function ParkScene() {
  const gltf = useLoader(GLTFLoader, PARK_URL);
  const farGround = useMemo(() => {
    let grass: THREE.MeshStandardMaterial | null = null;
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const isGround = mesh.name.startsWith('Ground') || mesh.name.startsWith('PlayArea');
      mesh.castShadow = !isGround;
      mesh.receiveShadow = true;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (material.name === 'Ground_Grass') grass = material;
    });
    const found = grass as unknown as THREE.MeshStandardMaterial;
    for (const map of [found.map, found.normalMap, found.roughnessMap]) {
      // Grass seen at a glancing angle blurs to mush without this.
      if (map) map.anisotropy = 8;
    }
    return makeFarGround(found);
  }, [gltf]);
  return (
    <>
      <primitive object={gltf.scene} />
      <primitive object={farGround} />
    </>
  );
}

const SKY_HORIZON = '#cfe6f2';
/** Beyond the far ground and inside the camera's far plane. Exactly at the far plane, triangles get clipped. */
const SKY_RADIUS = 1200;
const SKY_ZENITH = '#4f9de0';
/** Fog starts past the far corner of the park, so it only softens the land beyond the fence. */
const FOG_NEAR = 70;
const FOG_FAR = 650;

const SKY_VERTEX = `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = `
uniform float uTime;
uniform vec3 uHorizon;
uniform vec3 uZenith;
varying vec3 vDirection;

// No sin(): many GPUs, Direct3D among them, compute it loosely for large arguments,
// so neighbouring cells get unrelated values and the clouds break into hard squares.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 f = fract(p);
  // Wrapping the cell index keeps the hash inputs small. The repeat is far too large to notice.
  vec2 i = mod(floor(p), 289.0);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 right = mod(i + vec2(1.0, 0.0), 289.0);
  vec2 up = mod(i + vec2(0.0, 1.0), 289.0);
  vec2 corner = mod(i + vec2(1.0, 1.0), 289.0);
  return mix(mix(hash(i), hash(right), u.x), mix(hash(up), hash(corner), u.x), u.y);
}

// Each layer is turned against the last, so no grid direction survives into the cloud shapes.
const mat2 TURN = mat2(1.6, 1.2, -1.2, 1.6);

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 6; i++) {
    value += amplitude * noise(p);
    p = TURN * p + vec2(17.1, 9.2);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec3 direction = normalize(vDirection);
  float up = max(direction.y, 0.0);
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.55));
  // Project onto a flat cloud layer overhead, so clouds shrink and crowd toward the horizon.
  vec2 layer = direction.xz / (direction.y + 0.12) * 1.3 + vec2(uTime * 0.008, uTime * 0.003);
  float density = fbm(layer);
  float cover = smoothstep(0.48, 0.68, density);
  // Sampling a little toward the sun shades the far side, so clouds read as puffy, not as flat stickers.
  float toward = fbm(layer + vec2(0.18, 0.1));
  float light = clamp(0.62 + (density - toward) * 3.0, 0.0, 1.0);
  vec3 cloud = mix(vec3(0.74, 0.80, 0.88), vec3(1.0), light);
  float nearHorizon = smoothstep(0.02, 0.22, direction.y);
  vec3 color = mix(sky, cloud, cover * nearHorizon * 0.95);
  gl_FragColor = vec4(direction.y < 0.0 ? uHorizon : color, 1.0);
  #include <colorspace_fragment>
}
`;

/** Gradient sky with procedural clouds drifting across it. */
function SkyDome() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: {
          uTime: {value: 0},
          uHorizon: {value: new THREE.Color(SKY_HORIZON)},
          uZenith: {value: new THREE.Color(SKY_ZENITH)},
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({camera, clock}) => {
    material.uniforms.uTime.value = clock.getElapsedTime();
    meshRef.current?.position.copy(camera.position);
  });
  return (
    <mesh ref={meshRef} material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[SKY_RADIUS, 32, 16]} />
    </mesh>
  );
}

const ICE_BLOCKS_URL = `${import.meta.env.BASE_URL}assets/ice_blocks.glb`;
useLoader.preload(GLTFLoader, ICE_BLOCKS_URL);

/** Rough ice cubes formed around the frozen pose, built from that pose so they share the kid's origin. */
function IceBlock({isFrozen}: {isFrozen: boolean}) {
  const gltf = useLoader(GLTFLoader, ICE_BLOCKS_URL);
  const geometry = useMemo(() => {
    let found: THREE.BufferGeometry | null = null;
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) found = mesh.geometry;
    });
    return found as unknown as THREE.BufferGeometry;
  }, [gltf]);

  if (!isFrozen) return null;

  return (
    <mesh geometry={geometry}>
      <meshPhysicalMaterial
        color="#a5f3fc"
        transmission={0.8}
        opacity={0.85}
        transparent
        roughness={0.1}
        ior={1.31}
        thickness={0}
        flatShading
      />
    </mesh>
  );
}

/** Individual Kid Runner with flee AI */
function KidRunner({
  data,
  isFrozen,
  playerPosRef,
  kidsPosRef,
  index,
  isPlaying,
}: {
  data: KidData;
  isFrozen: boolean;
  playerPosRef: React.MutableRefObject<{x: number; y: number; z: number}>;
  kidsPosRef: React.MutableRefObject<Array<{x: number; y: number; z: number; isFrozen: boolean}>>;
  index: number;
  isPlaying: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3(...data.initialPos));
  const vel = useRef(new THREE.Vector3(0, 0, 0));
  const rotY = useRef(0);
  const wanderAngle = useRef(Math.random() * Math.PI * 2);
  const wanderTimer = useRef(0);
  const [animState, setAnimState] = useState<'idle' | 'walk' | 'run'>('run');

  useEffect(() => {
    pos.current.set(...data.initialPos);
    vel.current.set(0, 0, 0);
  }, [data.initialPos]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    if (kidsPosRef.current[index]) {
      kidsPosRef.current[index].x = pos.current.x;
      kidsPosRef.current[index].y = pos.current.y;
      kidsPosRef.current[index].z = pos.current.z;
      kidsPosRef.current[index].isFrozen = isFrozen;
    }

    if (!groupRef.current) return;

    if (isFrozen || !isPlaying) {
      if (animState !== 'idle') setAnimState('idle');
      groupRef.current.position.copy(pos.current);
      groupRef.current.rotation.y = rotY.current;
      return;
    }

    const pPos = playerPosRef.current;
    _tempToPlayer.set(pos.current.x - pPos.x, 0, pos.current.z - pPos.z);
    const distToPlayer = _tempToPlayer.length();

    const baseSpeed = getConfig('kidFleeSpeed') * data.speedMultiplier;

    wanderTimer.current -= dt;
    if (wanderTimer.current <= 0) {
      wanderTimer.current = 1.0 + Math.random() * 2.0;
      wanderAngle.current += (Math.random() - 0.5) * 1.5;
    }

    if (distToPlayer < 9.5) {
      _tempToPlayer.normalize();
      const zigzag = Math.sin(Date.now() * 0.006 + data.id) * 0.4;
      _tempKidDir.set(
        _tempToPlayer.x * Math.cos(zigzag) - _tempToPlayer.z * Math.sin(zigzag),
        0,
        _tempToPlayer.x * Math.sin(zigzag) + _tempToPlayer.z * Math.cos(zigzag)
      );
      vel.current.copy(_tempKidDir).multiplyScalar(baseSpeed * 1.15);
      if (animState !== 'run') setAnimState('run');
    } else {
      const dirX = Math.sin(wanderAngle.current);
      const dirZ = Math.cos(wanderAngle.current);
      vel.current.set(dirX, 0, dirZ).multiplyScalar(baseSpeed * 0.6);
      if (animState !== 'walk') setAnimState('walk');
    }

    const limit = HALF_PARK - 2.5;
    if (pos.current.x > limit) vel.current.x -= 8;
    if (pos.current.x < -limit) vel.current.x += 8;
    if (pos.current.z > limit) vel.current.z -= 8;
    if (pos.current.z < -limit) vel.current.z += 8;

    const distCenter = Math.hypot(pos.current.x, pos.current.z);
    if (distCenter < 3.8) {
      vel.current.x += (pos.current.x / (distCenter + 0.1)) * 6;
      vel.current.z += (pos.current.z / (distCenter + 0.1)) * 6;
    }

    pos.current.x += vel.current.x * dt;
    pos.current.z += vel.current.z * dt;

    // Resolve Kid vs Kid collision (prevent blending into each other)
    const kidRadius = 0.45;
    for (let j = 0; j < kidsPosRef.current.length; j++) {
      if (j === index) continue;
      const other = kidsPosRef.current[j];
      const dx = pos.current.x - other.x;
      const dz = pos.current.z - other.z;
      const distSq = dx * dx + dz * dz;
      const minDist = other.isFrozen ? 1.15 : kidRadius * 2; // 0.9m between runners, wider for ice cube
      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.001;
        const push = minDist - dist;
        if (other.isFrozen) {
          pos.current.x += (dx / dist) * push;
          pos.current.z += (dz / dist) * push;
        } else {
          pos.current.x += (dx / dist) * (push * 0.5);
          pos.current.z += (dz / dist) * (push * 0.5);
        }
      }
    }

    // Resolve Kid vs Chaser (player) collision
    const pDx = pos.current.x - pPos.x;
    const pDz = pos.current.z - pPos.z;
    const pDistSq = pDx * pDx + pDz * pDz;
    const minPlayerDist = 1.0; // 0.55 player + 0.45 kid
    if (pDistSq < minPlayerDist * minPlayerDist) {
      const pDist = Math.sqrt(pDistSq) || 0.001;
      const pPush = minPlayerDist - pDist;
      pos.current.x += (pDx / pDist) * pPush;
      pos.current.z += (pDz / pDist) * pPush;
    }

    resolveObstacleCollision(pos.current, 0.45);

    pos.current.x = THREE.MathUtils.clamp(pos.current.x, -limit, limit);
    pos.current.z = THREE.MathUtils.clamp(pos.current.z, -limit, limit);

    if (vel.current.lengthSq() > 0.1) {
      const targetRot = Math.atan2(vel.current.x, vel.current.z) + Math.PI;
      const turn = THREE.MathUtils.euclideanModulo(targetRot - rotY.current + Math.PI, Math.PI * 2) - Math.PI;
      rotY.current += THREE.MathUtils.clamp(turn, -10 * dt, 10 * dt);
    }

    groupRef.current.position.copy(pos.current);
    groupRef.current.rotation.y = rotY.current;
  });

  return (
    <group ref={groupRef} position={data.initialPos}>
      <KidCharacter name={KID_NAMES[index]} state={animState} frozen={isFrozen} />
      <IceBlock isFrozen={isFrozen} />
    </group>
  );
}

/** Freeze Aura Circle on Ground around Tagger */
function FreezeAuraVisual({playerPosRef}: {playerPosRef: React.MutableRefObject<{x: number; z: number}>}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const radius = getConfig('freezeRadius');

  useFrame(({clock}) => {
    if (!meshRef.current) return;
    meshRef.current.position.set(playerPosRef.current.x, 0.05, playerPosRef.current.z);
    const t = clock.getElapsedTime();
    meshRef.current.rotation.z = t * 1.5;
    const pulse = 1.0 + Math.sin(t * 6.0) * 0.05;
    meshRef.current.scale.set(pulse, pulse, pulse);
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius * 0.9, radius, 48]} />
      <meshBasicMaterial
        color="#38bdf8"
        transparent
        opacity={0.7}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Keyboard-Only Shift-Steering Auto-Forward Controller:
 * Always drives forward. Left Shift turns left, Right Shift turns right.
 * Proximity within freeze radius automatically tags runners.
 */
function ShiftSteeringController({
  isPlaying,
  isPaused,
  playerPosRef,
  kidsPosRef,
  onFreezeKid,
}: {
  isPlaying: boolean;
  isPaused: boolean;
  playerPosRef: React.MutableRefObject<{x: number; y: number; z: number; yaw: number; pitch: number}>;
  kidsPosRef: React.MutableRefObject<Array<{x: number; y: number; z: number; isFrozen: boolean}>>;
  onFreezeKid: (idx: number) => void;
}) {
  const {camera} = useThree();
  const keys = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Capture Left Shift and Right Shift specifically by code
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        e.preventDefault();
        keys.current[e.code] = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        keys.current[e.code] = false;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const stepTimer = useRef(0);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    if (!isPlaying || isPaused) {
      // Between rounds there is no menu, so hold the view at the player's spot instead of a default camera.
      camera.position.set(playerPosRef.current.x, 1.6, playerPosRef.current.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(-0.06, playerPosRef.current.yaw, 0);
      return;
    }

    const turnRate = getConfig('playerTurnRate');
    let turnInput = 0;
    if (keys.current['ShiftLeft']) turnInput += 1; // Turn Left
    if (keys.current['ShiftRight']) turnInput -= 1; // Turn Right

    playerPosRef.current.yaw += turnInput * turnRate * dt;

    // Always moving forward in direction of yaw
    const forwardSpeed = getConfig('playerSpeed');
    const yaw = playerPosRef.current.yaw;

    // In Three.js -Z is forward
    _tempForward.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();

    playerPosRef.current.x += _tempForward.x * forwardSpeed * dt;
    playerPosRef.current.z += _tempForward.z * forwardSpeed * dt;

    // Footstep rhythm
    stepTimer.current += dt * 2.2;
    if (stepTimer.current >= 1.0) {
      stepTimer.current = 0;
      gameAudio.playFootstepWood();
    }

    // Resolve collision against kids and frozen statues (cannot run through them)
    const playerRadius = 0.55;
    for (let k = 0; k < kidsPosRef.current.length; k++) {
      const kid = kidsPosRef.current[k];
      const kx = kid.x;
      const kz = kid.z;
      const dx = playerPosRef.current.x - kx;
      const dz = playerPosRef.current.z - kz;
      const distSq = dx * dx + dz * dz;
      const minKidDist = kid.isFrozen ? 1.15 : (playerRadius + 0.45);
      if (distSq < minKidDist * minKidDist) {
        const dist = Math.sqrt(distSq) || 0.001;
        const push = minKidDist - dist;
        playerPosRef.current.x += (dx / dist) * push;
        playerPosRef.current.z += (dz / dist) * push;
      }
    }

    // Resolve collision against obstacles
    resolveObstacleCollision(playerPosRef.current, 0.55);

    // Fence bounds
    const maxBound = HALF_PARK - 1.2;
    playerPosRef.current.x = THREE.MathUtils.clamp(playerPosRef.current.x, -maxBound, maxBound);
    playerPosRef.current.z = THREE.MathUtils.clamp(playerPosRef.current.z, -maxBound, maxBound);

    // Camera mounted at FPS height
    camera.position.set(playerPosRef.current.x, 1.6, playerPosRef.current.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = -0.06; // slight downward tilt to see runners and freeze aura
    camera.rotation.z = THREE.MathUtils.lerp(
      camera.rotation.z,
      turnInput * -0.06,
      8 * dt
    ); // dynamic bank roll on turn

    // Freeze Radius Check (Automatic tag when within freeze radius)
    const radius = getConfig('freezeRadius');
    kidsPosRef.current.forEach((k, idx) => {
      if (k.isFrozen) return;
      const dist = Math.hypot(k.x - playerPosRef.current.x, k.z - playerPosRef.current.z);
      if (dist <= radius) {
        onFreezeKid(idx);
        gameAudio.playArcadeLaser();
        gameAudio.playChiptuneExplosion();
        gameAudio.playPowerupChime();
      }
    });
  });

  return null;
}

/** In-game Directional Sun following Player */
function DynamicSun({playerPosRef}: {playerPosRef: React.MutableRefObject<{x: number; z: number}>}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    if (!lightRef.current) return;
    lightRef.current.position.set(
      playerPosRef.current.x + 15,
      25,
      playerPosRef.current.z + 15
    );
    lightRef.current.target.position.set(
      playerPosRef.current.x,
      0,
      playerPosRef.current.z
    );
    lightRef.current.target.updateMatrixWorld();
  });

  return (
    <directionalLight
      ref={lightRef}
      intensity={getConfig('sunIntensity')}
      color={getConfig('sunColor')}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-near={0.5}
      shadow-camera-far={60}
      shadow-camera-left={-26}
      shadow-camera-right={26}
      shadow-camera-top={26}
      shadow-camera-bottom={-26}
      shadow-bias={-0.0005}
    />
  );
}

/** Floating atmospheric particles */
function AtmosphericPollen() {
  const count = 75;
  const particles = useMemo(() => {
    return Array.from({length: count}, () => ({
      x: (Math.random() - 0.5) * 44,
      y: 0.5 + Math.random() * 6,
      z: (Math.random() - 0.5) * 44,
      speed: 0.3 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
    }));
  }, []);

  const groupRef = useRef<THREE.Group>(null);

  useFrame(({clock}) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.children.forEach((child, i) => {
      const p = particles[i];
      child.position.y = p.y + Math.sin(t * p.speed + p.phase) * 0.4;
    });
  });

  return (
    <group ref={groupRef}>
      {particles.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[0.06, 6, 6]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

// Reported by Chromium browsers only, and capped at 8. Elsewhere the higher limit applies.
const DEVICE_MEMORY_GB = (navigator as Navigator & {deviceMemory?: number}).deviceMemory ?? 8;
const MAX_PIXEL_RATIO: [number, number] = [1, DEVICE_MEMORY_GB <= 4 ? 1 : 1.5];

export function Game({
  isPlaying,
  isPaused,
  frozenKids,
  setFrozenKids,
  onFreezeKid,
  playerPosRef,
  kidsPosRef,
  onReady,
}: GameProps) {
  return (
    <div className="w-full h-full relative canvas-wrapper">
      <Canvas
        shadows="percentage"
        dpr={MAX_PIXEL_RATIO}
        onCreated={({gl}) => {
          // The ice pass redraws the whole scene into its own buffer. Below this, the frozen kid looks blurred.
          gl.transmissionResolutionScale = DEVICE_MEMORY_GB <= 4 ? 0.5 : 0.75;
        }}
        gl={{
          antialias: true,
          // The textures and lights are balanced to display as they are, without a filmic curve.
          toneMapping: THREE.NoToneMapping,
        }}
        camera={{
          fov: getConfig('fov'),
          near: 0.1,
          far: 2000,
          position: [0, 1.6, 12],
        }}
        scene={{
          background: new THREE.Color(SKY_HORIZON),
        }}
      >
        <fog attach="fog" args={[SKY_HORIZON, FOG_NEAR, FOG_FAR]} />
        <Suspense fallback={null}>
          <SkyDome />
          <ambientLight
            color={getConfig('ambientColor')}
            intensity={getConfig('ambientIntensity')}
          />
          <hemisphereLight
            color={getConfig('hemiSkyColor')}
            groundColor={getConfig('hemiGroundColor')}
            intensity={getConfig('hemiIntensity')}
          />
          <DynamicSun playerPosRef={playerPosRef} />

          <ParkScene />

          {KIDS_CONFIG.map((kid, idx) => (
            <KidRunner
              key={kid.id}
              data={kid}
              index={idx}
              isFrozen={frozenKids[idx]}
              playerPosRef={playerPosRef}
              kidsPosRef={kidsPosRef}
              isPlaying={isPlaying}
            />
          ))}

          {/* Freeze Aura ring around player */}
          <FreezeAuraVisual playerPosRef={playerPosRef} />

          {/* Shift Keys Steer Controller */}
          <ShiftSteeringController
            isPlaying={isPlaying}
            isPaused={isPaused}
            playerPosRef={playerPosRef}
            kidsPosRef={kidsPosRef}
            onFreezeKid={onFreezeKid}
          />

          <AtmosphericPollen />
          <ReadySignal onReady={onReady} />
        </Suspense>
      </Canvas>
    </div>
  );
}
