# Quick Reference: How To Use This App

## 🏃 Get Started In 30 Seconds

```bash
# 1. Install dependencies
flutter pub get

# 2. Run the app
flutter run

# 3. Try logging in with a test account
```

That's it! The app loads your `.env` credentials automatically.

---

## 🔒 Login / Logout

### Login Flow:
1. User enters email + password
2. `LoginPage` sends `LoginEvent` to `AuthBloc`
3. `AuthBloc` calls `LoginUseCase` for validation
4. `UseCase` calls `AuthRepository` 
5. `Repository` calls Supabase API
6. JWT token saved to **encrypted device storage**
7. BLoC emits `AuthAuthenticated` state
8. UI navigates to `HomeScreen`

### Logout Flow:
```dart
// Call this in your UI
context.read<AuthBloc>().add(const LogoutEvent());
```

The JWT will be cleared from secure storage.

---

## 📱 Check Auth Status

```dart
// In any page:
BlocBuilder<AuthBloc, AuthState>(
  builder: (context, state) {
    if (state is AuthAuthenticated) {
      return Text('Logged in as: ${state.user.email}');
    } else if (state is AuthUnauthenticated) {
      return const Text('Please log in');
    }
    return const SizedBox();
  },
);
```

---

## 🗄️ Query Database

### Using SupabaseService (Low-level):
```dart
final service = SupabaseService();

// Get all tickets
final tickets = await service.query(
  AppConstants.ticketsTable,
  select: 'id, customer_id, amount, status',
  filters: {'pawnshop_id': currentPawnshopId},
  orderBy: 'created_at',
  ascending: false,
);

// Get single record
final tickets = await service.query(
  AppConstants.ticketsTable,
  filters: {'id': ticketId},
);
final ticket = tickets.first;
```

### Using Repository Pattern (Recommended):
```dart
// 1. Create a model (data/models/)
class TicketModel {
  final int id;
  final String customerId;
  final double amount;
  final String status;
  
  TicketModel.fromJson(Map<String, dynamic> json)
    : id = json['id'],
      customerId = json['customer_id'],
      amount = json['amount'],
      status = json['status'];
}

// 2. Create datasource (data/datasources/)
abstract class TicketDataSource {
  Future<List<TicketModel>> getTickets(String pawnshopId);
}

class TicketDataSourceImpl implements TicketDataSource {
  final SupabaseService supabaseService;
  
  @override
  Future<List<TicketModel>> getTickets(String pawnshopId) async {
    final data = await supabaseService.query(
      AppConstants.ticketsTable,
      filters: {'pawnshop_id': pawnshopId},
    );
    return data.map((json) => TicketModel.fromJson(json)).toList();
  }
}

// 3. Create repository (data/repositories/)
abstract class TicketRepository {
  Future<List<TicketModel>> getTickets(String pawnshopId);
}

class TicketRepositoryImpl implements TicketRepository {
  final TicketDataSource dataSource;
  
  @override
  Future<List<TicketModel>> getTickets(String pawnshopId) async {
    try {
      return await dataSource.getTickets(pawnshopId);
    } catch (e) {
      throw DatabaseException(message: 'Failed to fetch tickets');
    }
  }
}

// 4. Use in BLoC
class TicketBloc extends Bloc<TicketEvent, TicketState> {
  // ... emit states based on repository results
}
```

---

## 🎨 Reusable Widgets

### AppButton
```dart
AppButton(
  label: 'Submit',
  onPressed: () => handleSubmit(),
  isLoading: state is AuthLoading,
  backgroundColor: AppTheme.gold,
  width: double.infinity,
  height: 56,
)
```

### AppTextField
```dart
AppTextField(
  label: 'Email',
  hint: 'Enter your email',
  keyboardType: TextInputType.emailAddress,
  validator: (value) {
    if (!value!.isValidEmail()) {
      return 'Invalid email';
    }
    return null;
  },
  onChanged: (value) => setState(() => email = value),
)
```

