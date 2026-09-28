import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseTransformInterceptor } from './response-transform.interceptor';

function run(interceptor: ResponseTransformInterceptor, value: unknown) {
  const handler: CallHandler = { handle: () => of(value) };
  let result: unknown;
  interceptor
    .intercept({} as ExecutionContext, handler)
    .subscribe((value_) => {
      result = value_;
    });
  return result;
}

describe('ResponseTransformInterceptor', () => {
  const interceptor = new ResponseTransformInterceptor();

  it('wraps a plain payload once', () => {
    expect(run(interceptor, { id: 1 })).toEqual({ success: true, data: { id: 1 } });
  });

  it('does not re-wrap a response that is already an envelope', () => {
    // Regression: this shape is what the security controller returns. Requiring
    // `meta` for the pass-through produced
    // { success: true, data: { success: true, data: {...} } }, so a client
    // unwrapping one level received the envelope instead of the payload.
    const already = { success: true, data: { mustChangePassword: false } };
    expect(run(interceptor, already)).toEqual(already);
  });

  it('produces exactly one envelope layer for an already-enveloped body', () => {
    const inner = { mustChangePassword: true, mfaEnabled: false };
    const output = run(interceptor, { success: true, data: inner }) as {
      success: boolean;
      data: unknown;
    };
    expect(output.data).toEqual(inner);
  });

  it('keeps meta alongside data', () => {
    const value = { data: [{ id: 1 }], meta: { total: 1 } };
    expect(run(interceptor, value)).toEqual({ success: true, data: [{ id: 1 }], meta: { total: 1 } });
  });

  it('leaves a failure envelope untouched', () => {
    const failure = { success: false, error: 'X', message: 'no' };
    expect(run(interceptor, failure)).toEqual(failure);
  });

  it('does not treat an array payload as an envelope', () => {
    expect(run(interceptor, [1, 2])).toEqual({ success: true, data: [1, 2] });
  });

  it('wraps a null payload', () => {
    expect(run(interceptor, null)).toEqual({ success: true, data: null });
  });
});
