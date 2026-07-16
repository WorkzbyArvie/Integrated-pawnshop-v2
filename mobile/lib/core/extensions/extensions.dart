/// URL constants and utilities
class AppUrls {
  // API endpoints
  static const String baseUrl =
  'https://pawngold-backend-production.up.railway.app';
  
  // Auth endpoints
  static const String loginEndpoint = '/auth/login';
  static const String logoutEndpoint = '/auth/logout';
  static const String refreshTokenEndpoint = '/auth/refresh';
  static const String registerEndpoint = '/auth/register';
}

/// Extension utilities
extension StringExtension on String {
  /// Check if string is valid email
  bool isValidEmail() {
    final emailRegex = RegExp(
      r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
    );
    return emailRegex.hasMatch(this);
  }

  /// Check if password meets security requirements
  /// Requirements:
  /// - Minimum 8 characters
  /// - At least one uppercase letter
  /// - At least one lowercase letter
  /// - At least one number
  Map<String, bool> validatePassword() {
    return {
      'length': length >= 8,
      'hasUppercase': contains(RegExp(r'[A-Z]')),
      'hasLowercase': contains(RegExp(r'[a-z]')),
      'hasNumber': contains(RegExp(r'[0-9]')),
    };
  }

  /// Check if password is valid (all requirements met)
  bool isValidPassword() {
    final validation = validatePassword();
    return validation.values.every((requirement) => requirement);
  }

  /// Get password validation error message
  String getPasswordErrorMessage() {
    final validation = validatePassword();
    final errors = <String>[];

    if (!validation['length']!) {
      errors.add('at least 8 characters');
    }
    if (!validation['hasUppercase']!) {
      errors.add('an uppercase letter');
    }
    if (!validation['hasLowercase']!) {
      errors.add('a lowercase letter');
    }
    if (!validation['hasNumber']!) {
      errors.add('a number');
    }

    if (errors.isEmpty) return '';
    return 'Password must contain: ${errors.join(', ')}';
  }

  /// Check if string is not empty
  bool get isNotEmpty => trim().isNotEmpty;

  /// Capitalize first letter
  String capitalize() {
    if (isEmpty) return this;
    return '${this[0].toUpperCase()}${substring(1)}';
  }
}

/// Extension utilities for List
extension ListExtension<T> on List<T> {
  /// Check if list is empty
  bool get isNotEmpty => length > 0;
}

/// Type definitions for common patterns
typedef FutureVoid = Future<void>;
typedef FutureValue<T> = Future<T>;