### AppCard
```dart
AppCard(
  padding: const EdgeInsets.all(16),
  borderRadius: 12,
  backgroundColor: AppTheme.surface,
  child: Column(
    children: [
      Text('Card Title'),
      Text('Card content'),
    ],
  ),
)
```

---

## 🧪 Testing

### Unit Test Example:
```dart
// test/features/auth/repositories/auth_repository_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:pawn_shop/features/auth/data/datasources/auth_remote_datasource.dart';
import 'package:pawn_shop/features/auth/data/repositories/auth_repository.dart';

class MockAuthDataSource extends Mock implements AuthRemoteDataSource {}

void main() {
  group('AuthRepository', () {
    late MockAuthDataSource mockDataSource;
    late AuthRepository repository;

    setUp(() {
      mockDataSource = MockAuthDataSource();
      repository = AuthRepositoryImpl(
        remoteDataSource: mockDataSource,
        secureStorage: MockSecureStorage(),
      );
    });

    test('login returns user when successful', () async {
      // Arrange
      const testEmail = 'test@example.com';
      const testPassword = 'password123';
      final testModel = UserModel(
        id: '1',
        email: testEmail,
        role: 'STAFF',
        createdAt: DateTime.now(),
      );

      when(() => mockDataSource.login(
        email: testEmail,
        password: testPassword,
      )).thenAnswer((_) async => LoginResponseModel(
        user: testModel,
        accessToken: 'token',
      ));

      // Act
      final result = await repository.login(
        email: testEmail,
        password: testPassword,
      );

      // Assert
      expect(result.user, testModel);
      expect(result.accessToken, isNotEmpty);
    });
  });
}
```

Run tests:
```bash
flutter test
flutter test test/features/auth/
```

---

## 🏭 Adding A New Feature

### Step 1: Create folder structure
```bash
mkdir -p lib/features/inventory/{data/datasources,data/models,data/repositories,domain/usecases,presentation/bloc,presentation/pages}
```

### Step 2: Create model (bottom-up approach)
```dart
// lib/features/inventory/data/models/inventory_model.dart
import 'package:equatable/equatable.dart';

class InventoryModel extends Equatable {
  final int id;
  final int categoryId;
  final double auctionPrice;
  final bool isForAuction;

  const InventoryModel({
    required this.id,
    required this.categoryId,
    required this.auctionPrice,
    required this.isForAuction,
  });

  factory InventoryModel.fromJson(Map<String, dynamic> json) {
    return InventoryModel(
      id: json['id'],
      categoryId: json['categoryid'],
      auctionPrice: json['auctionprice'],
      isForAuction: json['isforauction'],
    );
  }

  @override
  List<Object> get props => [id, categoryId, auctionPrice, isForAuction];
}
```

### Step 3: Create datasource
```dart
// lib/features/inventory/data/datasources/inventory_remote_datasource.dart

abstract class InventoryRemoteDataSource {
  Future<List<InventoryModel>> getAuctionItems();
}

class InventoryRemoteDataSourceImpl implements InventoryRemoteDataSource {
  final SupabaseService supabaseService;

  @override
  Future<List<InventoryModel>> getAuctionItems() async {
    final data = await supabaseService.query(
      AppConstants.inventoryTable,
      filters: {'isforauction': true},
    );
    return data.map((json) => InventoryModel.fromJson(json)).toList();
  }
}
```

### Step 4: Create repository
```dart
// lib/features/inventory/data/repositories/inventory_repository.dart

abstract class InventoryRepository {
  Future<List<InventoryModel>> getAuctionItems();
}

class InventoryRepositoryImpl implements InventoryRepository {
  final InventoryRemoteDataSource dataSource;

  @override
  Future<List<InventoryModel>> getAuctionItems() async {
    try {
      return await dataSource.getAuctionItems();
    } catch (e) {
      throw DatabaseException(message: 'Failed to fetch inventory');
    }
  }
}
```

