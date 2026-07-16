import 'package:equatable/equatable.dart';

/// User model for API responses
class UserModel extends Equatable {
  final String id;
  final String email;
  final String? fullName;
  final String role;
  final String? pawnshopId;
  final String? branchId;
  final DateTime createdAt;
  final DateTime? updatedAt;

  const UserModel({
    required this.id,
    required this.email,
    this.fullName,
    required this.role,
    this.pawnshopId,
    this.branchId,
    required this.createdAt,
    this.updatedAt,
  });

  @override
  List<Object?> get props => [
    id,
    email,
    fullName,
    role,
    pawnshopId,
    branchId,
    createdAt,
    updatedAt,
  ];

  /// Convert from JSON (Supabase response)
  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] as String,
      email: json['email'] as String? ?? '',
      fullName: json['full_name'] as String?,
      role: json['role'] as String? ?? 'STAFF',
      pawnshopId: json['pawnshop_id'] as String?,
      branchId: json['branch_id'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String? ?? DateTime.now().toIso8601String()),
      updatedAt: json['updated_at'] != null ? DateTime.parse(json['updated_at'] as String) : null,
    );
  }

  /// Convert to JSON for API requests
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'email': email,
      'full_name': fullName,
      'role': role,
      'pawnshop_id': pawnshopId,
      'branch_id': branchId,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt?.toIso8601String(),
    };
  }

  /// Create a copy with modifications
  UserModel copyWith({
    String? id,
    String? email,
    String? fullName,
    String? role,
    String? pawnshopId,
    String? branchId,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return UserModel(
      id: id ?? this.id,
      email: email ?? this.email,
      fullName: fullName ?? this.fullName,
      role: role ?? this.role,
      pawnshopId: pawnshopId ?? this.pawnshopId,
      branchId: branchId ?? this.branchId,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}

/// Login request model
class LoginRequestModel extends Equatable {
  final String email;
  final String password;

  const LoginRequestModel({
    required this.email,
    required this.password,
  });

  @override
  List<Object?> get props => [email, password];

  Map<String, dynamic> toJson() {
    return {
      'email': email,
      'password': password,
    };
  }
}

/// Login response model
class LoginResponseModel extends Equatable {
  final UserModel user;
  final String accessToken;
  final String? refreshToken;

  const LoginResponseModel({
    required this.user,
    required this.accessToken,
    this.refreshToken,
  });

  @override
  List<Object?> get props => [user, accessToken, refreshToken];

  factory LoginResponseModel.fromJson(Map<String, dynamic> json) {
    return LoginResponseModel(
      user: UserModel.fromJson(json['user'] as Map<String, dynamic>),
      accessToken: json['access_token'] as String? ?? '',
      refreshToken: json['refresh_token'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'user': user.toJson(),
      'access_token': accessToken,
      'refresh_token': refreshToken,
    };
  }
}
