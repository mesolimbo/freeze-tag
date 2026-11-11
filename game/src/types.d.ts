/** 3D Vector. */
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}
/** 3D Position as a tuple. */
export type Position3D = [number, number, number];
/** Represents an object in the 3D scene. */
export interface Entity3D {
    id: string | number;
    type?: string;
    position: Vec3 | Position3D;
    rotation?: Vec3 | Position3D;
    scale?: Vec3 | Position3D;
    velocity?: Vec3;
    active?: boolean;
    [key: string]: any;
}
/** Represents a particle in a particle system. */
export interface Particle {
    id: string | number;
    position: Vec3 | Position3D;
    velocity?: Vec3 | Position3D;
    life: number;
    maxLife: number;
    color?: string;
    size?: number;
    [key: string]: any;
}
export interface LeaderboardData {
    top: {
        username: string;
        seconds: number;
    }[];
    /** Absent when the player has no recorded win yet. */
    me?: {
        rank: number;
        seconds: number;
    };
}
/** Supplied by hosts that keep scores (the Reddit build). `seconds` is time left on the clock, so higher is faster. */
export interface LeaderboardApi {
    submit(secondsLeft: number): Promise<LeaderboardData>;
    load(): Promise<LeaderboardData>;
}
