-- Deliberately broken-CI demo: schema change WITHOUT regenerating
-- packages/db/src/database.ts. The type-drift check must fail.
CREATE TABLE public.ci_red_demo (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  note text
);
