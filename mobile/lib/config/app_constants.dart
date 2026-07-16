/// Application-wide constants for API configuration and behavior
class AppConstants {
  // API Configuration
  static const Duration apiTimeout = Duration(seconds: 45);
  static const int maxRetries = 4;
  static const Duration retryDelay = Duration(seconds: 2);

  // Authentication
  static const String jwtTokenKey = 'jwt_token';
  static const String userIdKey = 'user_id';
  static const String userRoleKey = 'user_role';
  static const Duration tokenRefreshThreshold = Duration(minutes: 5);

  // Database Tables
  static const String usersTable = 'profiles';
  static const String staffTable = 'staff';
  static const String customersTable = 'customer';
  static const String ticketsTable = 'ticket';
  static const String loansTable = 'loan';
  static const String inventoryTable = 'inventory';
  static const String transactionsTable = 'transaction';
  static const String pawnshopsTable = 'pawnshops';
  static const String branchTable = 'branch';
  static const String categoryTable = 'category';
  static const String activityLogTable = 'activitylog';

  // Business Logic
  static const double defaultInterestRate = 3.0;
  static const String defaultStorageLocation = 'Vault A';
  static const String defaultLoyaltyTier = 'Standard';

  // UI Constants
  static const int pageSize = 20;
  static const Duration debounceTime = Duration(milliseconds: 500);
}
