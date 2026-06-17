# Session Notes

## 2026-06-12 — Earnings Feature

### What was built
- **Earnings admin tab** (`/admin/earnings`) showing all users (no role filter) with monthly earnings computed from submitted timesheets + approved expenses
- **Filters**: employee, project, status (pending/submitted/paid/declined)
- **Detail page** (`/admin/earnings/[userId]`): per-line timesheet breakdown with rate × worked = earnings, timesheet PDF link, expense receipt links
- **Status management**: inline `StatusSelect` dropdown per user, stored in `earnings_month_status` table

### Key files
| File | Purpose |
|------|---------|
| `app/data/actions/earnings.ts` | All server actions for earnings |
| `app/admin/earnings/page.tsx` | RSC page |
| `app/admin/earnings/AdminEarningsClient.tsx` | Filters + table |
| `app/admin/earnings/[userId]/page.tsx` | Detail view |
| `app/admin/earnings/StatusSelect.tsx` | Status dropdown |

### Bugs fixed
- **Timezone bug** in `weekStart()` — was using local time, causing UTC+2 date shift that broke submitted week matching. Fixed to use `Date.UTC()` throughout.
- **PostgREST nested FK** — `sub_projects(project_id)` returns null in nested selects. Workaround: map project IDs via `projects → sub_projects(id)` embed.
- **All profiles shown** — removed `.eq('role', 'employee')` filter so admins appear in earnings tab too.

---

## Next Task — PDF Export for Expenses

Generate a downloadable PDF for an employee's expense table.

### What already exists
- `expense_tables` + `expense_entries` tables with all expense data
- `expense-receipts` storage bucket (receipt files)
- `timesheet-exports` bucket + `pdf_exports` table (pattern to follow)
- `app/data/actions/pdf.ts` — existing timesheet PDF generation logic
- `app/admin/expenses/[id]/AdminExpenseDetail.tsx` — good place to add a download button

