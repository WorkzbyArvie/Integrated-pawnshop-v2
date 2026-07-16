/*
  Warnings:

  - You are about to drop the `ActivityLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Branch` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Category` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Customer` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Inventory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Loan` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Staff` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SystemSettings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Ticket` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Transaction` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."ActivityLog" DROP CONSTRAINT "ActivityLog_staffId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Inventory" DROP CONSTRAINT "Inventory_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Inventory" DROP CONSTRAINT "Inventory_ticketId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Loan" DROP CONSTRAINT "Loan_ticketId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Staff" DROP CONSTRAINT "Staff_branchId_fkey";

-- DropForeignKey
ALTER TABLE "public"."SystemSettings" DROP CONSTRAINT "SystemSettings_branchId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Ticket" DROP CONSTRAINT "Ticket_branchId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Ticket" DROP CONSTRAINT "Ticket_customerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Transaction" DROP CONSTRAINT "Transaction_ticketId_fkey";

-- DropTable
DROP TABLE "public"."ActivityLog";

-- DropTable
DROP TABLE "public"."Branch";

-- DropTable
DROP TABLE "public"."Category";

-- DropTable
DROP TABLE "public"."Customer";

-- DropTable
DROP TABLE "public"."Inventory";

-- DropTable
DROP TABLE "public"."Loan";

-- DropTable
DROP TABLE "public"."Staff";

-- DropTable
DROP TABLE "public"."SystemSettings";

-- DropTable
DROP TABLE "public"."Ticket";

-- DropTable
DROP TABLE "public"."Transaction";

-- CreateTable
CREATE TABLE "public"."branch" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "pawnshop_id" UUID,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."category" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "contact_number" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "loyaltytier" TEXT NOT NULL DEFAULT 'Standard',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pawnshop_id" UUID,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory" (
    "id" SERIAL NOT NULL,
    "categoryid" INTEGER,
    "ticketid" INTEGER,
    "isforauction" BOOLEAN NOT NULL DEFAULT false,
    "auctionprice" DOUBLE PRECISION,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."loan" (
    "id" SERIAL NOT NULL,
    "ticketid" INTEGER,
    "principalamount" DOUBLE PRECISION NOT NULL,
    "interestamount" DOUBLE PRECISION NOT NULL,
    "customername" TEXT,
    "category" TEXT,
    "weight" DECIMAL(65,30),
    "riskscore" DECIMAL(65,30),
    "status" TEXT DEFAULT 'active',
    "pawnshop_id" UUID,
    "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pawnshops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "registration_number" TEXT,
    "tax_id" TEXT,
    "address" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "logo_url" TEXT,
    "status" TEXT DEFAULT 'ACTIVE',
    "owner_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN DEFAULT true,
    "settings" JSON DEFAULT '{}',

    CONSTRAINT "pawnshops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."staff" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "contact_number" TEXT,
    "branchid" INTEGER,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."systemsettings" (
    "id" SERIAL NOT NULL,
    "branchid" INTEGER NOT NULL,
    "defaultinterest" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "enableaipricing" BOOLEAN NOT NULL DEFAULT true,
    "showvaultwidget" BOOLEAN NOT NULL DEFAULT true,
    "showriskwidget" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "systemsettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ticket" (
    "id" SERIAL NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "branch_id" INTEGER,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,
    "storage_location" TEXT NOT NULL DEFAULT 'Vault A',
    "loan_amount" DOUBLE PRECISION NOT NULL,
    "interest_rate" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ishighrisk" BOOLEAN NOT NULL DEFAULT false,
    "pawn_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "forfeituredate" TIMESTAMP(3),
    "pawnshop_id" UUID,
    "updatedat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."transaction" (
    "id" TEXT NOT NULL,
    "ticketid" INTEGER,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staffname" TEXT NOT NULL,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_invites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "pawnshop_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'BRANCH_ADMIN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."profiles" (
    "id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "pawnshop_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT,
    "full_name" TEXT,
    "branch_id" TEXT,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."activitylog" (
    "id" SERIAL NOT NULL,
    "staffid" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activitylog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_name_key" ON "public"."category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pawnshops_name_key" ON "public"."pawnshops"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pawnshops_tax_id_key" ON "public"."pawnshops"("tax_id");

-- CreateIndex
CREATE UNIQUE INDEX "systemsettings_branchid_key" ON "public"."systemsettings"("branchid");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_ticket_number_key" ON "public"."ticket"("ticket_number");

-- AddForeignKey
ALTER TABLE "public"."branch" ADD CONSTRAINT "branch_pawnshop_id_fkey" FOREIGN KEY ("pawnshop_id") REFERENCES "public"."pawnshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer" ADD CONSTRAINT "customer_pawnshop_id_fkey" FOREIGN KEY ("pawnshop_id") REFERENCES "public"."pawnshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory" ADD CONSTRAINT "inventory_categoryid_fkey" FOREIGN KEY ("categoryid") REFERENCES "public"."category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory" ADD CONSTRAINT "inventory_ticketid_fkey" FOREIGN KEY ("ticketid") REFERENCES "public"."ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loan" ADD CONSTRAINT "loan_ticketid_fkey" FOREIGN KEY ("ticketid") REFERENCES "public"."ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."loan" ADD CONSTRAINT "loan_pawnshop_id_fkey" FOREIGN KEY ("pawnshop_id") REFERENCES "public"."pawnshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."staff" ADD CONSTRAINT "staff_branchid_fkey" FOREIGN KEY ("branchid") REFERENCES "public"."branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."systemsettings" ADD CONSTRAINT "systemsettings_branchid_fkey" FOREIGN KEY ("branchid") REFERENCES "public"."branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ticket" ADD CONSTRAINT "ticket_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ticket" ADD CONSTRAINT "ticket_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ticket" ADD CONSTRAINT "ticket_pawnshop_id_fkey" FOREIGN KEY ("pawnshop_id") REFERENCES "public"."pawnshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."transaction" ADD CONSTRAINT "transaction_ticketid_fkey" FOREIGN KEY ("ticketid") REFERENCES "public"."ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."admin_invites" ADD CONSTRAINT "admin_invites_pawnshop_id_fkey" FOREIGN KEY ("pawnshop_id") REFERENCES "public"."pawnshops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_pawnshop_id_fkey" FOREIGN KEY ("pawnshop_id") REFERENCES "public"."pawnshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
