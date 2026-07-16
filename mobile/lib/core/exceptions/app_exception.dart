/// Base exception for all app errors
abstract class AppException implements Exception {
  final String message;
  final String? code;
  final dynamic originalException;

  AppException({
    required this.message,
    this.code,
    this.originalException,
  });

  @override
  String toString() => message;
}

/// Network-related exceptions
class NetworkException extends AppException {
  NetworkException({
    required super.message,
    String? code,
    super.originalException,
  }) : super(code: code ?? 'NETWORK_ERROR');
}

/// Authentication exceptions
class AuthException extends AppException {
  AuthException({
    required super.message,
    String? code,
    super.originalException,
  }) : super(code: code ?? 'AUTH_ERROR');
}

/// Database/Repository exceptions
class DatabaseException extends AppException {
  DatabaseException({
    required super.message,
    String? code,
    super.originalException,
  }) : super(code: code ?? 'DATABASE_ERROR');
}

/// Validation exceptions
class ValidationException extends AppException {
  final Map<String, String>? fieldErrors;

  ValidationException({
    required super.message,
    String? code,
    super.originalException,
    this.fieldErrors,
  }) : super(code: code ?? 'VALIDATION_ERROR');
}

/// Cache exceptions
class CacheException extends AppException {
  CacheException({
    required super.message,
    String? code,
    super.originalException,
  }) : super(code: code ?? 'CACHE_ERROR');
}

/// Timeout exceptions
class TimeoutException extends AppException {
  TimeoutException({
    required super.message,
    String? code,
    super.originalException,
  }) : super(code: code ?? 'TIMEOUT_ERROR');
}

/// Unknown/Unhandled exceptions
class UnknownException extends AppException {
  UnknownException({
    required super.message,
    String? code,
    super.originalException,
  }) : super(code: code ?? 'UNKNOWN_ERROR');
}
