import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {Bloom, EffectComposer} from '@react-three/postprocessing';
import {
  CuboidCollider,
  Physics,
  type RapierRigidBody,
  RigidBody,
} from '@react-three/rapier';
import React, {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import * as THREE from 'three';
import {HumanoidCharacter} from './components/HumanoidCharacter';
import {getConfig} from './constants';
import {gameAudio} from './utils/helper';
import {createProceduralTexture} from './utils';

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
  {minX: -13.3, maxX: -10.7, minZ: -8.8, maxZ: -7.2},
  {minX: 10.7, maxX: 13.3, minZ: -8.8, maxZ: -7.2},
  {minX: -13.3, maxX: -10.7, minZ: 7.2, maxZ: 8.8},
  {minX: 10.7, maxX: 13.3, minZ: 7.2, maxZ: 8.8},
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

/** Grass terrain with procedural noise texture */
function ParkGround() {
  const texture = useMemo(() => {
    return createProceduralTexture((ctx, w, h) => {
      ctx.fillStyle = '#417031';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 12000; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.fillStyle = Math.random() < 0.5 ? '#4d803a' : '#355e27';
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.22, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ca8a04';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.20, 0, Math.PI * 2);
      ctx.fill();
    }, 512);
  }, []);

  return (
    <RigidBody type="fixed" friction={1.2}>
      <mesh position={[0, -0.25, 0]} receiveShadow>
        <boxGeometry args={[48, 0.5, 48]} />
        <meshStandardMaterial map={texture} roughness={0.8} />
      </mesh>
    </RigidBody>
  );
}

/** Perimeter Chain-link & Wooden fence with invisible colliders */
function PerimeterFence() {
  const fencePostMat = useMemo(
    () => new THREE.MeshStandardMaterial({color: '#78350f', roughness: 0.9}),
    []
  );
  const fenceBarMat = useMemo(
    () => new THREE.MeshStandardMaterial({color: '#94a3b8', roughness: 0.4, metalness: 0.6}),
    []
  );

  return (
    <group>
      <CuboidCollider args={[24, 4, 1]} position={[0, 4, HALF_PARK + 1]} />
      <CuboidCollider args={[24, 4, 1]} position={[0, 4, -HALF_PARK - 1]} />
      <CuboidCollider args={[1, 4, 24]} position={[HALF_PARK + 1, 4, 0]} />
      <CuboidCollider args={[1, 4, 24]} position={[-HALF_PARK - 1, 4, 0]} />

      {[-HALF_PARK, HALF_PARK].map((z, idx) => (
        <group key={`fence-z-${idx}`} position={[0, 0, z]}>
          <mesh position={[0, 1.8, 0]} material={fenceBarMat} castShadow>
            <boxGeometry args={[HALF_PARK * 2 + 1, 0.1, 0.1]} />
          </mesh>
          <mesh position={[0, 0.9, 0]} material={fenceBarMat} castShadow>
            <boxGeometry args={[HALF_PARK * 2 + 1, 0.1, 0.1]} />
          </mesh>
          {[-20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20].map((x) => (
            <mesh key={`post-${x}`} position={[x, 1.0, 0]} material={fencePostMat} castShadow>
              <cylinderGeometry args={[0.15, 0.15, 2.0, 8]} />
            </mesh>
          ))}
        </group>
      ))}

      {[-HALF_PARK, HALF_PARK].map((x, idx) => (
        <group key={`fence-x-${idx}`} position={[x, 0, 0]}>
          <mesh position={[0, 1.8, 0]} material={fenceBarMat} castShadow>
            <boxGeometry args={[0.1, 0.1, HALF_PARK * 2 + 1]} />
          </mesh>
          <mesh position={[0, 0.9, 0]} material={fenceBarMat} castShadow>
            <boxGeometry args={[0.1, 0.1, HALF_PARK * 2 + 1]} />
          </mesh>
          {[-20, -16, -12, -8, -4, 0, 4, 8, 12, 16, 20].map((z) => (
            <mesh key={`post-z-${z}`} position={[0, 1.0, z]} material={fencePostMat} castShadow>
              <cylinderGeometry args={[0.15, 0.15, 2.0, 8]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Detailed Central Playground Equipment */
function PlaygroundSet() {
  const woodMat = useMemo(
    () => new THREE.MeshStandardMaterial({color: '#b45309', roughness: 0.85}),
    []
  );
  const yellowPlasticMat = useMemo(
    () => new THREE.MeshStandardMaterial({color: '#eab308', roughness: 0.3}),
    []
  );
  const redPlasticMat = useMemo(
    () => new THREE.MeshStandardMaterial({color: '#dc2626', roughness: 0.3}),
    []
  );
  const blueMetalMat = useMemo(
    () => new THREE.MeshStandardMaterial({color: '#2563eb', roughness: 0.4, metalness: 0.5}),
    []
  );

  return (
    <group position={[0, 0, 0]}>
      {/* Central Fort Tower 1 */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[-2, 1.4, -2]} material={woodMat} castShadow receiveShadow>
          <boxGeometry args={[3, 0.25, 3]} />
        </mesh>
        <mesh position={[-2, 3.8, -2]} material={redPlasticMat} castShadow>
          <coneGeometry args={[2.5, 1.2, 4]} />
        </mesh>
        <mesh position={[-3.3, 1.8, -3.3]} material={woodMat} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 3.6, 8]} />
        </mesh>
        <mesh position={[-0.7, 1.8, -3.3]} material={woodMat} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 3.6, 8]} />
        </mesh>
        <mesh position={[-3.3, 1.8, -0.7]} material={woodMat} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 3.6, 8]} />
        </mesh>
        <mesh position={[-0.7, 1.8, -0.7]} material={woodMat} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 3.6, 8]} />
        </mesh>
      </RigidBody>

      {/* Central Fort Tower 2 */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[2.5, 1.8, -1.5]} material={woodMat} castShadow receiveShadow>
          <boxGeometry args={[3, 0.25, 3]} />
        </mesh>
        <mesh position={[2.5, 4.2, -1.5]} material={blueMetalMat} castShadow>
          <coneGeometry args={[2.5, 1.2, 4]} />
        </mesh>
        <mesh position={[1.2, 2.0, -2.8]} material={woodMat} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 4.0, 8]} />
        </mesh>
        <mesh position={[3.8, 2.0, -2.8]} material={woodMat} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 4.0, 8]} />
        </mesh>
        <mesh position={[1.2, 2.0, -0.2]} material={woodMat} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 4.0, 8]} />
        </mesh>
        <mesh position={[3.8, 2.0, -0.2]} material={woodMat} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 4.0, 8]} />
        </mesh>
      </RigidBody>

      {/* Connecting Bridge */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[0.25, 1.5, -1.8]} material={woodMat} castShadow receiveShadow>
          <boxGeometry args={[2.0, 0.18, 1.4]} />
        </mesh>
        <mesh position={[0.25, 2.1, -1.1]} material={yellowPlasticMat} castShadow>
          <boxGeometry args={[2.0, 0.8, 0.1]} />
        </mesh>
        <mesh position={[0.25, 2.1, -2.5]} material={yellowPlasticMat} castShadow>
          <boxGeometry args={[2.0, 0.8, 0.1]} />
        </mesh>
      </RigidBody>

      {/* Yellow Slide */}
      <RigidBody type="fixed" colliders="cuboid">
        <group position={[-2, 0.8, 0.8]} rotation={[-0.45, 0, 0]}>
          <mesh material={yellowPlasticMat} castShadow receiveShadow>
            <boxGeometry args={[1.2, 0.15, 3.2]} />
          </mesh>
          <mesh position={[-0.6, 0.2, 0]} material={redPlasticMat}>
            <boxGeometry args={[0.1, 0.35, 3.2]} />
          </mesh>
          <mesh position={[0.6, 0.2, 0]} material={redPlasticMat}>
            <boxGeometry args={[0.1, 0.35, 3.2]} />
          </mesh>
        </group>
      </RigidBody>

      {/* Red Ladder Stairs */}
      <RigidBody type="fixed" colliders="cuboid">
        <group position={[-2, 0.7, -4.2]} rotation={[0.45, 0, 0]}>
          <mesh material={redPlasticMat} castShadow>
            <boxGeometry args={[1.4, 0.15, 2.5]} />
          </mesh>
        </group>
      </RigidBody>

      {/* Blue Swing Set */}
      <RigidBody type="fixed" colliders="cuboid">
        <group position={[0, 0, 5]}>
          <mesh position={[0, 3.2, 0]} material={blueMetalMat} castShadow>
            <boxGeometry args={[6.5, 0.15, 0.15]} />
          </mesh>
          <mesh position={[-3.1, 1.6, 0.8]} rotation={[-0.25, 0, 0]} material={blueMetalMat} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 3.4, 8]} />
          </mesh>
          <mesh position={[-3.1, 1.6, -0.8]} rotation={[0.25, 0, 0]} material={blueMetalMat} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 3.4, 8]} />
          </mesh>
          <mesh position={[3.1, 1.6, 0.8]} rotation={[-0.25, 0, 0]} material={blueMetalMat} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 3.4, 8]} />
          </mesh>
          <mesh position={[3.1, 1.6, -0.8]} rotation={[0.25, 0, 0]} material={blueMetalMat} castShadow>
            <cylinderGeometry args={[0.08, 0.08, 3.4, 8]} />
          </mesh>
          <mesh position={[-1.2, 0.6, 0]} material={redPlasticMat} castShadow>
            <boxGeometry args={[0.8, 0.08, 0.4]} />
          </mesh>
          <mesh position={[1.2, 0.6, 0]} material={yellowPlasticMat} castShadow>
            <boxGeometry args={[0.8, 0.08, 0.4]} />
          </mesh>
        </group>
      </RigidBody>

      {/* Seesaw */}
      <RigidBody type="fixed" colliders="cuboid">
        <group position={[-8, 0, 0]}>
          <mesh position={[0, 0.4, 0]} material={blueMetalMat} castShadow>
            <coneGeometry args={[0.4, 0.8, 6]} />
          </mesh>
          <mesh position={[0, 0.8, 0]} rotation={[0, 0, 0.2]} material={woodMat} castShadow>
            <boxGeometry args={[4.2, 0.15, 0.4]} />
          </mesh>
        </group>
      </RigidBody>

      {/* Sandbox */}
      <RigidBody type="fixed" colliders="cuboid">
        <group position={[8, 0, -4]}>
          <mesh position={[0, 0.2, 0]} material={woodMat} castShadow>
            <boxGeometry args={[4.2, 0.4, 4.2]} />
          </mesh>
          <mesh position={[0, 0.25, 0]}>
            <boxGeometry args={[3.8, 0.35, 3.8]} />
            <meshStandardMaterial color="#fcd34d" roughness={0.95} />
          </mesh>
        </group>
      </RigidBody>
    </group>
  );
}

