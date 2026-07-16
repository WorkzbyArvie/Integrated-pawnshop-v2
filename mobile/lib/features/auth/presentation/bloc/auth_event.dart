import 'package:equatable/equatable.dart';

/// Abstract base class for all auth events
abstract class AuthEvent extends Equatable {
  const AuthEvent();

  @override
  List<Object?> get props => [];
}

/// Login event triggered by user
class LoginEvent extends AuthEvent {
  final String email;
  final String password;

  const LoginEvent({
    required this.email,
    required this.password,
  });

  @override
  List<Object?> get props => [email, password];
}

/// Logout event
class LogoutEvent extends AuthEvent {
  const LogoutEvent();
}

/// Check auth status on app start
class CheckAuthStatusEvent extends AuthEvent {
  const CheckAuthStatusEvent();
}

/// Refresh user data
class RefreshUserEvent extends AuthEvent {
  const RefreshUserEvent();
}

/// Signup event triggered by user
class SignupEvent extends AuthEvent {
  final String email;
  final String password;
  final String firstName;
  final String lastName;
  final String phoneNumber;
  final String authCode;

  const SignupEvent({
    required this.email,
    required this.password,
    required this.firstName,
    required this.lastName,
    required this.phoneNumber,
    required this.authCode,
  });

  @override
  List<Object?> get props => [email, password, firstName, lastName, phoneNumber, authCode];
}
