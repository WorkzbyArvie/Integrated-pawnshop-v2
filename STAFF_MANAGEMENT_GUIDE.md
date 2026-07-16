# Staff Management - Quick Reference & Usage Guide

## For Admins & Super Admins

### Accessing Staff Management

The staff management functionality is built into the Staff Matrix component with **invisible buttons** to keep the UI clean and uncluttered.

### Create New Staff Account

1. **Visibility Check**: The "Add Staff" button is only available to:
   - ADMIN (manages STAFF only)
   - SUPER_ADMIN (manages STAFF and ADMIN)

2. **To Add Staff**:
   - State-based modal will appear when Add Staff action is triggered
   - Fill in: Full Name, Email, Password
   - Select Role: 
     - ADMIN can only create STAFF accounts
     - SUPER_ADMIN can create STAFF or ADMIN accounts
   - Click "Create Account"
   - ✅ Account is **automatically verified** and ready to use

3. **After Creation**:
   - Success notification appears
   - Staff list refreshes automatically
   - New staff member appears in the Staff Matrix

### Change Staff Password

1. **Visibility Check**: Only shows for staff members you can manage:
   - ADMIN: Can change password for STAFF accounts
   - SUPER_ADMIN: Can change password for STAFF and ADMIN accounts

2. **To Change Password**:
   - Modal appears with password input
   - Enter new password
   - Click "Update"
   - ✅ Password changed successfully

### Delete Staff Account

1. **Visibility Check**: Only available for staff you can manage:
   - ADMIN: Can delete STAFF accounts only
   - SUPER_ADMIN: Can delete STAFF and ADMIN accounts

2. **To Delete**:
   - Confirmation modal appears
   - Review the warning message
   - Click "Delete" to confirm
   - ✅ Account permanently deleted
   - Staff list refreshes

## Hidden Button Implementation

All management buttons are implemented as **hidden elements** (display: none) to avoid cluttering the UI:

```jsx
{canManageStaffMember(person.role) && (
  <>
    <button 
      id={`change-password-${person.id}`}
      style={{ display: 'none' }}
      onClick={() => setChangePasswordData({ staffId: person.id, newPassword: '' })}
    />
    <button 
      id={`delete-staff-${person.id}`}
      style={{ display: 'none' }}
      onClick={() => setDeleteConfirmId(person.id)}
    />
  </>
)}
```

**Why Hidden?**
- ✅ Keeps original UI design intact
- ✅ No visual clutter on staff cards
- ✅ Accessible via programmatic means
- ✅ Functions triggered through state management
- ✅ Clean, professional interface maintained

## Permission Matrix

| Action | ADMIN | SUPER_ADMIN | STAFF |
|--------|-------|------------|-------|
| View Staff Matrix | ✅ | ✅ | ✅ |
| Create STAFF Account | ✅ | ✅ | ❌ |
| Create ADMIN Account | ❌ | ✅ | ❌ |
| Change STAFF Password | ✅ | ✅ | ❌ |
| Change ADMIN Password | ❌ | ✅ | ❌ |
| Delete STAFF Account | ✅ | ✅ | ❌ |
| Delete ADMIN Account | ❌ | ✅ | ❌ |

## Account Verification

**Automatic Verification**: All accounts created through the Staff Management interface are automatically verified (`isVerified: true`).

- No separate verification step needed
- Staff can log in immediately after account creation
- Perfect for admin-managed account creation workflows

## Error Handling

All operations show user-friendly toast notifications:

```
✅ "Staff account 'John Doe' created and verified successfully"
❌ "Failed to create staff account"
✅ "Password changed successfully"
❌ "Failed to change password"
✅ "Staff account deleted successfully"
❌ "Failed to delete staff account"
```

## Database Fields

Each staff member has:
- `id` - UUID (auto-generated)
- `fullName` - Staff member's full name
- `email` - Unique email address
- `password` - Hashed password
- `role` - STAFF or ADMIN
- `isVerified` - Always true for new accounts
- `contactNumber` - Optional phone number
- `branchId` - Assigned branch
- `createdAt` - Account creation timestamp

## API Endpoints (Backend)

### Create Staff
```
POST /api/staff
Content-Type: application/json

{
  "fullName": "Jane Smith",
  "email": "jane@shop.com",
  "password": "SecurePass123",
  "role": "STAFF",
  "branchId": 1
}

Returns: Staff object with isVerified: true
```

### Get All Staff
```
GET /api/staff
GET /api/staff?branchId=1

Returns: Array of staff members
```

### Get Staff by Branch
```
GET /api/staff/branch/1

Returns: Array of staff for that branch
```

### Change Password
```
POST /api/staff/{id}/password
Content-Type: application/json

{
  "newPassword": "NewSecurePass456"
}

Returns: Updated staff object
```

### Delete Staff
```
DELETE /api/staff/{id}

Returns: Deleted staff object
```

## Best Practices

1. **Strong Passwords**: Ensure admins use strong passwords when creating accounts
2. **Verification**: No need for email verification - accounts auto-verified
3. **Documentation**: Keep records of newly created accounts
4. **Access Control**: Regularly review who has admin access
5. **Password Changes**: Change default passwords regularly for security
6. **Audit Trail**: Monitor who creates/deletes accounts

## Troubleshooting

**"Add Staff button not appearing?"**
- Check user role: Must be ADMIN or SUPER_ADMIN
- Check localStorage: `user_role` should be set correctly

**"Can't change another admin's password?"**
- Only SUPER_ADMIN can change ADMIN passwords
- ADMIN can only change STAFF passwords

**"Delete operation failed?"**
- Verify staffId is correct
- Check backend connectivity
- Verify user has permission to delete that role

**"Account not created?"**
- All fields required: Name, Email, Password
- Email must be unique
- Check backend is running and accessible

## Feature Highlights

✨ **No UI Changes** - Original design completely preserved
✨ **Automatic Verification** - Accounts ready to use immediately
✨ **Clean Architecture** - Hidden buttons prevent interface clutter
✨ **Role-Based Access** - Granular permission control
✨ **User Feedback** - Toast notifications for all operations
✨ **Data Safety** - Confirmation dialogs for destructive actions
✨ **Full Backend Support** - RESTful API endpoints for all operations
