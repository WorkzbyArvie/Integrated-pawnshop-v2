import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pawn_shop/features/auth/presentation/bloc/auth_event.dart';
import 'package:pawn_shop/features/auth/presentation/bloc/auth_state.dart';
import 'package:pawn_shop/features/auth/domain/usecases/auth_usecase.dart';
import 'package:pawn_shop/core/exceptions/app_exception.dart';

/// BLoC for managing authentication state
class AuthBloc extends Bloc<AuthEvent, AuthState> {
  final LoginUseCase loginUseCase;
  final SignupUseCase signupUseCase;
  final LogoutUseCase logoutUseCase;
  final CheckAuthStatusUseCase checkAuthStatusUseCase;
  final GetCurrentUserUseCase getCurrentUserUseCase;

  AuthBloc({
    required this.loginUseCase,
    required this.signupUseCase,
    required this.logoutUseCase,
    required this.checkAuthStatusUseCase,
    required this.getCurrentUserUseCase,
  }) : super(const AuthInitial()) {
    on<LoginEvent>(_onLoginEvent);
    on<SignupEvent>(_onSignupEvent);
    on<LogoutEvent>(_onLogoutEvent);
    on<CheckAuthStatusEvent>(_onCheckAuthStatusEvent);
    on<RefreshUserEvent>(_onRefreshUserEvent);
  }

  /// Handle login event
  Future<void> _onLoginEvent(
    LoginEvent event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    try {
      final response = await loginUseCase(
        email: event.email,
        password: event.password,
      );

      emit(AuthAuthenticated(user: response.user));
    } on ValidationException catch (e) {
      emit(AuthError(message: e.message, code: e.code));
    } on AuthException catch (e) {
      emit(AuthError(message: e.message, code: e.code));
    } catch (e) {
      emit(AuthError(
        message: 'Unexpected error: ${e.toString()}',
        code: 'UNKNOWN_ERROR',
      ));
    }
  }

  /// Handle signup event
  Future<void> _onSignupEvent(
    SignupEvent event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    try {
      final response = await signupUseCase(
        email: event.email,
        password: event.password,
        firstName: event.firstName,
        lastName: event.lastName,
        phoneNumber: event.phoneNumber,
        authCode: event.authCode,
      );

      emit(AuthAuthenticated(user: response.user));
    } on ValidationException catch (e) {
      emit(AuthError(message: e.message, code: e.code));
    } on AuthException catch (e) {
      emit(AuthError(message: e.message, code: e.code));
    } catch (e) {
      emit(AuthError(
        message: 'Unexpected error: ${e.toString()}',
        code: 'UNKNOWN_ERROR',
      ));
    }
  }

  /// Handle logout event
  Future<void> _onLogoutEvent(
    LogoutEvent event,
    Emitter<AuthState> emit,
  ) async {
    try {
      await logoutUseCase();
      emit(const AuthLoggedOut());
      emit(const AuthUnauthenticated());
    } on AuthException catch (e) {
      emit(AuthError(message: e.message, code: e.code));
    } catch (e) {
      emit(AuthError(message: 'Logout failed: ${e.toString()}'));
    }
  }

  /// Handle auth status check on app start
  Future<void> _onCheckAuthStatusEvent(
    CheckAuthStatusEvent event,
    Emitter<AuthState> emit,
  ) async {
    try {
      final isAuthenticated = await checkAuthStatusUseCase();

      if (isAuthenticated) {
        final user = await getCurrentUserUseCase();
        if (user != null) {
          emit(AuthAuthenticated(user: user));
        } else {
          emit(const AuthUnauthenticated());
        }
      } else {
        emit(const AuthUnauthenticated());
      }
    } catch (e) {
      emit(const AuthUnauthenticated());
    }
  }

  /// Handle user refresh
  Future<void> _onRefreshUserEvent(
    RefreshUserEvent event,
    Emitter<AuthState> emit,
  ) async {
    if (state is! AuthAuthenticated) return;

    try {
      final user = await getCurrentUserUseCase();
      if (user != null) {
        emit(AuthAuthenticated(user: user));
      }
    } catch (e) {
      // Keep current state on error
    }
  }
}
