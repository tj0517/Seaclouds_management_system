# Plan 1: Critical Fixes

🔴 **Priority: HIGH** — These are bugs affecting security and data correctness.

---

## ~~Fix 1: Wire the Middleware~~ ✅ Already Done

`proxy.ts` **is** the middleware in Next.js 16 — no separate `middleware.ts` needed. Route protection is already working.

---

## Fix 2: Broken Reports Query

**Problem**: [timesheet.ts → getReportData()](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/data/actions/timesheet.ts#L126-L151) queries:
```
profiles:user_id ( full_name ),
projects:project_id ( name )
```
But `timesheet_entries` has `sub_project_id`, **not** `project_id`. The join silently fails → "Usunięty projekt" for every row.

### Proposed Changes

#### [MODIFY] [timesheet.ts](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/data/actions/timesheet.ts)

Update `getReportData()` to join through `sub_projects` → `projects`:
```diff
 .select(`
   id,
   work_date,
   hours,
   profiles:user_id ( full_name ),
-  projects:project_id ( name )
+  sub_projects:sub_project_id ( code, description, projects:project_id ( name ) )
 `)
```

#### [MODIFY] [reports/page.tsx](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/admin/reports/page.tsx)

Update the `ReportEntry` type and table rendering to use the nested structure:
- `entry.projects?.name` → `entry.sub_projects?.projects?.name`
- Add sub-project code display in the table

---

## Verification Plan

### Manual Verification
1. Run `npm run dev` and open `http://localhost:3000` while **not logged in** → should redirect to `/login` (tests middleware)
2. Log in as admin → go to `/admin/reports` → entries should show correct project names instead of "Usunięty projekt"
3. Try accessing `/admin` directly in an incognito window → should redirect to `/login`
