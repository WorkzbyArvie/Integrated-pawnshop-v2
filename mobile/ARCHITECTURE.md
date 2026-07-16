# Pawn Shop Flutter App - Setup & Architecture Guide

## Overview

This project implements **clean architecture** with proper separation of concerns using:
- **BLoC** for state management
- **Repository Pattern** for data access
- **Use Cases** for business logic
- **Secure Storage** for JWT tokens
- **Dependency Injection** in main.dart

---

## Project Structure

```
lib/
├── main.dart                          ← App entry point
├── app_theme.dart                     ← Global theme configuration
├── home_screen.dart                   ← Main navigation screens
├── config/
│   ├── supabase_config.dart          ← Supabase credentials loader
│   └── app_constants.dart            ← App-wide constants
├── core/
│   ├── services/
│   │   ├── supabase_service.dart     ← Supabase client wrapper
│   │   └── secure_storage.dart       ← Secure JWT storage
│   ├── exceptions/
│   │   └── app_exception.dart        ← Custom exception types
│   └── extensions/
│       └── extensions.dart            ← Utility extensions
├── features/
│   ├── auth/
│   │   ├── data/
│   │   │   ├── models/
│   │   │   │   └── user_model.dart
│   │   │   ├── datasources/
│   │   │   │   └── auth_remote_datasource.dart
│   │   │   └── repositories/
│   │   │       └── auth_repository.dart
│   │   ├── domain/
│   │   │   └── usecases/
│   │   │       └── auth_usecase.dart
│   │   └── presentation/
│   │       ├── bloc/
│   │       │   ├── auth_bloc.dart
│   │       │   ├── auth_event.dart
│   │       │   └── auth_state.dart
│   │       └── pages/
│   │           └── login_page.dart
│   ├── inventory/                     ← TO BE CREATED
│   └── redemption/                    ← TO BE CREATED
└── shared/
    └── widgets/
        └── app_button.dart            ← Reusable UI components
```

---

## Setup Instructions

### 1. **Install Flutter Dependencies**

```bash
flutter pub get
```

### 2. **Configure Environment Variables**

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials from Supabase Dashboard:

```env
SUPABASE_URL=https://bxayczllpdhrvutubzbg.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**IMPORTANT:** Never commit `.env` file!

### 3. **Run the App**

```bash
flutter run
```

Or on web:

```bash
flutter run -d chrome
```

---

## Architecture Explanation

### **Data Layer** (`data/`)
- **Models**: Serializable data classes
- **DataSources**: Remote API calls (Supabase in this case)
- **Repositories**: Implement business logic, handle errors

### **Domain Layer** (`domain/`)
- **Use Cases**: Encapsulate single business operations
- Example: `LoginUseCase` validates email/password, calls repository

### **Presentation Layer** (`presentation/`)
- **BLoC**: Manages state (events → state)
- **Pages/Widgets**: UI components that react to BLoC state
- Bloc listens to events → processes them → emits new state → UI rebuilds

---

## Authentication Flow

1. **User enters email/password** → `LoginEvent`
2. **BLoC receives event** → calls `LoginUseCase`
3. **Use case validates inputs** → calls `AuthRepository`
4. **Repository calls AuthDataSource** → Supabase API call
5. **JWT token stored securely** → in Secure Storage
6. **BLoC emits `AuthAuthenticated`** → UI navigates to Home
7. **On app restart** → `CheckAuthStatusEvent` checks stored token

---

## Key Security Practices

✅ **JWT tokens stored in secure device storage** (encrypted)  
✅ **Service role key kept server-side only** (not in .env)  
✅ **Email validation** on client & server  
✅ **Use Cases enforce business rules** before API calls  
✅ **Proper exception handling** with custom types  
✅ **Environment variables** for sensitive config  

---

## Adding New Features

### Example: Create Inventory Feature

1. **Create folder structure:**
```
features/inventory/
├── data/
│   ├── models/inventory_model.dart
│   ├── datasources/inventory_remote_datasource.dart
│   └── repositories/inventory_repository.dart
├── domain/
│   └── usecases/get_inventory_usecase.dart
└── presentation/
    ├── bloc/inventory_bloc.dart
    ├── pages/inventory_page.dart
    └── widgets/inventory_item_card.dart
```

2. **Create Model** (data layer)
3. **Create DataSource** (API calls)
4. **Create Repository** (business logic)
5. **Create UseCase** (validation)
6. **Create BLoC** (state management)
7. **Create UI** (pages/widgets)

---

## Testing Setup

Add to `pubspec.yaml`:
```yaml
dev_dependencies:
  flutter_test:
    sdk: flutter
  bloc_test: ^9.1.0
  mocktail: ^1.0.0
```

Create tests in `test/` directory matching the feature structure.

---

## Database References

Your Supabase database includes these tables:
- `profiles` - User accounts
- `staff` - Staff members
- `customer` - Customer info
- `ticket` - Pawn tickets
- `loan` - Active loans
- `inventory` - Items for auction
- `pawnshops` - Shop info
- `branch` - Shop branches
- `transaction` - Transactions
- `activitylog` - Activity logs

The app is read-write safe - your web app continues to work alongside the Flutter app.

---

## Next Steps

1. ✅ Architecture restructure complete
2. ⏭️ Implement inventory feature using same pattern
3. ⏭️ Implement redemption feature
4. ⏭️ Add real-time updates via Supabase subscriptions
5. ⏭️ Add unit & widget tests

---

## Troubleshooting

**Issue:** `.env` file not found?
- Make sure `.env` exists in project root (same level as pubspec.yaml)
- Run: `flutter clean && flutter pub get`

**Issue:** Supabase connection fails?
- Check `.env` credentials are correct
- Ensure Supabase project is active
- Check Flutter debug logs: `flutter logs`

**Issue:** Build errors?
```bash
flutter clean
flutter pub get
flutter pub upgrade
```

---

## Team Notes

- **Database:** PostgreSQL (Supabase) - shared with web app
- **State Management:** BLoC (better than Provider for complex flows)
- **Security:** JWT in secure storage, ANON_KEY only in Flutter
- **Maintainability:** Clean architecture = easy to test & modify
