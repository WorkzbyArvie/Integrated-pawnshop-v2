import 'package:flutter/foundation.dart';

/// Simple logging service for the app
/// Respects debug vs release builds
class AppLogger {
  static const String _prefix = '[PawnShop]';

  /// Log informational message
  static void info(String message) {
    if (kDebugMode) {
      debugPrint('$_prefix ℹ️ $message');
    }
  }

  /// Log warning message
  static void warning(String message) {
    if (kDebugMode) {
      debugPrint('$_prefix ⚠️ $message');
    }
  }

  /// Log error message
  static void error(String message, [dynamic error, StackTrace? stackTrace]) {
    if (kDebugMode) {
      debugPrint('$_prefix ❌ $message');
      if (error != null) {
        debugPrint('$_prefix Error: $error');
      }
      if (stackTrace != null) {
        debugPrintStack(stackTrace: stackTrace);
      }
    }
  }

  /// Log debug message (only in debug mode)
  static void debug(String message) {
    if (kDebugMode) {
      debugPrint('$_prefix 🐛 $message');
    }
  }

  /// Log success message
  static void success(String message) {
    if (kDebugMode) {
      debugPrint('$_prefix ✅ $message');
    }
  }
}
