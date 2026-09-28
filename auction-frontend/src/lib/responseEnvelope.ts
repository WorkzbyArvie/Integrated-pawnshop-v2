/**
 * The backend wraps successful responses in `{ success, data }` via
 * `ResponseTransformInterceptor`.
 *
 * Unwrap repeatedly rather than one level: a controller that already returns the
 * envelope, combined with the wrapping interceptor, produced a second layer. A
 * client that unwrapped once then received the envelope instead of the payload,
 * so a valid response was read as an absent one. That is how a healthy 200 from
 * `/security/credential-status` was reported to the user as an unavailable
 * account security status.
 *
 * Bounded to three levels so a pathological payload cannot spin.
 */
export function unwrapEnvelope<T>(body: unknown): T {
  let current: unknown = body;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) break;
    const envelope = current as Record<string, unknown>;
    if (envelope.success !== true || envelope.data === undefined) break;
    current = envelope.data;
  }
  return current as T;
}
