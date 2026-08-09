import { SalesPos } from '../../components/SalesPos';

interface LoanManagementProps {
  branchId: string | null;
  activeBranchId?: number | null;
  userRole?: string | null;
}

export function LoanManagement({ branchId, activeBranchId, userRole }: LoanManagementProps) {
  const setActiveTab = () => {}; // Placeholder for navigation

  
  return <SalesPos branchId={branchId} activeBranchId={activeBranchId} setActiveTab={setActiveTab} userRole={userRole} />;
}
