# Plan 3: Admin CRUD Completion

🟡 **Priority: MEDIUM** — Admin panel is functional but missing standard CRUD operations.

---

## Gap 1: Edit & Delete Projects

**Problem**: Projects can be created but not edited or deleted.

### Proposed Changes

#### [MODIFY] [projects.ts](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/data/actions/projects.ts)
Add two new server actions:
- `updateProject(id, formData)` — update name, project_code, description, is_active
- `deleteProject(id)` — soft-delete by setting `is_active = false` (or hard delete if no entries exist)

#### [MODIFY] [admin/projects/[id]/page.tsx](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/admin/projects/%5Bid%5D/page.tsx)
- Add "Edytuj" button that opens an edit dialog/form (reuse `createProject` form structure)
- Add "Usuń/Dezaktywuj" button with confirmation dialog

---

## Gap 2: Delete / Deactivate Users

**Problem**: Users can have roles changed but cannot be removed from the system.

### Proposed Changes

#### [MODIFY] [users.ts](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/data/actions/users.ts)
Add `deactivateUser(userId)`:
- Remove all project assignments
- Optionally: add an `is_active` field to `profiles` table (requires DB migration)
- Or: just remove all assignments as a soft block

#### [MODIFY] [admin/users/[id]/page.tsx](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/admin/users/%5Bid%5D/page.tsx)
- Add "Usuń pracownika" button with confirmation

> [!WARNING]
> Full user deletion requires Supabase Admin API (deleting from `auth.users`). A simpler approach is to remove all assignments and flag them inactive. Decide which approach before implementing.

---

## Gap 3: Responsive Admin Sidebar

**Problem**: Admin sidebar is a fixed 256px `<aside>` — unusable on mobile.

### Proposed Changes

#### [MODIFY] [admin/layout.tsx](file:///Users/tymonjezionek/Desktop/seaclouds%20timesheet/my-app/app/admin/layout.tsx)
- Hide sidebar on mobile (`hidden md:flex`)
- Add a hamburger button (`Menu` icon from lucide) visible only on mobile
- Use a shadcn `Sheet` (slide-over panel) or simple state toggle for mobile nav
- May need to convert to a client component or extract a `AdminSidebar` client component

---

## Verification Plan

### Manual Verification
1. Edit a project name/code → should persist after page reload
2. Delete/deactivate a project → it should disappear from user's timesheet
3. Remove a user's assignments → they should no longer see those projects
4. Resize browser to mobile width → sidebar should collapse into a hamburger menu
