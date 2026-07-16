// src/data/mockStore.ts

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  weight: number;
  // Added 'released' to match the backend/database status
  status: 'In Vault' | 'Redeemed' | 'For Auction' | 'released';
  customerName: string;
  dateReceived: string;
  estimatedValue: number;
  // Made optional as DB rows might not have this UI property initially
  imageColor?: string; 
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  totalLoans: number;
  status: 'Active' | 'Inactive';
  // Standardized tiers to match common DB string formats
  tier: 'Gold' | 'Silver' | 'Bronze' | string; 
  lastVisit: string;
}

export const initialInventory: InventoryItem[] = [
  {
    id: 'INV-001',
    name: '18K Gold Necklace',
    category: 'Gold Jewelry',
    weight: 25.5,
    status: 'In Vault',
    customerName: 'Maria Santos',
    dateReceived: '2026-01-10',
    estimatedValue: 89250,
    imageColor: 'bg-gradient-to-br from-amber-400 to-yellow-500'
  }
];

export const initialCustomers: Customer[] = [
  {
    id: 'CUS-001',
    name: 'Maria Santos',
    email: 'maria.s@email.com',
    phone: '0917-123-4567',
    totalLoans: 12,
    status: 'Active',
    tier: 'Gold',
    lastVisit: '2026-01-12'
  }
];