### Step 5: Create usecase
```dart
// lib/features/inventory/domain/usecases/get_auction_items_usecase.dart

class GetAuctionItemsUseCase {
  final InventoryRepository repository;

  GetAuctionItemsUseCase({required this.repository});

  Future<List<InventoryModel>> call() async {
    return await repository.getAuctionItems();
  }
}
```

### Step 6: Create BLoC
```dart
// lib/features/inventory/presentation/bloc/inventory_bloc.dart

// ... create events, states, then BLoC
```

### Step 7: Create UI
```dart
// lib/features/inventory/presentation/pages/inventory_page.dart

class InventoryPage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => InventoryBloc(useCase)
        ..add(FetchAuctionItemsEvent()),
      child: BlocBuilder<InventoryBloc, InventoryState>(
        builder: (context, state) {
          // UI based on state
        },
      ),
    );
  }
}
```

---

## 🔄 Real-Time Updates (Coming Soon)

You can subscribe to table changes:
```dart
final supabase = SupabaseService();

final channel = supabase.subscribe(
  AppConstants.ticketsTable,
  onData: (payload) {
    print('Ticket updated: ${payload.newRecord}');
    // Refresh UI
  },
);
```

---

## 🆘 Error Handling

### Custom Exception Types:
```dart
try {
  await repository.login(email: email, password: password);
} on ValidationException catch (e) {
  // Invalid input - show error to user
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(e.message)),
  );
} on AuthException catch (e) {
  // Auth failed (wrong credentials, etc)
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text('Login failed: ${e.message}')),
  );
} on NetworkException catch (e) {
  // Network error
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text('Network error: ${e.message}')),
  );
}
```

---

## 📊 Monitor Network Requests

Enable Supabase logs during development:
```dart
// In main.dart
SupabaseClient client = Supabase.instance.client;
client.functions.setAuth('token'); // For cloud functions
```

Check Flutter logs:
```bash
flutter logs
```

---

## 🎯 Performance Tips

1. **Avoid rebuilds**: Use BlocBuilder/BlocListener instead of setState
2. **Pagination**: Fetch 20 items at a time, load more on scroll
3. **Caching**: Store data locally between api calls
4. **Debouncing**: Use RxDart or custom debounce for search

Example pagination:
```dart
Future<List<TicketModel>> getTickets(int page, int pageSize) async {
  final offset = page * pageSize;
  // Add limit and offset to query
  return await dataSource.getTickets(
    offset: offset,
    limit: pageSize,
  );
}
```

---

## 🚀 Deployment Checklist

- [ ] Test app on both iOS and Android
- [ ] Update app version in pubspec.yaml
- [ ] Remove debug prints
- [ ] Ensure .env is NOT in git
- [ ] Test with production Supabase URL
- [ ] Set up RLS policies (Supabase dashboard)
- [ ] Enable CORS if needed
- [ ] Test all user flows
- [ ] Monitor Supabase logs
- [ ] Set up error tracking (Sentry, etc)

---

## 📚 File Reference

```
lib/
├── main.dart                    ← Start here to understand app flow
├── app_theme.dart               ← Change colors/fonts here
├── config/app_constants.dart    ← Change table names, timeouts here
├── features/auth/              ← Copy this pattern for new features
└── shared/widgets/app_button.dart ← Use these in your screens
```

---

## 💻 Commands

```bash
# Install dependencies
flutter pub get

# Run app
flutter run
flutter run -d chrome        # Web
flutter run -d emulator      # Android

# Build for release
flutter build apk
flutter build ios

# Clean and rebuild
flutter clean
flutter pub get
flutter run

# Run tests
flutter test
flutter test --coverage

# Format code
flutter format lib/

# Analyze code
flutter analyze
```

---

**Everything else you need is in ARCHITECTURE.md**

Happy coding! 🚀
