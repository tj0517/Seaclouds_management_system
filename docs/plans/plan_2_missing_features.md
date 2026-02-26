# Plan 2: Missing Features

🟡 **Priority: MEDIUM** — Referenced in UI but not yet implemented.

---

## Feature 1: Admin Stats Page

**Problem**: Sidebar links to `/admin/stats` but the page doesn't exist (404). `getAdminStats()` in [stats.ts](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/data/actions/stats.ts) is implemented but unused.

### Proposed Changes

#### [MODIFY] [stats.ts](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/data/actions/stats.ts)
Expand `getAdminStats()` to also return:
- Total hours this month
- Total submissions this month
- Hours per project breakdown (for a chart)

#### [NEW] app/admin/stats/page.tsx
Build a stats dashboard with:
- **Summary cards**: Total projects, total users, total hours this month, submissions count
- **Hours per project** breakdown table or simple bar list
- Uses existing shadcn `Card` components — no new dependencies needed

> [!NOTE]
> If you want proper charts later, a library like `recharts` can be added, but for v1 a simple card + table layout is sufficient.

---

## Feature 2: CSV Export

**Problem**: "Eksportuj CSV" button on [reports/page.tsx](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/admin/reports/page.tsx) is disabled/placeholder.

### Proposed Changes

#### [NEW] app/admin/reports/export/route.ts
Create an API route that:
1. Accepts `?from=...&to=...` query params
2. Calls `getReportData(from, to)` (same data as the reports page)
3. Formats as CSV (date, employee, project, hours)
4. Returns with `Content-Type: text/csv` and `Content-Disposition: attachment`

#### [MODIFY] [reports/page.tsx](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/admin/reports/page.tsx)
- Remove `disabled` from the export button
- Make it an `<a>` link pointing to `/admin/reports/export?from=...&to=...`

---

## Verification Plan

### Manual Verification
1. Navigate to `/admin/stats` → should show dashboard with project/user counts and monthly hours
2. Navigate to `/admin/reports`, set a date range, click "Eksportuj CSV" → browser should download a `.csv` file with correct data
