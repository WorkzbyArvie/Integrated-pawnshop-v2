---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-09-25T17:18:55.870Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 10.1 | deviation | mobile/lib/main.dart | 5232 | Mobile Account Security screen posts only {newPassword} to POST /security/change-password; the D-03 contract now requires currentPassword + confirmPassword, so this call 400s until the mobile client is migrated in the mobile-parity plan | open |  | 2026-09-25T17:18:55.870Z |  |

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
  }
]
````
