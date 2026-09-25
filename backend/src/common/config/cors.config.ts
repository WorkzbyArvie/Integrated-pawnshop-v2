export const CORS_ALLOWED_METHODS =
  'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';

export function resolveAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  void env;
  return new Set<string>();
}

export function buildCorsOptions(env: NodeJS.ProcessEnv = process.env) {
  void env;
  return {
    origin: () => true,
    credentials: true,
    methods: CORS_ALLOWED_METHODS,
    allowedHeaders: 'Content-Type,Authorization,pawnshop-id,branch-id,user-id',
  };
}
