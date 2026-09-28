export interface ViteEnvLike {
  [key: string]: unknown;
}

export function validateViteEnv(env: ViteEnvLike): string[];

export function assertValidViteEnv(env: ViteEnvLike): void;
