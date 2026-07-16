import { TransitionDefinition } from './state-machine.service';

export const TICKET_LIFECYCLE: TransitionDefinition[] = [
  { from: 'RECEIVED', to: 'OFFER_MADE', allowedRoles: ['OWNER'] },
  { from: 'RECEIVED', to: 'APPRAISED', allowedRoles: ['APPRAISER', 'STAFF', 'MANAGER', 'OWNER'] },
  { from: 'APPRAISED', to: 'OFFER_MADE', allowedRoles: ['APPRAISER', 'MANAGER', 'OWNER'] },
  { from: 'APPRAISED', to: 'CANCELLED', allowedRoles: ['MANAGER', 'OWNER'] },
  { from: 'RECEIVED', to: 'PENDING_APPROVAL', allowedRoles: ['APPRAISER', 'STAFF', 'MANAGER', 'OWNER'] },
  { from: 'PENDING_APPROVAL', to: 'OFFER_MADE', allowedRoles: ['MANAGER', 'OWNER'] },
  { from: 'PENDING_APPROVAL', to: 'CANCELLED', allowedRoles: ['MANAGER', 'OWNER'] },
  { from: 'OFFER_MADE', to: 'CONTRACT_SIGNED', allowedRoles: ['STAFF', 'MANAGER', 'OWNER'] },
  { from: 'OFFER_MADE', to: 'CANCELLED', allowedRoles: ['MANAGER', 'OWNER'] },
  { from: 'CONTRACT_SIGNED', to: 'DISBURSED', allowedRoles: ['CASHIER_TELLER', 'MANAGER', 'OWNER'] },
  { from: 'DISBURSED', to: 'ACTIVE' },
  { from: 'ACTIVE', to: 'REDEEMED', allowedRoles: ['CASHIER_TELLER', 'MANAGER', 'OWNER'] },
  { from: 'ACTIVE', to: 'OVERDUE' },
  { from: 'OVERDUE', to: 'GRACE_PERIOD', allowedRoles: ['MANAGER', 'OWNER'] },
  { from: 'GRACE_PERIOD', to: 'REDEEMED', allowedRoles: ['CASHIER_TELLER', 'MANAGER', 'OWNER'] },
  { from: 'GRACE_PERIOD', to: 'FORFEITED', allowedRoles: ['MANAGER', 'OWNER'] },
  { from: 'OVERDUE', to: 'FORFEITED', allowedRoles: ['MANAGER', 'OWNER'] },
  { from: 'FORFEITED', to: 'AUCTION_QUEUED', allowedRoles: ['MANAGER', 'INVENTORY_CUSTODIAN', 'OWNER'] },
  { from: 'AUCTION_QUEUED', to: 'AUCTION_SOLD', allowedRoles: ['MANAGER', 'OWNER'] },
  { from: 'AUCTION_QUEUED', to: 'AUCTION_UNSOLD', allowedRoles: ['MANAGER', 'OWNER'] },
  { from: 'AUCTION_UNSOLD', to: 'AUCTION_QUEUED', allowedRoles: ['MANAGER', 'OWNER'] },
];

export const LOAN_APPLICATION_LIFECYCLE: TransitionDefinition[] = [
  { from: 'PENDING', to: 'DOCUMENTS_REVIEW', allowedRoles: ['STAFF'] },
  { from: 'PENDING', to: 'REJECTED', allowedRoles: ['STAFF', 'MANAGER'] },
  { from: 'DOCUMENTS_REVIEW', to: 'ELIGIBILITY_CHECK', allowedRoles: ['STAFF'] },
  { from: 'DOCUMENTS_REVIEW', to: 'ADDITIONAL_PROOF', allowedRoles: ['STAFF'] },
  { from: 'ADDITIONAL_PROOF', to: 'DOCUMENTS_REVIEW', allowedRoles: ['STAFF'] },
  { from: 'ELIGIBILITY_CHECK', to: 'AWAITING_APPROVAL', allowedRoles: ['STAFF'] },
  { from: 'ELIGIBILITY_CHECK', to: 'REJECTED', allowedRoles: ['STAFF'] },
  { from: 'AWAITING_APPROVAL', to: 'MANAGER_REVIEW', allowedRoles: ['MANAGER'] },
  { from: 'AWAITING_APPROVAL', to: 'REJECTED', allowedRoles: ['MANAGER'] },
  { from: 'MANAGER_REVIEW', to: 'OWNER_APPROVAL', allowedRoles: ['OWNER'] },
  { from: 'MANAGER_REVIEW', to: 'REJECTED', allowedRoles: ['MANAGER'] },
  { from: 'OWNER_APPROVAL', to: 'APPROVED', allowedRoles: ['OWNER'] },
  { from: 'OWNER_APPROVAL', to: 'REJECTED', allowedRoles: ['OWNER'] },
  { from: 'APPROVED', to: 'DISBURSED', allowedRoles: ['CASHIER_TELLER', 'MANAGER'] },
];

export const COMPLIANCE_LIFECYCLE: TransitionDefinition[] = [
  { from: 'PENDING_COMPLIANCE', to: 'COMPLIED', allowedRoles: ['STAFF', 'MANAGER'] },
  { from: 'PENDING_COMPLIANCE', to: 'REMINDER_SENT' },
  { from: 'COMPLIED', to: 'READY_FOR_RELEASE', allowedRoles: ['MANAGER'] },
  { from: 'READY_FOR_RELEASE', to: 'RELEASED', allowedRoles: ['MANAGER', 'INVENTORY_CUSTODIAN'] },
  { from: 'PENDING_COMPLIANCE', to: 'EXPIRED' },
  { from: 'EXPIRED', to: 'REFUNDED', allowedRoles: ['MANAGER'] },
];