/** Park Trees and Benches */
function ParkScenery() {
  const trunkMat = useMemo(
    () => new THREE.MeshStandardMaterial({color: '#5c4033', roughness: 0.9}),
    []
  );
  const foliageMat = useMemo(
    () => new THREE.MeshStandardMaterial({color: '#2e7d32', roughness: 0.85, flatShading: true}),
    []
  );
  const benchWood = useMemo(
    () => new THREE.MeshStandardMaterial({color: '#854d0e', roughness: 0.8}),
    []
  );
  const benchIron = useMemo(
    () => new THREE.MeshStandardMaterial({color: '#1e293b', roughness: 0.5, metalness: 0.8}),
    []
  );

  const treePositions: [number, number, number][] = [
    [-15, 0, -15],
    [16, 0, -16],
    [-17, 0, 14],
    [15, 0, 16],
    [-14, 0, -3],
    [16, 0, 4],
    [0, 0, -18],
    [0, 0, 18],
  ];

  const benchPositions: [number, number, number, number][] = [
    [-12, 0, -8, 0],
    [12, 0, -8, Math.PI],
    [-12, 0, 8, 0],
    [12, 0, 8, Math.PI],
  ];

  return (
    <group>
      {treePositions.map((pos, i) => (
        <RigidBody key={`tree-${i}`} type="fixed" position={pos} colliders="cuboid">
          <mesh position={[0, 2.0, 0]} material={trunkMat} castShadow>
            <cylinderGeometry args={[0.3, 0.45, 4.0, 8]} />
          </mesh>
          <mesh position={[0, 4.5, 0]} material={foliageMat} castShadow>
            <dodecahedronGeometry args={[2.2, 1]} />
          </mesh>
          <mesh position={[0.6, 5.5, 0.4]} material={foliageMat} scale={0.7} castShadow>
            <dodecahedronGeometry args={[2.0, 1]} />
          </mesh>
        </RigidBody>
      ))}

      {benchPositions.map(([x, y, z, rot], i) => (
        <RigidBody key={`bench-${i}`} type="fixed" position={[x, y, z]} rotation={[0, rot, 0]} colliders="cuboid">
          <mesh position={[-0.8, 0.25, 0]} material={benchIron} castShadow>
            <boxGeometry args={[0.1, 0.5, 0.6]} />
          </mesh>
          <mesh position={[0.8, 0.25, 0]} material={benchIron} castShadow>
            <boxGeometry args={[0.1, 0.5, 0.6]} />
          </mesh>
          <mesh position={[0, 0.45, 0]} material={benchWood} castShadow>
            <boxGeometry args={[2.0, 0.08, 0.6]} />
          </mesh>
          <mesh position={[0, 0.8, -0.28]} material={benchWood} castShadow>
            <boxGeometry args={[2.0, 0.4, 0.08]} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
}

/** Visual Freeze Ice Block when a kid is frozen */
function IceBlock({isFrozen}: {isFrozen: boolean}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({clock}) => {
    if (meshRef.current && isFrozen) {
      const t = clock.getElapsedTime();
      meshRef.current.rotation.y = Math.sin(t * 1.5) * 0.05;
    }
  });

  if (!isFrozen) return null;

  return (
    <group position={[0, 0.9, 0]}>
      <mesh ref={meshRef}>
        <boxGeometry args={[1.3, 1.9, 1.3]} />
        <meshPhysicalMaterial
          color="#a5f3fc"
          transmission={0.8}
          opacity={0.85}
          transparent
          roughness={0.1}
          ior={1.31}
          thickness={1.5}
        />
      </mesh>
      <mesh scale={1.1}>
        <octahedronGeometry args={[0.9, 0]} />
        <meshBasicMaterial color="#ffffff" wireframe />
      </mesh>
    </group>
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
      <group scale={[0.85, 0.85, 0.85]}>
        <HumanoidCharacter
          state={animState}
          skinColor={data.skinColor}
          clothesColor={data.shirtColor}
          pantsColor={data.pantsColor}
        />
      </group>
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
    if (!isPlaying || isPaused) return;

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
      shadow-camera-bottom={26}
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

export function Game({
  isPlaying,
  isPaused,
  frozenKids,
  setFrozenKids,
  onFreezeKid,
  playerPosRef,
  kidsPosRef,
}: GameProps) {
  return (
    <div className="w-full h-full relative canvas-wrapper">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        camera={{
          fov: getConfig('fov'),
          near: 0.1,
          far: 200,
          position: [0, 1.6, 12],
        }}
        scene={{
          background: new THREE.Color(getConfig('backgroundColor')),
        }}
      >
        <Suspense fallback={null}>
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

          <Physics gravity={[0, getConfig('gravity'), 0]} paused={isPaused}>
            <ParkGround />
            <PerimeterFence />
            <PlaygroundSet />
            <ParkScenery />

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
          </Physics>

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

          <EffectComposer>
            <Bloom luminanceThreshold={0.9} luminanceSmoothing={0.3} intensity={0.4} />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  );
}
