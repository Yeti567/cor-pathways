# AI Form Converter: plan (2026-10-17)

Source studied: FastField's public pages and help centre (AI Form Converter, Introduction to the AI
Form Builder, Prompt the AI Assistant). No FastField code was used. This is what their product
does from the outside, rebuilt on our own form model.

## What FastField does

| FastField feature | Detail from their docs |
|---|---|
| Upload a form | PDF, Word, Excel, JPG/PNG, phone photo; up to 20 pages or 20 images; 10 MB per file |
| Describe a form | Plain words, voice dictation, or an idea chip ("Inspection Checklist") |
| AI builds it | Pages, sections, field types (text, checkbox, date, signature, photo...), options, required, rules and calculations |
| Review, then publish | Lands in the builder as a draft; a person checks it and publishes |
| AI Assistant | Chat edits on the open form ("make Reason required when Result is Fail"); applies at once; undo/redo of the last 20 changes; skips a rule that names a field that does not exist and says so |
| Rules | Show / hide / require a field based on another answer |

## What we already had

- `FormImportPanel` + `scanUploadedFormForReview`: OCR then text-only field guessing, one flat
  "Imported Fields" section, file posted through a Server Action (breaks above 1 MB).
- No conditional logic anywhere in the form runtime.

## What this change builds

1. **Show-when rules** (`settings.showWhen = { itemId, anyOf }`), `src/lib/form-logic.ts`.
   The crew renderer hides an item until its controlling answer matches; a hidden item is never
   required, and its answer is dropped on submit. Repeatable sections test the same entry.
   A rule whose controlling field is gone is ignored (the field shows), never a dead field.
   Editable in the builder ("Only show this when...").
2. **Converter** (`src/lib/form-converter.ts`, `POST /api/form-converter`): the model reads the
   pages themselves (PDF or photo, up to 10 files / 20 pages), or a typed description, or an
   Excel sheet, and returns sections, fields, options, required and show-when rules. Everything
   it returns is validated against our field types before anyone sees it.
3. **Ask for changes**: the same route takes the current draft plus a plain-language request and
   returns the revised draft. Undo/redo of the last 20 versions, in the browser.
4. **Upload straight to storage** (`{tenant}/form-import/{batch}/`), like Document Intake, so no
   1 MB limit. Source files are deleted once read: the form is the record, the scan is not kept.
5. **Save as a hidden draft**: private, off the app menu, so crews see nothing until it is
   published from the builder. Evidence-photo boxes and corrective-action boxes are OFF unless
   the line is a pass/fail check (see the evidence-photo trap in the 2026-08-28 notes).

## Not in this change (follow-ups)

- The AI Assistant on an existing, saved form (today it works on the draft before saving).
- Calculations (Total = Quantity x Price) and date/photo/GPS options from a prompt.
- Voice dictation (browser speech API) on the describe box.
- Word (.docx) upload: ask for a PDF instead for now.
