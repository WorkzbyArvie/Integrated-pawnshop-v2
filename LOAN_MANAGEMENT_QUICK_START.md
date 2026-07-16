# Loan Management System - Quick Start Guide

**Version:** 1.0  
**Last Updated:** February 15, 2026

---

## 📖 Table of Contents
1. [System Overview](#system-overview)
2. [Getting Started](#getting-started)
3. [For Customers](#for-customers)
4. [For Staff](#for-staff)
5. [For Managers](#for-managers)
6. [For Owners](#for-owners)
7. [Loan Application Workflow](#loan-application-workflow)
8. [Payment Processing](#payment-processing)
9. [Common Tasks](#common-tasks)
10. [Troubleshooting](#troubleshooting)

---

## 🎯 System Overview

The Loan Management System provides a complete solution for processing pawnshop loan applications from submission through repayment. The system features:

- **Multi-step loan application** with payment calculator
- **Multi-level approval workflow** (Staff → Manager → Owner)
- **Document management** with upload and verification
- **Eligibility checking** with automated credit assessment
- **Repayment schedule** generation with amortization
- **Payment tracking** with multiple payment methods
- **Penalty calculation** with automated late fee processing

---

## 🚀 Getting Started

### System Requirements
- Modern web browser (Chrome, Firefox, Edge, Safari)
- Internet connection
- Valid user account with appropriate role

### Accessing the System

1. **Frontend (Staff Portal):** http://localhost:5173
2. **Backend API:** http://localhost:3000
3. **Auction Frontend:** http://localhost:5174

### User Roles

| Role | Permissions |
|------|-------------|
| **CUSTOMER** | Submit applications, view own applications, make payments |
| **STAFF** | View all applications, upload documents, initial approval |
| **MANAGER** | Manager-level approval, penalty management |
| **OWNER** | Final approval, system-wide oversight |
| **SUPER_ADMIN** | Full system access, configuration |

---

## 👤 For Customers

### How to Apply for a Loan

1. **Navigate to Loan Application**
   - Click "New Application" button on dashboard
   - Or go directly to `/loans/apply`

2. **Step 1: Loan Details**
   - Enter **Loan Amount** (₱1,000 - ₱500,000)
   - Select **Loan Type:**
     - PERSONAL - For personal needs
     - BUSINESS - For business capital
     - EMERGENCY - For urgent situations
   - Choose **Loan Term:**
     - 6, 12, 18, 24, 36, 48, or 60 months
   - View **Estimated Monthly Payment** (automatically calculated)
   - Click "Next"

3. **Step 2: Loan Purpose**
   - Describe the purpose of your loan (minimum 10 characters)
   - Be specific and honest (e.g., "Business expansion - buying inventory")
   - Click "Next"

4. **Step 3: Review Application**
   - Review all details carefully
   - Verify loan amount, term, and monthly payment
   - Check purpose description
   - Click "Submit Application"

5. **After Submission**
   - You'll receive a confirmation
   - Application ID will be generated
   - Status: **PENDING** (awaiting staff review)

### Tracking Your Application

**View Application Status:**
1. Go to "My Applications" dashboard
2. Find your application by submission date
3. Click "View Details"

**Application Statuses:**
- 🟡 **PENDING** - Submitted, awaiting staff review
- 🔵 **DOCUMENTS_REVIEW** - Staff reviewing uploaded documents
- 🟣 **ELIGIBILITY_CHECK** - System checking your eligibility
- 🟠 **AWAITING_APPROVAL** - Waiting for manager review
- 🟣 **MANAGER_REVIEW** - Manager reviewing application
- 🟪 **OWNER_APPROVAL** - Owner reviewing final approval
- 🟢 **APPROVED** - Loan approved! Awaiting disbursement
- 🔴 **REJECTED** - Application rejected (reason provided)
- 🟢 **DISBURSED** - Funds released

### Making Payments

**View Repayment Schedule:**
1. Go to "My Loans"
2. Select your approved loan
3. Click "View Repayment Schedule"

**Record a Payment:**
1. Find the installment you want to pay
2. Click "Pay" button
3. Enter payment amount (or keep pre-filled total)
4. Select payment method:
   - Cash
   - Check
   - Bank Transfer
   - GCash
   - Credit Card
5. Add reference number (if applicable)
6. Add notes (optional)
7. Click "Record Payment"

---

## 👔 For Staff

### Dashboard

**Main Dashboard:** `/loans/applications`

Features:
- View all loan applications
- Search by customer name
- Filter by status
- Create new applications on behalf of customers

### Processing Applications

**Step 1: Initial Review**
1. Open application from dashboard
2. Review customer details and loan information
3. Check if all required information is present
4. Click "Approve" to move to document review stage

**Step 2: Document Upload**
1. Click "Documents" tab
2. Click "Upload Document" button
3. Drag and drop files or click to select
4. Supported formats: PDF, PNG, JPG (max 10MB)
5. Select document type for each file:
   - Valid ID
   - Proof of Income
   - Proof of Residence
   - Bank Statement
   - Income Tax Return (ITR)
   - Barangay Clearance
   - Collateral Photo
   - Other
6. Click "Upload"

**Step 3: Document Verification**
1. View uploaded documents in "Documents" tab
2. Download and verify each document
3. Mark documents as verified

**Step 4: Request Eligibility Check**
1. Go to "Eligibility" tab
2. Click "Run Eligibility Check"
3. System automatically calculates:
   - Customer credit history
   - Debt-to-income ratio
   - Previous loan performance
4. Review eligibility decision

**Step 5: Staff Approval**
1. Go to "Approvals" tab (or use ApprovalWorkflow)
2. Review all information
3. Click "Approve Application" or "Reject Application"
4. Enter mandatory comments explaining your decision
5. Click "Confirm Approval" or "Confirm Rejection"

**After Staff Approval:**
- Status changes to **MANAGER_REVIEW**
- Notification sent to managers

### Common Staff Tasks

**Search for Application:**
- Use search bar to find by customer name
- Use status filter to view specific statuses

**View Customer History:**
- Click on customer name
- View all previous applications and loans

**Handle Incomplete Applications:**
- Set status to DOCUMENTS_REVIEW
- Request additional documents from customer
- Add notes describing what's needed

---

## 👨‍💼 For Managers

### Manager Dashboard

Access applications awaiting manager review:
1. Go to Applications dashboard
2. Filter by status: "MANAGER_REVIEW"
3. View applications that passed staff approval

### Manager Approval Process

1. **Review Application**
   - Click on application from list
   - Review all tabs (Details, Documents, Approvals, Eligibility)

2. **Check Staff Approval**
   - Go to "Approvals" tab
   - Read staff comments and rationale

3. **Verify Eligibility**
   - Review eligibility check results
   - Verify debt-to-income ratio is acceptable (< 40% recommended)
   - Check credit history

4. **Make Decision**
   - Click "Approve Application" (sends to owner) or "Reject Application"
   - Enter detailed comments
   - Click "Confirm"

**After Manager Approval:**
- Status changes to **OWNER_APPROVAL**
- Notification sent to owners

**After Manager Rejection:**
- Status changes to **REJECTED**
- Customer notified with reason

### Manager Responsibilities

✅ Verify staff did proper due diligence  
✅ Ensure all required documents are present and verified  
✅ Confirm eligibility criteria met  
✅ Assess overall risk of loan  
✅ Provide clear rationale for decision  

---

## 👔 For Owners

### Owner Dashboard

Access applications awaiting final approval:
1. Go to Applications dashboard
2. Filter by status: "OWNER_APPROVAL"
3. View applications that passed manager review

### Owner Approval Process

1. **Review Complete Application**
   - View all details, documents, and prior approvals
   - Read comments from staff and manager

2. **Final Assessment**
   - Review loan amount and terms
   - Check repayment capacity
   - Assess overall business risk
   - Consider pawnshop cash flow

3. **Make Final Decision**
   - Click "Approve Application" or "Reject Application"
   - Enter comments with business rationale
   - Click "Confirm"

**After Owner Approval:**
- Status changes to **APPROVED**
- Loan ready for disbursement
- Customer notified

**After Owner Rejection:**
- Status changes to **REJECTED**
- Customer notified with reason

### Additional Owner Functions

**View Repayment Schedules:**
- Monitor all active loans
- Track payment progress
- Identify overdue accounts

**Manage Penalties:**
- View calculated penalties
- Waive penalties (with approval authority)
- Apply manual penalties

**System Oversight:**
- View approval statistics
- Monitor loan portfolio performance
- Review defaults and risks

---

## 🔄 Loan Application Workflow

### Complete Status Flow

```
PENDING
   ↓ (Staff reviews)
DOCUMENTS_REVIEW
   ↓ (Documents uploaded and verified)
ELIGIBILITY_CHECK
   ↓ (System checks eligibility)
AWAITING_APPROVAL
   ↓ (Staff approves)
MANAGER_REVIEW
   ↓ (Manager approves)
OWNER_APPROVAL
   ↓ (Owner approves)
APPROVED
   ↓ (Funds disbursed)
DISBURSED
```

### Approval Chain

```
Customer Submits Application
         ↓
    STAFF REVIEW
    ├─ Approve → Next Level
    └─ Reject → REJECTED
         ↓
   MANAGER REVIEW
    ├─ Approve → Next Level
    └─ Reject → REJECTED
         ↓
    OWNER REVIEW
    ├─ Approve → APPROVED
    └─ Reject → REJECTED
```

### Typical Timeline

| Stage | Typical Duration |
|-------|-----------------|
| Staff Review | 2-4 hours |
| Document Upload | 1-2 days (depends on customer) |
| Eligibility Check | Instant (automated) |
| Manager Review | 4-8 hours |
| Owner Approval | 4-12 hours |
| **Total** | **2-4 days** (if no delays) |

---

## 💳 Payment Processing

### Viewing Repayment Schedule

1. Open approved loan
2. Click "View Repayment Schedule"
3. View schedule table showing:
   - Installment number
   - Due date
   - Principal amount
   - Interest amount
   - Penalty amount (if any)
   - Total due
   - Paid amount
   - Status

### Recording Payments

**For Staff/Cashiers:**

1. Customer arrives to make payment
2. Open customer's loan
3. Go to Repayment Schedule
4. Find current installment
5. Click "Pay" button
6. Enter payment information:
   - Amount (default: total due)
   - Payment method
   - Reference number (for digital payments)
   - Notes
7. Click "Record Payment"
8. Generate receipt for customer

### Payment Methods Supported

1. **Cash** - Direct cash payment at branch
2. **Check** - Personal or manager's check
3. **Bank Transfer** - Direct bank deposit/transfer
4. **GCash** - E-wallet payment
5. **Credit Card** - Card payment

### Payment Status Logic

- **PENDING:** No payment made yet
- **PARTIAL:** Payment received but less than total due
- **PAID:** Payment >= total due for that installment
- **OVERDUE:** Past due date with no payment

### Handling Partial Payments

When customer pays less than total due:
1. System records partial payment amount
2. Status remains PARTIAL
3. Remaining balance tracked
4. Penalties may apply if past due date

### Late Payment Penalties

**Automatic Penalty Calculation:**
- **Rate:** 2% per day on overdue amount
- **Maximum:** 10% of original installment amount
- **Trigger:** Day after due date

**Viewing Penalties:**
1. Go to Repayment Schedule
2. Check "Penalty Amount" column
3. Red text indicates penalty applied

**Waiving Penalties:**
- Only managers/owners can waive penalties
- Requires approval and reason
- Recorded in audit trail

---

## 📋 Common Tasks

### Task: Check Application Status

**As Customer:**
1. Login to customer portal
2. Go to "My Applications"
3. View status badge

**As Staff:**
1. Go to Applications dashboard
2. Search customer name or application ID
3. Click to view details

### Task: Upload Missing Documents

**As Customer/Staff:**
1. Open application details
2. Click "Documents" tab
3. Click "Upload Document"
4. Select files
5. Choose document type
6. Upload

### Task: Approve Multiple Applications

**As Manager/Owner:**
1. Filter applications by your approval level
2. Review each application
3. Approve/reject with comments
4. Move to next application

### Task: Generate Payment Receipt

**As Staff:**
1. Record payment in system
2. Click "Generate Receipt"
3. Print or email to customer

### Task: Check Overdue Payments

**As Staff:**
1. Go to Repayment Management
2. Filter by status: OVERDUE
3. Contact customers with overdue payments
4. Process penalties if required

### Task: View Customer Credit History

**As Staff/Manager:**
1. Open customer profile
2. Go to "Credit History" tab
3. View:
   - Total loans: Number of loans taken
   - Active loans: Currently being paid
   - Completed loans: Successfully repaid
   - Defaulted loans: Unpaid/failed
   - Repayment rate: Percentage of on-time payments

---

## 🔧 Troubleshooting

### Issue: Cannot Submit Application

**Possible Causes:**
- Required fields not filled
- Loan amount outside limits (₱1,000 - ₱500,000)
- Purpose description too short (< 10 characters)

**Solution:**
- Check all fields have values
- Ensure loan amount is valid
- Write detailed purpose (at least 10 characters)

### Issue: Monthly Payment Shows as ₱0

**Cause:** Term not selected or loan amount is 0

**Solution:**
- Select loan term from dropdown
- Ensure loan amount is entered
- Try changing term to recalculate

### Issue: Document Upload Fails

**Possible Causes:**
- File too large (> 10MB)
- Unsupported file type
- Network connection issue

**Solution:**
- Compress PDF or resize image
- Use PDF, PNG, or JPG format only
- Check internet connection
- Try uploading one file at a time

### Issue: Cannot Approve Application

**Possible Causes:**
- Not your approval level (wrong role)
- Application not at your stage
- Required documents missing

**Solution:**
- Check if application is at your approval stage
- Verify your role has permission
- Ensure all documents uploaded and verified

### Issue: Payment Not Reflecting

**Possible Causes:**
- Payment not submitted (still in modal)
- Network error during submission
- Server error

**Solution:**
- Check if payment modal closed successfully
- Refresh page to see updated status
- Contact system administrator if persists

### Issue: Eligibility Check Fails

**Possible Causes:**
- Customer has no credit history
- System error calculating debt-to-income
- Missing customer financial data

**Solution:**
- Manually review customer eligibility
- Proceed with manual approval
- Contact administrator for technical issues

---

## 📞 Support

### Getting Help

**For Technical Issues:**
- Contact IT Support: support@pawnshop.com
- Call: +63 XXX XXX XXXX

**For Business Questions:**
- Contact Branch Manager
- Email: manager@pawnshop.com

### Training Resources

- User Manual: [Link to full manual]
- Video Tutorials: [Link to training videos]
- FAQ: [Link to FAQ page]

---

## 🎯 Best Practices

### For Staff

✅ **Always verify documents thoroughly** before approving  
✅ **Leave detailed comments** in approval workflow  
✅ **Respond to applications within 24 hours**  
✅ **Keep customer information confidential**  
✅ **Follow up on incomplete applications**  
✅ **Record payments immediately** upon receipt  

### For Managers

✅ **Review staff comments** before making decision  
✅ **Verify eligibility checks** are reasonable  
✅ **Provide clear rejection reasons** to help customers  
✅ **Monitor team performance** and approval times  
✅ **Handle penalty waivers** judiciously  

### For Owners

✅ **Make final decisions within 12 hours**  
✅ **Consider business risk** and cash flow  
✅ **Review approval trends** and success rates  
✅ **Set clear approval guidelines** for team  
✅ **Monitor loan portfolio health**  

---

## 📊 Key Metrics

### Success Metrics

- **Application Processing Time:** < 24 hours (target)
- **Approval Rate:** Track monthly
- **Default Rate:** Monitor closely
- **Customer Satisfaction:** 4.5/5 stars (target)
- **On-time Payment Rate:** > 90%

### Monthly Reports

Available dashboards:
- New applications by status
- Approval rates by role
- Payment collection rates
- Overdue account tracking
- Penalty waivers granted

---

*Last Updated: February 15, 2026*  
*Version: 1.0*  
*For questions or feedback, contact: admin@pawnshop.com*
