import {
  checkboxClass,
  inputClass,
  labelClass,
  labelTextClass,
  textareaClass,
} from "@/app/admin/purchasing/_components/PurchasingChrome";
import type { SupplierRow } from "@/app/admin/purchasing/_lib/purchasing-data";

/** The supplier form, shared by the add panel and the supplier's own page. */
export function SupplierFields({ supplier }: { supplier?: SupplierRow }) {
  return (
    <>
      <label className={labelClass}>
        <span className={labelTextClass}>Name</span>
        <input className={inputClass} defaultValue={supplier?.name ?? ""} name="name" required />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          <span className={labelTextClass}>Contact name</span>
          <input className={inputClass} defaultValue={supplier?.contact_name ?? ""} name="contactName" />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Phone</span>
          <input className={inputClass} defaultValue={supplier?.phone ?? ""} name="phone" type="tel" />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Email</span>
          <input className={inputClass} defaultValue={supplier?.email ?? ""} name="email" type="email" />
        </label>
        <label className={labelClass}>
          <span className={labelTextClass}>Our account number</span>
          <input className={inputClass} defaultValue={supplier?.account_number ?? ""} name="accountNumber" />
        </label>
      </div>
      <label className={labelClass}>
        <span className={labelTextClass}>Address</span>
        <textarea className={textareaClass} defaultValue={supplier?.address ?? ""} name="address" />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Categories</span>
        <input
          className={inputClass}
          defaultValue={supplier?.categories.join(", ") ?? ""}
          name="categories"
          placeholder="Parts, PPE, Aggregates"
        />
        <span className="block text-xs text-[var(--ink-muted)]">Separate with commas.</span>
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Terms</span>
        <input
          className={inputClass}
          defaultValue={supplier?.terms_notes ?? ""}
          name="termsNotes"
          placeholder="Net 30, free delivery over $500"
        />
      </label>
      <label className={labelClass}>
        <span className={labelTextClass}>Notes</span>
        <textarea className={textareaClass} defaultValue={supplier?.notes ?? ""} name="notes" />
      </label>
      {supplier ? (
        <label className="flex items-start gap-2">
          <input className={`${checkboxClass} mt-0.5`} defaultChecked={!supplier.active} name="archived" type="checkbox" />
          <span className="text-sm text-[var(--ink)]">
            Archived
            <span className="block text-xs text-[var(--ink-muted)]">
              Hidden from new orders. Orders that already name it keep it.
            </span>
          </span>
        </label>
      ) : null}
    </>
  );
}
