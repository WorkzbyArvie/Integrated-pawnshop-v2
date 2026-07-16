import { SetMetadata } from '@nestjs/common';

export const THROTTLE_TTL_KEY = 'throttle_ttl';
export const THROTTLE_LIMIT_KEY = 'throttle_limit';

export interface ThrottleOptions {
  ttl: number;
  limit: number;
}

export const Throttle = (options: ThrottleOptions) => {
  return (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    SetMetadata(THROTTLE_TTL_KEY, options.ttl)(
      target,
      propertyKey!,
      descriptor!,
    );
    SetMetadata(THROTTLE_LIMIT_KEY, options.limit)(
      target,
      propertyKey!,
      descriptor!,
    );
  };
};
