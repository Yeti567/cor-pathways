# Municipal starter inspection forms

Seven editable inspection forms for a town's public works yard. They are starting points
written for this project, not certified checklists: check each one against your own
inspection programme, your equipment manufacturers' instructions and, for playgrounds,
the CSA Z614 standard.

| File | Form |
|---|---|
| `mun-play-vis.json` | Playground routine visual inspection |
| `mun-play-ops.json` | Playground monthly operational inspection |
| `mun-fac-safe.json` | Facility safety inspection |
| `mun-veh-pre.json` | Light vehicle pre-use inspection |
| `mun-eq-pre.json` | Heavy equipment pre-use inspection |
| `mun-walk-trail.json` | Sidewalk and trail inspection |
| `mun-hyd.json` | Fire hydrant inspection |

Every pass, fail or N/A check carries a `severity` (critical, major or minor) and an
`autoWorkOrder` flag, which the maintenance module reads when a check fails. Evidence
photos are switched off per item; each form has one photo field for the problem found.

## Installing one for a company

```
npx tsx scripts/apply-form-definition.ts --definition templates/forms/municipal/mun-play-vis.json --tenant <tenant uuid> --create
```

That is a dry run. Add `--apply` to create the form. Running it again later with an edited
file reshapes the form in place and never deletes an item, so submissions already filed
keep their answers.
