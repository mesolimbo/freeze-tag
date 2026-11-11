import {cpSync, rmSync} from 'node:fs';

// The game's assets live in ../game/public; copy them in rather than keeping a second set.
rmSync('public/assets', {recursive: true, force: true});
cpSync('../game/public/assets', 'public/assets', {recursive: true});
