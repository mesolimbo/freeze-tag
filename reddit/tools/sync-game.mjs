import {cpSync, rmSync} from 'node:fs';

// Copy the game's source and assets in so this project builds and uploads for review on its own.
// The copies are git-ignored from the repo root (not reddit/.gitignore, which the review zip honors).
for (const [from, to] of [
  ['../game/src', 'src/game'],
  ['../game/public/assets', 'public/assets'],
]) {
  rmSync(to, {recursive: true, force: true});
  cpSync(from, to, {recursive: true});
}
