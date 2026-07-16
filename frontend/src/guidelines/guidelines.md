# PawnHub Enterprise - System Architecture

## 1. Frontend Infrastructure
* **Framework:** React + Vite (Tailwind CSS v4)
* **Design System:** Professional Financial Dashboard (Inter Font, Slate/Blue Palette)
* **State Management:** "Lifting State" to `App.jsx` to ensure data synchronization across the Dashboard, POS, and Inventory.

## 2. Key Component Responsibilities
| Component | Function |
| :--- | :--- |
| **Dashboard** | Real-time financial analytics (Loans, Customers, Asset Mix). |
| **Sales & POS** | AI-assisted item appraisal and loan generation. |
| **CRM** | Customer profiling and loyalty tracking. |
| **Inventory & Vault** | Secure tracking of physical assets and vault status. |
| **Decision Support** | AI risk assessment based on branch liquidity. |

## 3. Styling Guidelines (Tailwind v4)
* **Entry Point:** `index.css` imports the Tailwind engine and `globals.css`.
* **Theme:** Uses `@theme inline` for PawnHub brand variables (Primary: `#030213`).
* **Typography:** `Inter` font family applied globally via `@layer base`.

## 4. Development Workflow
* **Backend:** Start first via `npm run dev` in `/backend`.
* **Frontend:** Start second via `npm run dev` in `/frontend`.
* **Type Safety:** Ensure all props are defined via Interfaces to prevent build errors.