"""Turns a generated music track into a bar-exact seamless loop for the game.

The loop is a whole number of bars starting on the first beat, so repeating it never shifts the beat. The join gets
a short equal-power crossfade into the audio just past the loop end. The encoded file carries one second of the
loop's own end before it and one second of its start after it: the MP3 encoder never sees a hard edge at the join,
and the player loops inside that padding, so neither encoder priming nor end padding can change the loop length.

Usage: pipenv run python tools/make_music_loop.py SOURCE.mp3 OUTPUT.mp3 [--bars N]
Prints the lead and length (seconds) that BackgroundMusic needs.
"""

import argparse

import lameenc
import miniaudio
import numpy as np

JOIN_CROSSFADE_SEC = 0.015
WRAP_SEC = 1.0
BITRATE_KBPS = 160


def beat_grid(mono: np.ndarray, sr: int) -> tuple[float, float]:
    """Returns (beat period, first beat time) in seconds, from spectral flux, which picks out drum hits."""
    n_fft, hop = 2048, 256
    frames = 1 + (len(mono) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(frames)[:, None]
    mag = np.log1p(100 * np.abs(np.fft.rfft(mono[idx] * np.hanning(n_fft), axis=1)))
    flux = np.concatenate([[0], np.maximum(0, np.diff(mag, axis=0)).sum(axis=1)])
    flux = np.maximum(flux - np.convolve(flux, np.ones(16) / 16, mode="same"), 0)
    t = (np.arange(frames) * hop + n_fft / 2) / sr

    def strength(period: float) -> complex:
        return np.sum(flux * np.exp(2j * np.pi * t / period))

    bpms = np.arange(90, 180, 0.005)
    bpm = float(bpms[int(np.argmax([abs(strength(60 / b)) for b in bpms]))])
    period = 60 / bpm
    first_beat = (np.angle(strength(period)) % (2 * np.pi)) / (2 * np.pi) * period
    return period, first_beat


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--bars", type=int, help="loop length in bars (default: as many whole bars as fit)")
    args = parser.parse_args()

    decoded = miniaudio.decode_file(args.source, output_format=miniaudio.SampleFormat.FLOAT32, nchannels=2)
    sr = decoded.sample_rate
    audio = np.frombuffer(decoded.samples, dtype=np.float32).reshape(-1, 2)

    period, first_beat = beat_grid(audio.mean(axis=1), sr)
    bar = 4 * period
    start = int(round(first_beat * sr))
    fade = int(JOIN_CROSSFADE_SEC * sr)
    bars = args.bars or int((len(audio) - start - fade) / (bar * sr))
    length = int(round(bars * bar * sr))
    end = start + length
    if end + fade > len(audio):
        raise SystemExit(f"{bars} bars plus the join crossfade run past the end of the track")

    loop = audio[start:end].copy()
    ramp = np.linspace(0, np.pi / 2, fade, endpoint=False)[:, None]
    loop[:fade] = audio[start:start + fade] * np.sin(ramp) + audio[end:end + fade] * np.cos(ramp)

    wrap = int(WRAP_SEC * sr)
    padded = np.concatenate([loop[-wrap:], loop, loop[:wrap]])
    pcm = (np.clip(padded, -1, 1) * 32767).astype(np.int16)

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(BITRATE_KBPS)
    encoder.set_in_sample_rate(sr)
    encoder.set_channels(2)
    encoder.set_quality(2)
    data = encoder.encode(pcm.tobytes()) + encoder.flush()
    with open(args.output, "wb") as f:
        f.write(data)

    print(f"tempo {60 / period:.3f} BPM, first beat {first_beat * 1000:.1f} ms, {bars} bars")
    print(f"loop {length} samples at {sr} Hz; wrote {len(data) / 1024:.0f} KB to {args.output}")
    print(f"leadSec: {wrap / sr!r}, lengthSec: {length / sr!r}")


if __name__ == "__main__":
    main()
