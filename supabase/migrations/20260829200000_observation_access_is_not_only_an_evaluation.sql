-- An audit can take a driver's site access away. Let it say so.
--
-- WHAT THIS CORRECTS. 20260829190000 shipped with a constraint saying only an evaluation
-- may carry site_access, on the reasoning that an evaluation is the formal gate and an
-- audit is a spot observation. Reading the nine reports that table was built for showed
-- that is not how the client works.
--
-- On 23 May 2025 an FHR PPE AUDIT -- not an evaluation -- found this driver unshaven with
-- a monitor due for calibration and wrote: "Due to the 2 deficiencies noted his 24hr
-- access is going to be limited to 8am to 4pm access effective immediatley. He will get
-- full access back as of May 27th." A site observer restricted a driver's access from an
-- audit, in the same email that recorded what they saw.
--
-- The constraint would have forced that fact into free text, and the site standing view
-- would then have read "unlimited since 20 May 2025" while a report three days later said
-- he was working restricted hours. Showing a standing that a document beside it
-- contradicts is the exact failure the rest of this module is built to avoid.
--
-- So: any observation may state an access level, and the standing is set by the newest
-- observation that states one, whatever kind it is. The audit/evaluation distinction
-- stays -- it is still the difference between a formal assessment and somebody watching a
-- task, and it is how the driver file groups them -- it just no longer decides who is
-- allowed to change what a driver may do. The client decides that, and the app's job is
-- to record it.

alter table "public"."contracted_driver_observation"
  drop constraint if exists "contracted_driver_observation_access_is_an_evaluation_check";

comment on column "public"."contracted_driver_observation"."site_access" is
  'The access level the report states: unlimited, limited or suspended. Null where it says nothing about access, which is most of them. Set by whichever observation states it -- an audit can restrict a driver on the spot, and one did.';

comment on column "public"."contracted_driver_observation"."observation_type" is
  'audit or evaluation: a formal assessment, or somebody watching a task. It groups the driver file and nothing more -- it does not decide which reports may change site access.';
