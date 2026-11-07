import {MusicTrack} from './utils/helper';

/** Game configuration schema. */
export const CONFIG = {
  // --- Game ---
  title: {
    value: 'Park Freeze Tag',
    type: 'string',
    label: 'Game Title',
    group: 'Game',
  },

  // --- Rules ---
  timeLimit: {
    value: 20.0,
    type: 'number',
    label: 'Time Limit (Seconds)',
    group: 'Rules',
    min: 10,
    max: 40,
    step: 1,
  },
  playerSpeed: {
    value: 9.0,
    type: 'number',
    label: 'Player Auto-Run Speed',
    group: 'Physics',
    min: 5,
    max: 15,
    step: 0.5,
  },
  playerTurnRate: {
    value: 3.2,
    type: 'number',
    label: 'Player Turn Rate (Rad/s)',
    group: 'Physics',
    min: 1.5,
    max: 6.0,
    step: 0.2,
  },
  freezeRadius: {
    value: 4.2,
    type: 'number',
    label: 'Freeze Aura Radius',
    group: 'Rules',
    min: 2,
    max: 8,
    step: 0.2,
  },
  kidFleeSpeed: {
    value: 7.2,
    type: 'number',
    label: 'Kids Flee Speed',
    group: 'Physics',
    min: 4,
    max: 11,
    step: 0.2,
  },
  mouseSensitivity: {
    value: 1.0,
    type: 'number',
    label: 'Look Sensitivity',
    group: 'Controls',
    min: 0.2,
    max: 3.0,
    step: 0.1,
  },
  parkSize: {
    value: 48,
    type: 'number',
    label: 'Park Field Size',
    group: 'Rules',
    min: 30,
    max: 70,
    step: 2,
  },

  // --- Camera ---
  fov: {
    value: 75,
    type: 'number',
    label: 'Field of View',
    group: 'Camera',
    min: 50,
    max: 100,
    step: 5,
  },
  cameraX: {
    value: 0,
    type: 'number',
    label: 'Camera X',
    group: 'Camera',
  },
  cameraY: {
    value: 1.6,
    type: 'number',
    label: 'Camera Y',
    group: 'Camera',
  },
  cameraZ: {
    value: 0,
    type: 'number',
    label: 'Camera Z',
    group: 'Camera',
  },

  // --- Visuals ---
  backgroundColor: {
    value: '#87ceeb',
    type: 'color',
    label: 'Background Color',
    group: 'Visuals',
  },
  ambientColor: {
    value: '#ffffff',
    type: 'color',
    label: 'Ambient Light Color',
    group: 'Visuals',
  },
  ambientIntensity: {
    value: 1.6,
    type: 'number',
    label: 'Ambient Intensity',
    group: 'Visuals',
    min: 0,
    max: 5,
    step: 0.1,
  },
  sunColor: {
    value: '#fffbe8',
    type: 'color',
    label: 'Sun Color',
    group: 'Visuals',
  },
  sunIntensity: {
    value: 3.5,
    type: 'number',
    label: 'Sun Intensity',
    group: 'Visuals',
    min: 0,
    max: 10,
    step: 0.1,
  },
  hemiSkyColor: {
    value: '#72b5f6',
    type: 'color',
    label: 'Hemisphere Sky Color',
    group: 'Visuals',
  },
  hemiGroundColor: {
    value: '#4d7c39',
    type: 'color',
    label: 'Hemisphere Ground Color',
    group: 'Visuals',
  },
  hemiIntensity: {
    value: 1.1,
    type: 'number',
    label: 'Hemisphere Intensity',
    group: 'Visuals',
    min: 0,
    max: 3,
    step: 0.1,
  },

  // --- Physics ---
  gravity: {
    value: -15.0,
    type: 'number',
    label: 'Gravity',
    group: 'Physics',
    min: -30,
    max: 0,
    step: 0.5,
  },

  // --- System ---
  targetFPS: {
    value: 60,
    type: 'number',
    label: 'Target FPS',
    group: 'System',
  },
  stepMs: {
    value: 1000 / 60,
    type: 'number',
    label: 'Step MS',
    group: 'System',
  },
  maxSubSteps: {
    value: 5,
    type: 'number',
    label: 'Max Sub Steps',
    group: 'System',
  },

  // --- Audio ---
  defaultMusicVolume: {
    value: 0.25,
    type: 'number',
    label: 'Default Music Volume',
    group: 'AUDIO',
  },
  defaultSfxVolume: {
    value: 0.6,
    type: 'number',
    label: 'Default SFX Volume',
    group: 'AUDIO',
  },
  backgroundMusicUrl: {
    value: 'https://storage.googleapis.com/assets-gen-playground/musiclibrary/pixel_quest.mp3',
    type: 'string',
    label: 'Background Music URL',
    group: 'Audio',
  },
};

// Merge customized config values if present (injected by Playground)
const {playgroundConfig} = globalThis as {
  playgroundConfig?: Record<string, unknown>;
};
if (playgroundConfig) {
  for (const [key, value] of Object.entries(playgroundConfig)) {
    if (key in CONFIG) {
      Object.assign(CONFIG[key as keyof typeof CONFIG], {value});
    }
  }
}

/** Type helper for reading values in game code. */
export type ConfigKey = keyof typeof CONFIG;

/**
 * Gets a configuration value by key.
 * @param key The configuration key.
 * @return The configuration value.
 */
export function getConfig<K extends ConfigKey>(
  key: K,
): (typeof CONFIG)[K]['value'] {
  return CONFIG[key].value;
}

export const AVAILABLE_MUSIC_TRACKS: readonly MusicTrack[] = [
  {
    name: 'pixel_quest',
    url: 'https://storage.googleapis.com/assets-gen-playground/musiclibrary/pixel_quest.mp3',
    description: 'Cheerful 8-bit chiptune with pulse-wave leads. Perfect for playful arcade chase tag.',
  },
  {
    name: 'stadium_rush',
    url: 'https://storage.googleapis.com/assets-gen-playground/musiclibrary/stadium_rush.mp3',
    description: 'High-energy rush anthem.',
  },
  {
    name: 'candy_pop',
    url: 'https://storage.googleapis.com/assets-gen-playground/musiclibrary/candy_pop.mp3',
    description: 'Bubbly, energetic and cute playground beats.',
  },
];
