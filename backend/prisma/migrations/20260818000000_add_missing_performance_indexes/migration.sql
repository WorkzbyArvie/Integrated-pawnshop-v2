-- CreateIndex
CREATE INDEX "customer_pawnshop_id_idx" ON "customer"("pawnshop_id");

-- CreateIndex
CREATE INDEX "staff_branchid_idx" ON "staff"("branchid");

-- CreateIndex
CREATE INDEX "transaction_ticketid_idx" ON "transaction"("ticketid");

-- CreateIndex
CREATE INDEX "admin_invites_pawnshop_id_idx" ON "admin_invites"("pawnshop_id");

-- CreateIndex
CREATE INDEX "customer_payment_methods_profile_id_idx" ON "customer_payment_methods"("profile_id");

-- CreateIndex
CREATE INDEX "activitylog_staffid_idx" ON "activitylog"("staffid");

-- CreateIndex
CREATE INDEX "activitylog_timestamp_idx" ON "activitylog"("timestamp");

-- CreateIndex
CREATE INDEX "loan_applications_pawnshop_id_idx" ON "loan_applications"("pawnshop_id");

-- CreateIndex
CREATE INDEX "loan_applications_customer_id_idx" ON "loan_applications"("customer_id");

-- CreateIndex
CREATE INDEX "loan_applications_status_idx" ON "loan_applications"("status");

-- CreateIndex
CREATE INDEX "loan_documents_application_id_idx" ON "loan_documents"("application_id");

-- CreateIndex
CREATE INDEX "loan_approvals_application_id_idx" ON "loan_approvals"("application_id");

-- CreateIndex
CREATE INDEX "loan_approvals_approver_id_idx" ON "loan_approvals"("approver_id");

-- CreateIndex
CREATE INDEX "eligibility_checks_customer_id_idx" ON "eligibility_checks"("customer_id");

-- CreateIndex
CREATE INDEX "loan_disbursements_loan_id_idx" ON "loan_disbursements"("loan_id");

-- CreateIndex
CREATE INDEX "auction_ratings_customer_id_idx" ON "auction_ratings"("customer_id");

-- CreateIndex
CREATE INDEX "contract_templates_type_idx" ON "contract_templates"("type");

-- CreateIndex
CREATE INDEX "contract_clauses_type_idx" ON "contract_clauses"("type");
