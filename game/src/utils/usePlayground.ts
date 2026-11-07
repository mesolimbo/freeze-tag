/** Stand-ins for the Playground SDK hooks, which have no platform to talk to on itch.io. */

export function usePlayground(): {sdk: any} {
  return {sdk: null};
}

export function usePlaygroundGameLifecycle(_gameState: unknown, _sdk?: unknown) {}
