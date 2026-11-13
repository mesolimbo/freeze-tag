"""Render the web game's synthesized sound effects to roblox/upload/sfx.wav.

The browser builds these with Web Audio oscillators (GameAudio in game/src/utils/helper.tsx). Roblox can only play
uploaded audio, so this reproduces the same recipes offline. All effects share one file, because Roblox limits
audio uploads per month; the printed regions say where each one starts and ends.

Run with: pipenv run python tools/roblox_sfx.py
"""

import wave
from pathlib import Path

import numpy as np

RATE = 44100
OUT = Path(__file__).resolve().parent.parent / 'roblox' / 'upload' / 'sfx.wav'
GAP_SECONDS = 0.25
rng = np.random.default_rng(7)


def ramp(start, end, count):
    """Web Audio's exponentialRampToValueAtTime, sampled."""
    return start * (end / start) ** (np.arange(count) / count)


def lowpass(signal, cutoff, q_db):
    """Web Audio's lowpass biquad with a cutoff that moves every sample."""
    out = np.zeros_like(signal)
    resonance = 10 ** (q_db / 20)
    x1 = x2 = y1 = y2 = 0.0
    for i, x in enumerate(signal):
        w = 2 * np.pi * min(cutoff[i], RATE * 0.49) / RATE
        cos, alpha = np.cos(w), np.sin(w) / (2 * resonance)
        b0 = (1 - cos) / 2
        y = (b0 * x + (1 - cos) * x1 + b0 * x2 + 2 * cos * y1 - (1 - alpha) * y2) / (1 + alpha)
        x2, x1, y2, y1 = x1, x, y1, y
        out[i] = y
    return out


def oscillator(kind, freq):
    phase = np.cumsum(freq) / RATE
    if kind == 'sine':
        return np.sin(2 * np.pi * phase)
    if kind == 'sawtooth':
        return 2 * (phase % 1) - 1
    if kind == 'triangle':
        return 2 * np.abs(2 * ((phase + 0.25) % 1) - 1) - 1
    raise ValueError(kind)


def blip(kind, freq, dur, gain, freq_to=None):
    count = int(RATE * dur)
    pitch = ramp(freq, max(1, freq_to), count) if freq_to is not None else np.full(count, float(freq))
    return oscillator(kind, pitch) * ramp(gain, 0.0001, count)


def noise_burst(dur, gain, start, end):
    count = int(RATE * dur)
    return lowpass(rng.uniform(-1, 1, count), ramp(start, max(1, end), count), 1) * ramp(gain, 0.0001, count)


def mix(parts):
    """Sum (start_seconds, samples) pairs into one buffer."""
    length = max(int(at * RATE) + len(samples) for at, samples in parts)
    out = np.zeros(length)
    for at, samples in parts:
        begin = int(at * RATE)
        out[begin:begin + len(samples)] += samples
    return out


def footstep():
    return mix([(0, blip('triangle', 180, 0.09, 0.1, 60)), (0, noise_burst(0.04, 0.05, 800, 300))])


def freeze():
    """The laser, explosion and chime that all fire on a tag."""
    count = int(RATE * 0.2)
    laser = lowpass(oscillator('sawtooth', ramp(1800, 80, count)), ramp(2000, 100, count), 5) * ramp(0.12, 0.0001, count)
    chime = [(i * 0.06, blip('sine', freq, 0.15, 0.06)) for i, freq in enumerate([523.25, 659.25, 783.99, 1046.50, 1318.51])]
    explosion = [(0, noise_burst(0.4, 0.2, 1000, 100)), (0, blip('triangle', 160, 0.35, 0.25, 30))]
    return mix([(0, laser)] + explosion + chime)


def victory():
    notes = [261.63, 329.63, 392.00, 523.25]
    parts = []
    for i, freq in enumerate(notes):
        parts += [(i * 0.1, blip('sawtooth', freq, 0.4, 0.06)), (i * 0.1, blip('sine', freq * 0.5, 0.4, 0.04))]
    parts += [(len(notes) * 0.1, blip('triangle', freq, 0.8, 0.06)) for freq in notes]
    return mix(parts)


def defeat():
    parts = []
    for i, freq in enumerate([311.13, 261.63, 246.94, 196.00]):
        parts += [(i * 0.15, blip('sawtooth', freq, 0.3, 0.08)), (i * 0.15, blip('sine', freq * 0.5, 0.35, 0.06))]
    return mix(parts)


def main():
    sounds = {'footstep': footstep(), 'freeze': freeze(), 'victory': victory(), 'defeat': defeat()}
    # One gain for every effect keeps their loudness relative to each other as it is in the browser.
    gain = 0.9 / max(np.abs(samples).max() for samples in sounds.values())
    gap = np.zeros(int(RATE * GAP_SECONDS))
    track = [gap]
    cursor = GAP_SECONDS
    for name, samples in sounds.items():
        seconds = len(samples) / RATE
        print(f'{name} = NumberRange.new({cursor:.3f}, {cursor + seconds:.3f}),')
        track += [samples * gain, gap]
        cursor += seconds + GAP_SECONDS
    print(f'gain applied: {gain:.3f}')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT), 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes((np.concatenate(track) * 32767).astype('<i2').tobytes())


if __name__ == '__main__':
    main()
