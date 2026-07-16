import 'dart:io';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Wrapper around Supabase client for centralized access
/// This ensures consistent error handling and provides convenience methods
class SupabaseService {
  static final SupabaseService _instance = SupabaseService._internal();

  factory SupabaseService() {
    return _instance;
  }

  SupabaseService._internal();

  /// Get the initialized Supabase client
  SupabaseClient get client => Supabase.instance.client;

  /// Get current authenticated user
  User? get currentUser => client.auth.currentUser;

  /// Check if user is authenticated
  bool get isAuthenticated => currentUser != null;

  /// Get current user ID
  String? get userId => currentUser?.id;

  /// Get user email
  String? get userEmail => currentUser?.email;

  /// Sign up with email and password
  Future<AuthResponse> signUp({
    required String email,
    required String password,
  }) async {
    return await client.auth.signUp(
      email: email,
      password: password,
    );
  }

  /// Sign in with email and password
  Future<AuthResponse> signIn({
    required String email,
    required String password,
  }) async {
    return await client.auth.signInWithPassword(
      email: email,
      password: password,
    );
  }

  /// Sign out current user
  Future<void> signOut() async {
    await client.auth.signOut();
  }

  /// Get access token
  String? get accessToken => currentUser?.appMetadata['access_token'] as String?;

  /// Generic table query with error handling
  Future<List<Map<String, dynamic>>> query(
    String table, {
    String select = '*',
    Map<String, dynamic>? filters,
    String? orderBy,
    bool ascending = true,
    int? limit,
  }) async {
    try {
      dynamic queryBuilder = client.from(table).select(select);

      // Apply filters
      if (filters != null) {
        for (final entry in filters.entries) {
          queryBuilder = queryBuilder.eq(entry.key, entry.value);
        }
      }

      // Apply ordering
      if (orderBy != null) {
        queryBuilder = queryBuilder.order(orderBy, ascending: ascending);
      }

      // Apply limit
      if (limit != null) {
        queryBuilder = queryBuilder.limit(limit);
      }

      return await queryBuilder;
    } on PostgrestException catch (e) {
      throw SupabaseQueryException(
        message: e.message,
        code: e.code,
        details: e.details,
      );
    } on SocketException catch (e) {
      throw SupabaseNetworkException(message: e.message);
    } catch (e) {
      throw SupabaseUnknownException(message: e.toString());
    }
  }

  /// Insert a record
  /// Returns the data that was inserted (doesn't query back to avoid RLS issues)
  Future<Map<String, dynamic>> insert(
    String table,
    Map<String, dynamic> data,
  ) async {
    try {
      await client.from(table).insert(data);
      return data; // Return the data we inserted, don't query back
    } on PostgrestException catch (e) {
      throw SupabaseQueryException(
        message: e.message,
        code: e.code,
        details: e.details,
      );
    } catch (e) {
      throw SupabaseUnknownException(message: e.toString());
    }
  }

  /// Update a record
  Future<List<Map<String, dynamic>>> update(
    String table,
    Map<String, dynamic> data, {
    required String id,
    required String idColumn,
  }) async {
    try {
      return await client
          .from(table)
          .update(data)
          .eq(idColumn, id)
          .select();
    } on PostgrestException catch (e) {
      throw SupabaseQueryException(
        message: e.message,
        code: e.code,
        details: e.details,
      );
    } catch (e) {
      throw SupabaseUnknownException(message: e.toString());
    }
  }

  /// Delete a record
  Future<void> delete(
    String table, {
    required String id,
    required String idColumn,
  }) async {
    try {
      await client.from(table).delete().eq(idColumn, id);
    } on PostgrestException catch (e) {
      throw SupabaseQueryException(
        message: e.message,
        code: e.code,
        details: e.details,
      );
    } catch (e) {
      throw SupabaseUnknownException(message: e.toString());
    }
  }

  /// Real-time subscription to table changes
  RealtimeChannel subscribe(
    String table, {
    required Function(PostgresChangePayload) onData,
    Function(dynamic)? onError,
  }) {
    return client
        .channel('public:$table')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: table,
          callback: onData,
        )
        .subscribe();
  }
}

/// Custom exceptions for Supabase operations
class SupabaseQueryException implements Exception {
  final String message;
  final String? code;
  final dynamic details;

  SupabaseQueryException({
    required this.message,
    this.code,
    this.details,
  });

  @override
  String toString() => 'SupabaseQueryException: $message (Code: $code)';
}

class SupabaseNetworkException implements Exception {
  final String message;

  SupabaseNetworkException({required this.message});

  @override
  String toString() => 'SupabaseNetworkException: $message';
}

class SupabaseUnknownException implements Exception {
  final String message;

  SupabaseUnknownException({required this.message});

  @override
  String toString() => 'SupabaseUnknownException: $message';
}
