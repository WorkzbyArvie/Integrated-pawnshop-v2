import { ArgumentsHost, BadRequestException, ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

const SECRET_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiJ9.service-role-secret.signature';
const SECRET_PASSWORD = 'Str0ng!Passw0rd';
const SECRET_ASSERTION = 'a1b2c3d4e5f6-assertion-token';

describe('GlobalExceptionFilter', () => {
  let json: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    json = jest.fn();
    status = jest.fn(() => ({ json }));
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/security/change-password' }),
      }),
    } as unknown as ArgumentsHost;
    filter = new GlobalExceptionFilter();
  });

  const bodyOf = () => {
    const [payload] = json.mock.calls[0];
    return payload as Record<string, unknown>;
  };

  it('preserves the PASSWORD_CHANGE_REQUIRED machine code from the account guard', () => {
    filter.catch(
      new ForbiddenException({
        success: false,
        error: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must set a new password before continuing.',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(bodyOf()).toMatchObject({
      success: false,
      statusCode: 403,
      error: 'PASSWORD_CHANGE_REQUIRED',
      message: 'You must set a new password before continuing.',
    });
  });

  it('preserves the CREDENTIAL_STATE_UNAVAILABLE machine code with its 503 status', () => {
    filter.catch(
      new ServiceUnavailableException({
        success: false,
        error: 'CREDENTIAL_STATE_UNAVAILABLE',
        message: 'Credential state is unavailable',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(503);
    expect(bodyOf()).toMatchObject({
      statusCode: 503,
      error: 'CREDENTIAL_STATE_UNAVAILABLE',
    });
  });

  it('preserves structured password-policy rule keys', () => {
    filter.catch(
      new BadRequestException({
        success: false,
        error: 'PASSWORD_POLICY_FAILED',
        message: 'Password does not meet the required policy.',
        data: { failed: ['minLength', 'symbol'] },
      }),
      host,
    );

    expect(bodyOf()).toMatchObject({
      statusCode: 400,
      error: 'PASSWORD_POLICY_FAILED',
      data: { failed: ['minLength', 'symbol'] },
    });
  });

  it('drops rule keys that are not part of the policy contract', () => {
    filter.catch(
      new BadRequestException({
        error: 'PASSWORD_POLICY_FAILED',
        message: 'Password does not meet the required policy.',
        data: {
          failed: [
            'minLength',
            'password',
            SECRET_PASSWORD,
            SECRET_ASSERTION,
            42,
            'required',
          ],
        },
      }),
      host,
    );

    expect(bodyOf().data).toEqual({ failed: ['minLength', 'required'] });
  });

  it('never leaks a stack trace or a secret through a credential error', () => {
    const secretError = new ServiceUnavailableException({
      error: 'CREDENTIAL_STATE_UNAVAILABLE',
      message: 'Credential state is unavailable',
      stack: `Error: ${SECRET_SERVICE_ROLE_KEY}`,
      data: { failed: [SECRET_ASSERTION] },
    });
    Object.assign(secretError, { password: SECRET_PASSWORD });

    filter.catch(secretError, host);

    const serialized = JSON.stringify(bodyOf());
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain(SECRET_SERVICE_ROLE_KEY);
    expect(serialized).not.toContain(SECRET_PASSWORD);
    expect(serialized).not.toContain(SECRET_ASSERTION);
  });

  it('keeps the human message first for clients that branch on the error code', () => {
    filter.catch(
      new ServiceUnavailableException({
        error: 'CREDENTIAL_STATE_UNAVAILABLE',
        message: 'Credential state is unavailable',
      }),
      host,
    );

    const body = bodyOf();
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(['success', 'statusCode', 'message', 'error']),
    );
    expect(body.message).toBe('Credential state is unavailable');
  });

  it('preserves validation error lists without collapsing them into a single code', () => {
    filter.catch(
      new BadRequestException({
        message: ['currentPassword must be a string', 'newPassword should not be empty'],
        error: 'Bad Request',
      }),
      host,
    );

    const body = bodyOf();
    expect(body.message).toBe('Validation failed');
    expect(body.errors).toEqual([
      'currentPassword must be a string',
      'newPassword should not be empty',
    ]);
  });

  it('falls back to a 500 without a stack for an unexpected non-Http error', () => {
    filter.catch(new Error('connection pool exhausted'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = bodyOf();
    expect(body).not.toHaveProperty('stack');
    expect(body.error).toBeUndefined();
  });

  it('keeps a string exception response as the message', () => {
    filter.catch(new HttpException('Missing authorization header', 401), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(bodyOf().message).toBe('Missing authorization header');
  });
});
