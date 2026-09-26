---
schema_version: 1
open_count: 4
waived_count: 0
fixed_count: 0
total_count: 4
last_updated: 2026-09-26T05:28:36.969Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 10.1 | deviation | mobile/lib/main.dart | 5232 | Mobile Account Security screen posts only {newPassword} to POST /security/change-password; the D-03 contract now requires currentPassword + confirmPassword, so this call 400s until the mobile client is migrated in the mobile-parity plan | open |  | 2026-09-25T17:18:55.870Z |  |
| 2 | 10.1 | unmet-truth | frontend/src/lib/kycDocs.test.ts |  | Pre-existing failure: 'rejects when supabase returns an error' and 'rejects when no signedUrl is returned' fail; outside plan 10.1-05's file set and not caused by the credential-form migration | open |  | 2026-09-26T05:19:32.723Z |  |
| 3 | 10.1 | unmet-truth | frontend/src/components/__tests__/InventoryVault.test.tsx |  | Pre-existing failure: 'marks active items for auction' fails; outside plan 10.1-05's file set and not caused by the credential-form migration | open |  | 2026-09-26T05:19:33.130Z |  |
| 4 | 10.1 | deviation | backend/src/common/permissions/permissions-catalog.spec.ts | 474 | 10.1-04 made POST /staff/:id/password permission-gated, so the catalog count is 83 not 82 and MATRIX lacks app.controller.ts::changeStaffPassword; owned by plan 10.1-12 | open |  | 2026-09-26T05:28:36.969Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "10.1",
    "file": "mobile/lib/main.dart",
    "line": 5232,
    "description": "Mobile Account Security screen posts only {newPassword} to POST /security/change-password; the D-03 contract now requires currentPassword + confirmPassword, so this call 400s until the mobile client is migrated in the mobile-parity plan",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-25T17:18:55.870Z",
    "resolved_at": null,
    "milestone": "v2.0"
  },
  {
    "id": 2,
    "kind": "unmet-truth",
    "phase": "10.1",
    "file": "frontend/src/lib/kycDocs.test.ts",
    "line": null,
    "description": "Pre-existing failure: 'rejects when supabase returns an error' and 'rejects when no signedUrl is returned' fail; outside plan 10.1-05's file set and not caused by the credential-form migration",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-26T05:19:32.723Z",
    "resolved_at": null,
    "milestone": "v2.0"
  },
  {
    "id": 3,
    "kind": "unmet-truth",
    "phase": "10.1",
    "file": "frontend/src/components/__tests__/InventoryVault.test.tsx",
    "line": null,
    "description": "Pre-existing failure: 'marks active items for auction' fails; outside plan 10.1-05's file set and not caused by the credential-form migration",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-26T05:19:33.130Z",
    "resolved_at": null,
    "milestone": "v2.0"
  },
  {
    "id": 4,
    "kind": "deviation",
    "phase": "10.1",
    "file": "backend/src/common/permissions/permissions-catalog.spec.ts",
    "line": 474,
    "description": "10.1-04 made POST /staff/:id/password permission-gated, so the catalog count is 83 not 82 and MATRIX lacks app.controller.ts::changeStaffPassword; owned by plan 10.1-12",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-26T05:28:36.969Z",
    "resolved_at": null,
    "milestone": "v2.0"
  }
]
````
