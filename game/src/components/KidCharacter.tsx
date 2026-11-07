import {useFrame, useLoader} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';

const ASSETS = `${import.meta.env.BASE_URL}assets/`;
const MODEL_URL = `${ASSETS}kid.glb`;

export type KidName = 'leo' | 'maya' | 'sam' | 'zoe' | 'toby';
export type KidState = 'idle' | 'walk' | 'run';

/** Clip playback that keeps feet near the ground speed without looking frantic. */
const CLIP_RATE: Record<KidState | 'frozen', number> = {idle: 1, walk: 1.5, run: 1.3, frozen: 1};
const CROSSFADE_SECONDS = 0.2;
/** A tag should read instantly. */
const FREEZE_SECONDS = 0.08;
/** Ice is shinier than cloth. */
const FROZEN_ROUGHNESS = 0.6;

function textureUrls(name: KidName): [string, string] {
  return [`${ASSETS}kid_${name}.webp`, `${ASSETS}kid_${name}_frozen.webp`];
}

export function preloadKids(names: KidName[]) {
  useLoader.preload(GLTFLoader, MODEL_URL);
  useLoader.preload(THREE.TextureLoader, names.flatMap(textureUrls));
}

interface KidCharacterProps {
  name: KidName;
  state: KidState;
  frozen: boolean;
}

/**
 * Rigged kid from kid.glb, sharing one mesh and skeleton definition across all kids.
 *
 * Faces -Z, the same as the HumanoidCharacter it replaces.
 */
export function KidCharacter({name, state, frozen}: KidCharacterProps) {
  const gltf = useLoader(GLTFLoader, MODEL_URL);
  const [map, frozenMap] = useLoader(THREE.TextureLoader, textureUrls(name));

  const {model, material, baseRoughness} = useMemo(() => {
    for (const texture of [map, frozenMap]) {
      // glTF UVs start at the top left, unlike the three.js texture default.
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    }
    const instance = clone(gltf.scene);
    let skinMaterial: THREE.MeshStandardMaterial | null = null;
    instance.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        skinMaterial = (mesh.material as THREE.MeshStandardMaterial).clone();
        skinMaterial.map = map;
        mesh.material = skinMaterial;
        mesh.castShadow = true;
        // Skinned bounds follow the rest pose, so a moving kid could be culled mid-stride.
        mesh.frustumCulled = false;
      }
    });
    const found = skinMaterial as unknown as THREE.MeshStandardMaterial;
    return {model: instance, material: found, baseRoughness: found.roughness};
  }, [gltf, map, frozenMap]);

  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  const actions = useMemo(() => {
    const byName = new Map<string, THREE.AnimationAction>();
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip);
      // A slight rate difference stops the kids moving in unison.
      action.setEffectiveTimeScale((CLIP_RATE[clip.name as KidState] ?? 1) * (0.94 + Math.random() * 0.12));
      byName.set(clip.name, action);
    }
    return byName;
  }, [gltf, mixer]);

  const current = useRef<THREE.AnimationAction | null>(null);
  const clipName = frozen ? 'frozen' : state;

  useEffect(() => {
    const next = actions.get(clipName);
    if (!next || current.current === next) return;
    next.reset().setEffectiveWeight(1);
    if (frozen) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
      // A random start means no two kids are ever on the same step.
      next.time = Math.random() * next.getClip().duration;
    }
    next.play();
    if (current.current) {
      next.crossFadeFrom(current.current, frozen ? FREEZE_SECONDS : CROSSFADE_SECONDS, true);
    }
    current.current = next;
    material.map = frozen ? frozenMap : map;
    material.roughness = frozen ? FROZEN_ROUGHNESS : baseRoughness;
  }, [actions, clipName, frozen, material, map, frozenMap, baseRoughness]);

  useEffect(() => {
    return () => {
      mixer.stopAllAction();
      material.dispose();
    };
  }, [mixer, material]);

  useFrame((_, delta) => {
    mixer.update(Math.min(delta, 0.05));
  });

  return <primitive object={model} />;
}
