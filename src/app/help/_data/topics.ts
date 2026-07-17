export type HelpTopic = {
  slug: string;
  title: string;
  category: HelpCategory;
  summary: string;
  body: string;
  tags: string[];
};

export type HelpCategory =
  | "Getting started"
  | "Forms"
  | "Workers & Locations"
  | "Workflows & Automation"
  | "Equipment"
  | "Transport & ELD"
  | "Documents & Resources"
  | "Analytics & Reports"
  | "Offline & Sync"
  | "Account & Billing";

export const helpCategories: HelpCategory[] = [
  "Getting started",
  "Forms",
  "Workers & Locations",
  "Workflows & Automation",
  "Equipment",
  "Transport & ELD",
  "Documents & Resources",
  "Analytics & Reports",
  "Offline & Sync",
  "Account & Billing",
];

export const helpTopics: HelpTopic[] = [
  {
    slug: "create-your-first-form",
    title: "Create your first form",
    category: "Getting started",
    summary: "Go from blank tenant to a published form in five minutes.",
    tags: ["form builder", "forms", "create", "new", "start"],
    body: `## Start in the Form Builder

Open the admin panel and choose **Forms** from the side navigation. Click **New Form** at the top right. Pick a status (Draft is the right default), a name, and a short code that workers will recognise. The code becomes part of every Document Control Number that form generates, so keep it short and tidy.

## Add sections and fields

Each form is built from sections; each section holds fields (called items). Use **Add Section** to start, then add items inside it. A section can be marked Collapsible (workers expand it on demand) or Repeatable (workers add another copy on the fly, perfect for "list each defect").

When you add a dropdown field, the Details panel opens automatically so you can pick a managed list as its options source. If a dropdown is missing its source, an amber "Choose list" button appears next to Details.

## Test the form

Click **Preview** in the top right. Date and time fields are interactive in the preview, the OS calendar will open exactly like it will for workers. Everything else is rendered visually but inert.

## Publish

Set the form status to **Published** and save. Assign it to locations or workers from the Forms list. Workers will see it in their Assigned Forms feed on the worker app.`,
  },
  {
    slug: "import-a-pdf-form",
    title: "Import a paper or PDF form into the builder",
    category: "Forms",
    summary: "Upload a blank PDF and let Google Document AI plus Gemini draft the form for you.",
    tags: ["pdf", "import", "ocr", "scan", "document ai", "gemini"],
    body: `## When to use the PDF importer

Use it for blank forms you already run on paper. The importer reads the field labels and types off the page and produces a form-builder draft you can refine. It does not read filled-in answers, only blank templates.

## How to import

From **Forms**, click the **Import PDF** button (or upload via the Documents tab). The system uploads the PDF, sends it through Google Document AI for field detection, and asks Gemini (via OpenRouter) to draft the form schema. You will land in a review screen with the detected fields and types.

## Review and fix anything missing

Detection is good but not perfect. Common things to fix:

- A "Select Date" field detected as Short Answer, switch it to **Select Date**.
- Yes/No questions sometimes come through as text, switch to **Yes / No / NA** or **Pass / Fail / NA**.
- Repeatable groups (rows for defects) need to be wrapped in a Repeatable Section by hand.

When the draft looks right, save the form. It lives in your Drafts list until you publish it.`,
  },
  {
    slug: "connect-dropdown-managed-list",
    title: "Connect a dropdown to a managed list",
    category: "Forms",
    summary: "Use one tenant-wide list (Vehicle Types, Hazards, Risk Severity) on every form. Edit once, every form updates.",
    tags: ["dropdown", "managed lists", "lists", "options"],
    body: `## Two ways to fill a dropdown

Every Drop-down List field has an **Options source** picker in its Details panel:

1. **Manual options**: type the options into the field. Best for one-off lists.
2. **Managed list**: pick a tenant-wide list. Workers always see the latest items every time they open the form.

## Where managed lists live

Side nav → **Managed Lists**. You can create new lists there, add items, mark items active or inactive, and toggle "Include Other" so workers can type a custom answer.

## Connecting on the form

In the Form Builder, expand a dropdown field's **Details** panel. The **Options source** select lists every managed list in your tenant. Choose one and the field is connected. A "Manage lists" link sits next to it for quick navigation.

If you add a brand-new dropdown to a form, the Details panel opens automatically so you can connect it right away. Forgot? The row shows an amber **Choose list** chip until you connect a source.`,
  },
  {
    slug: "field-types-explained",
    title: "Every field type explained",
    category: "Forms",
    summary: "Twenty-plus field types: when to use each one.",
    tags: ["fields", "types", "pass fail", "checkbox", "date", "signature", "photo", "gps"],
    body: `## Decision types

- **Pass / Fail / NA**: three-state inspection answer. Failures can be flagged and routed to a corrective action.
- **Yes / No / NA**: softer three-state for questions like "Was anyone injured?"
- **Check Box**: a single ticked confirmation. Use for "I confirm I have read..."
- **Pass / Fail Total**: auto-tally a section of Pass/Fail/NA items into a "Passed X / Failed Y" summary.

## Text and numbers

- **Short Answer / Long Answer**: open text. Long Answer expands as the worker types.
- **Text Info Block**: instructional text the worker reads but doesn't fill in (Markdown-style emphasis allowed).
- **Number Only**: numeric input with optional min, max, and decimal places.

## Choice lists

- **Drop-down List: Select One**: single-select. Can be backed by a managed list.
- **Drop-down List: Select Multiple**: multi-select. Can be backed by a managed list.

## Time-based

- **Select Date**: opens the OS calendar picker.
- **Select Time**: opens the OS time picker.

## Captures

- **Signature**: fingertip or stylus signature pad. Stored locally and uploaded offline.
- **Take Photo**: opens the camera. Photos queue in IndexedDB if the worker is offline.
- **Add GPS Coordinates**: captures device location at the moment of tap.

## Files

- **Insert PDFs**: worker attaches one or more PDFs (think incident report scans).
- **View PDF / View Image**: admin-supplied reference document the worker reads inside the form.

## People and equipment pickers

- **Select Worker**: single-select dropdown listing every active worker. Optional "current worker only" scope.
- **Select Multiple Workers**: checkbox list, perfect for "Workers present today."
- **Select Equipment**: dropdown listing equipment, optionally scoped to the worker's assignments or current location.`,
  },
  {
    slug: "add-and-import-workers",
    title: "Add workers, import a CSV, or send invites",
    category: "Workers & Locations",
    summary: "Three ways to get your roster into the app.",
    tags: ["workers", "employees", "csv", "invite", "import"],
    body: `## Adding workers one at a time

**Workers** in the side nav → **Add Worker**. Fill name, email, title, and starting permission profile. Save. The worker is created in Draft state until you mark them active.

## Bulk import via CSV

Click **Import Workers** at the top of the Workers page. Download the CSV template (Name, Email, Title, Reach, Locations, Permission Profile), fill it in, upload it. Rows with errors are reported per-row so you can fix and retry.

## Invitations and SSO

If your tenant uses SSO (Azure, WorkOS, or another Supabase OAuth provider) workers sign in with their work account on first visit. With email login, share the app URL, workers sign up themselves with the email you have on file and the system matches them to their pre-created profile.`,
  },
  {
    slug: "permissions-and-reach",
    title: "Permissions, power levels, and reach",
    category: "Workers & Locations",
    summary: "Power level is what someone can do. Reach is what they can touch. Combine for the role you actually need.",
    tags: ["permissions", "reach", "roles", "access", "supervisor", "admin"],
    body: `## Two independent dimensions

**Power level** is the ceiling of what a user can do. There are six tiers, top to bottom: Consultant, Super Admin, Admin, Manager, Supervisor, Worker.

**Reach** is what a user can see and touch. All projects in the tenant, or a specific subset of projects. A Manager with all-project reach is your General Manager. The same Manager scoped to one project is a Project Manager. You don't need two roles, the same role with different reach gives you both.

## Custom Permission Profiles

Power tiers set the maximum. Permission Profiles tune what someone can actually do inside that maximum. The four seeded profiles are App Admin, App Supervisor, Worker (Solo), and Worker (Team). Create your own from **Permission Profiles** to match your org chart.

## Where to set each

- **Power level + reach** → Workers page → click a worker → **App Access** tab.
- **Permission profile** → same place.
- **Assigned locations** → Workers page → worker → **Current Locations**.`,
  },
  {
    slug: "track-certifications-and-tickets",
    title: "Track worker certifications and ticket photos",
    category: "Workers & Locations",
    summary: "Upload a photo of a First Aid or H2S card; the OCR pulls the expiry and files it against the worker.",
    tags: ["certifications", "tickets", "h2s", "first aid", "expiry", "ocr"],
    body: `## Set up certification types

**Certification Types** in the side nav lists the credentials your company tracks (First Aid Level 1, H2S Alive, WHMIS, etc.). Add the ones you need; mark whether they expire.

## Upload a worker ticket

From **Employee Tickets** or any worker's Certifications tab, click **Upload Ticket**. Pick the worker, the certification type, take a photo of the card. The system runs OCR to pull the expiry date and pre-fills the form for you to confirm. The ticket image is stored against the worker.

## Expiry tracking and reminders

Workers whose certifications are within their renewal window show on the **Worker Tickets** register filtered to "Expiring soon" / "Deficiency". Reminder emails are wired to a cron job, they fire weekly to the worker and to their supervisor.

## Delete a ticket

Each ticket card has a Delete button. Use it when a ticket was uploaded in error or has been replaced by a newer one. Tenant audit log records every deletion.`,
  },
  {
    slug: "build-a-workflow",
    title: "Build a workflow chain",
    category: "Workflows & Automation",
    summary: "Trigger forms from forms, branch on answers, and roll the whole thing through to sign-off.",
    tags: ["workflow", "automation", "branching", "chain", "trigger"],
    body: `## When workflows help

Use a workflow when one form completion should trigger more forms, and those next forms depend on the answers given. The classic example is an on-site injury: the First Aid form completes, the Incident Report is required, and depending on whether the worker was admitted to hospital, a Ministry of Labour report is or isn't required.

## Create a workflow

**Workflow Station** in the side nav → **Create Workflow**. Name it. Pick the trigger form. Add steps in order. For each step, pick the next form to fire. To branch, add conditions on a named field's value from a previous form ("If 'Was the worker admitted?' equals 'Yes' on the Incident Report, fire the MoL form").

## Schedules and reminders

The same screen has **Create Schedule** for time-based work: monthly site inspection, biweekly time card, hourly equipment check. The system fires the assignment, reminds the assignee, and marks anything missed as Overdue on the **Due and Overdue** panel.

## Flag and assign

Inside any inspection form, any failed item can be **Flagged**. Flagging assigns a corrective action to a specific worker with an attached photo. The parent form is signed and closed; the corrective action lives on with its own lifecycle (open → assigned → in progress → completed → signed off) in **Corrective Actions**.`,
  },
  {
    slug: "manage-equipment",
    title: "Equipment files, meters, and scheduled service",
    category: "Equipment",
    summary: "Per-unit pages with meter history, maintenance log, service schedules, and every form ever submitted on the unit.",
    tags: ["equipment", "trucks", "meter", "maintenance", "service"],
    body: `## Adding equipment

**Equipment** in the side nav → **Add Equipment**. Fill in unit number, name, category, license plate, current meter, location, and assigned worker. Save. The unit now has its own page (click the row).

## Per-unit page

Each equipment file has tabs for:
- **Meter readings**: log new readings; the system tracks rate of use.
- **Maintenance**: every service or repair, with cost and attachments.
- **Scheduled services**: interval-based (every 90 days) or meter-based (every 250 hours). Overdue services bubble up automatically.
- **Documents**: attached PDFs (manuals, inspection certificates).
- **Linked forms**: every form submission that referenced this unit.

## Equipment in forms

Add a **Select Equipment** field on any inspection form. Workers can pick the unit they're inspecting; the submission auto-links to that equipment's file.

## Per-equipment submission link

Generate a one-tap submission link from an equipment file. Workers (or external contractors) scan a QR code at the truck, the form opens pre-filled with that unit, they submit. No login required if the link is set to public mode.`,
  },
  {
    slug: "set-up-commercial-vehicle",
    title: "Set up a commercial vehicle file (registration, insurance, CVIP, maintenance)",
    category: "Equipment",
    summary:
      "Mark a truck or trailer as commercial (NSC) and the file requires registration, insurance, CVIP, and a maintenance record, then tracks every renewal date.",
    tags: ["commercial", "nsc", "vehicle", "truck", "trailer", "cvip", "registration", "insurance", "compliance", "incomplete"],
    body: `## What marking a unit "commercial" does

Marking a unit as a **Commercial vehicle (NSC)** turns on the document checklist a regulated truck or trailer must satisfy. Until the required documents are on file, the unit's page shows a red **File incomplete** badge and a banner listing what is missing. Light units like pickups or shop tools stay simple: leave the box unchecked and nothing changes for them.

## Step 1: Add or open the unit

Open **Equipment** in the side nav. Click **Add Equipment** for a new unit, or click an existing row to open its file. Fill in the unit number, name, category (**Vehicle** or **Trailer** for commercial units), tracking mode (Mileage for trucks, Hours for some equipment), current meter, and licence plate.

## Step 2: Turn on the commercial flag

On the **Add Equipment** form, tick **Commercial vehicle (NSC)** before saving. For a unit that already exists, open its file, go to the **Overview** tab, click **Edit Equipment**, tick **Commercial vehicle (NSC)**, and save. The file now tracks the required documents and shows its completeness state at the top.

## Step 3: Upload the required documents

A commercial unit must have all of these on file:

- **Registration**
- **Insurance**
- **CVIP inspection** (the Commercial Vehicle Inspection Program certificate)
- **A maintenance record** (covered in Step 4)

Open the unit, go to the **Documents** tab, and click **Add Document** for each one:

1. **Title**, for example "2026 Registration".
2. **Document type**: pick the matching type (Registration, Insurance, or CVIP inspection). This is the link that ticks the item off the checklist, so choose the correct type.
3. **Issued date** and **Expiry date** (required). For CVIP, the expiry date is the inspection due date.
4. **Reminder lead days** (default 30): how far ahead of expiry to start warning.
5. **Scans or photos**: upload the actual PDF or photo of the document. You can attach more than one file.

Save. The checklist at the top of the Documents tab ticks each item green as you add it, and stored files are downloadable from the document list.

## Step 4: Add the maintenance record

The maintenance requirement is met when the unit has at least one maintenance entry or a set-up service schedule. Do either:

- **Maintenance** tab, **Log Maintenance**: record a service or repair (with cost and attachments), or
- **Service Schedule** tab: set up a recurring service, for example an oil change every 5,000 km (see the equipment service article for intervals, ranges, and warnings).

## How renewal dates are tracked

Registration, insurance, and CVIP each carry an expiry date. The app counts down to each date, warns managers before it lapses, and marks the file incomplete with **(expired)** once a date passes. CVIP behaves exactly like the others: enter its inspection due date as the expiry and you get the reminder and the countdown automatically.

## Reading the file at a glance

- **Header badge**: green **File complete** or red **File incomplete**.
- **Red banner**: lists exactly what is missing, with an **Upload documents** button straight to the Documents tab.
- **Documents tab checklist**: Registration, Insurance, CVIP inspection, and Maintenance record, each shown as present, missing, or expired.

## Trailers

Trailers are commercial equipment too. Mark the trailer as a **Commercial vehicle (NSC)** and it requires the same documents, including CVIP. A trailer has no odometer, so its service schedule tracks by date instead of meter.`,
  },
  {
    slug: "connect-motive-eld",
    title: "Connect your fleet's Motive ELD (register the developer app)",
    category: "Transport & ELD",
    summary:
      "One-time setup so the app can pull Hours of Service straight from Motive. Register a Motive developer app and hand over its two keys.",
    tags: ["motive", "keeptruckin", "eld", "hours of service", "hos", "oauth", "integration", "transport"],
    body: `## What this does

Connecting Motive lets the app pull each driver's **Hours of Service** (duty status, available hours, and violations) automatically, instead of anyone typing logs in by hand. You connect **once per customer account** and it covers their whole fleet, every truck and driver. Nothing is installed in the trucks, and you never touch the customer's Motive billing.

This is a **one-time setup**. You register a single Motive "developer app," which gives you two keys (a Client ID and a Client Secret). After that, each customer just clicks **Connect** and approves access.

> Only ELDs certified for use in Canada are supported. Motive (formerly KeepTruckin) is on Transport Canada's certified list.

## Before you start

You need **admin access to a Motive account** and access to Motive's developer portal. If you are not the Motive account owner, ask them to add you, or to complete these steps and send you the two keys at the end.

## Step 1: Open the Motive developer portal

Go to **developer.gomotive.com** and sign in with your Motive account. Look for **Apps**, **API**, or **Developer** in the menu.

## Step 2: Create a new app

Choose **Create App** (sometimes called "New Application" or "Register App"). Give it a name you'll recognise, such as **"Cor Pathways HOS"**. A description like "Reads Hours of Service into our compliance app" is fine.

## Step 3: Set the redirect URL

When it asks for a **Redirect URL** (also called "Callback URL" or "OAuth redirect URI"), enter your own app's address followed by \`/api/eld/motive/callback\`, with no trailing space:

\`\`\`
https://your-app-domain.com/api/eld/motive/callback
\`\`\`

Replace \`your-app-domain.com\` with the domain you open this app on: whatever is in your browser's address bar right now, without the trailing path. This is the address Motive sends each customer back to after they approve access. It must match exactly or the connection will fail.

## Step 4: Choose read access for Hours of Service

If the app asks which **scopes** or **permissions** it needs, select **read** access for **Hours of Service / logs / drivers / vehicles**. The app only ever reads data, it never changes anything in Motive.

## Step 5: Copy the two keys

When the app is created, Motive shows a **Client ID** and a **Client Secret**. Copy both. The **Client Secret is shown once**: if you lose it, you can regenerate it later, but it's easiest to copy it now.

## Step 6: Hand the keys to your administrator

Send the **Client ID** and **Client Secret** to whoever manages this app's settings (keep the secret private, send it through a password manager or a secure message, not plain email). They get stored as protected settings, never in the app's code, and never shown to customers.

## What happens next

Once the keys are in place, the **ELD Connections** page (Transport → Hours of Service → ELD connections) lets a customer pick **Motive** from the dropdown and click **Connect**. They sign in to Motive, approve read access once, and their fleet's Hours of Service starts flowing into each driver's file automatically.

The same process works for other certified ELDs (Samsara, Geotab, ISAAC), each is its own one-time app registration, added as customers need them.`,
  },
  {
    slug: "set-up-commercial-driver",
    title: "Set up a commercial driver file (Driver Qualification and Hours of Service)",
    category: "Transport & ELD",
    summary:
      "Add a driver, build their Driver Qualification (DQ) file, track abstracts, medicals, and licences, and keep Hours of Service current.",
    tags: ["commercial", "driver", "dq", "driver qualification", "abstract", "medical", "licence", "hos", "hours of service", "transport"],
    body: `## What a commercial driver file is

A commercial driver's file (a **Driver Qualification**, or **DQ**, file) holds the records a regulated carrier must keep for each driver, plus their Hours of Service. The app tracks which records are on file, watches the renewal dates, and flags a driver with **deficiencies** until the file is complete and current.

## Step 1: Make sure the Transport module is on

Commercial driver files live in the **Transport** section. If you do not see **Transport** in the side nav, switch on the Commercial Vehicles / Transport module in settings (it is a per-tenant toggle).

## Step 2: Add the driver

Go to **Transport**, then **Drivers**, and open **Add Driver**. Enter:

- **Full name** (required)
- **Licence number** and **licence class** (for example Class 1)
- **Licence expiry** date
- **Hired on** date
- **Linked app user** (optional): connect the driver to their worker login so renewal reminders reach them directly
- **Notes**

Save. The driver now has their own file (click the row). The list shows a **Complete** or **X deficiencies** badge beside each driver.

## Step 3: Build the Driver Qualification (DQ) file

Open the driver's file. The DQ section lists every required record with its status. Upload each as a PDF or photo. The required DQ records are:

- **Application for employment**
- **Initial commercial abstract** (the driver's abstract at hire)
- **Annual abstract update**, refreshed at least every 12 months (date tracked, with a 45 day reminder)
- **Pre-employment work history**
- **Conviction and penalty records**
- **Reportable collision records**
- **Safety training and competency log**
- **Training certificates** (MELT, TDG, air brake, and any others)
- **Medical fitness verification**, a current medical certificate (date tracked, with a 45 day reminder)

For each record, upload the file and, where it applies, set the renewal date so the app can warn you before it expires.

## Step 4: Hours of Service

The **Hours of Service** section holds the driver's records of duty status (daily logs) and supporting documents.

- If you have connected an ELD (Motive and others), duty status flows in automatically. See "Connect your fleet's Motive ELD".
- Otherwise, log duty status by hand on the driver's HOS panel.
- Set the driver's **HOS cycle** on their file.

Records of duty status are required. Supporting documents are optional but recommended.

## Step 5: Medical records are restricted

Medical documents can be held in the restricted **Medical Vault** on the driver's file. Only users with **Medical vault** access (or the driver themselves) can open them. Grant that access with the **Medical vault** checkbox on a permission profile.

## Reading the file and staying ahead

- **Driver list**: each driver shows **Complete** (green) or **X deficiencies** (red). A deficiency is any required record that is missing or expired.
- **Transport hub**: a compliance snapshot shows drivers with deficiencies and the open missing and expired counts.
- **Reminders**: the app warns managers, and the linked driver, 45 days before an annual abstract, a medical, or a licence expires.

## Keeping the file current

A driver reads as complete only when every required record is on file and unexpired. The recurring tasks are:

- Refresh the **annual abstract** every 12 months.
- Renew the **medical** before it expires.
- Keep **training certificates** and the **licence** current.`,
  },
  {
    slug: "document-control-and-dcn",
    title: "Turn on Document Control and assign DCNs",
    category: "Documents & Resources",
    summary: "Optional per-tenant. Every form and uploaded resource gets a Document Control Number plus a tracked revision register.",
    tags: ["dcn", "document control", "revision", "compliance"],
    body: `## Turn it on

**Documents** in the side nav → **Document Control Setting** → toggle on. Once enabled, every new form template and every PDF uploaded to the Resource Library receives a **DCN**.

## DCN format

DCNs are composed from your tenant slug, the form or resource code, a two-digit revision, and an optional year segment. Example: \`ACME-VEHICLEINSP-01-26\` for revision 1 in year 2026 on the Vehicle Inspection form.

## Revision history

Every time you publish a new revision of a form or upload a new copy of a resource, the DCN's revision number ticks up and the old revision stays in the register. Open the **Document Control Register** on the Documents page to see every document, every revision, and who signed each one off.

## Numbering settings

The Documents page also has a **Numbering Settings** panel where you choose whether to include the year segment and how new DCNs are formatted.`,
  },
  {
    slug: "resource-library",
    title: "Set up the Resource Library",
    category: "Documents & Resources",
    summary: "A document repository workers can browse from the app, manuals, policies, SDS sheets, toolbox talks.",
    tags: ["resources", "library", "documents", "manuals", "sds"],
    body: `## Sections and reordering

On the Documents page, the **Resource Library Sections** panel lets you create sections (Manuals, Safe Work Practices, SDS Sheets, Toolbox Talks, etc.) and reorder them with the up/down arrows. The order on this page is the order workers see on the worker app's Resources tab.

## Add a resource

Inside a section, click **Add Resource**. Upload the PDF, give it a name, and assign it. With Document Control enabled, it receives a DCN automatically. Resources can be moved between sections or reordered within a section.

## How workers see it

In the worker app, the **Resources** tab shows the sections in order. Tapping a resource opens it in the device's PDF viewer. Resources are cached for offline viewing during sync.`,
  },
  {
    slug: "live-monitor-and-reports",
    title: "Watch submissions live with Monitor and Reports",
    category: "Analytics & Reports",
    summary: "The dashboard the owner refreshes all day plus the filter-and-export view for audits.",
    tags: ["monitor", "reports", "submissions", "export", "audit"],
    body: `## Live Monitor

**Monitor** in the side nav streams every submitted form, grouped by day, with date filters and per-submission signature counts. Click a submission to see the answers, attached photos, and the signed PDF. Tap **Print** to render a board-ready printout using your Print Settings.

## Reports

**Reports** is the same data with proper filters and export. Pick a date range, location, worker, or form. Export to CSV for audit packets or to PDF for archiving. Reports respect reach: managers see only their projects.

## Auto-share

Pair Monitor and Reports with **Auto-Share** (covered in its own help topic) and the right people get every completed form emailed to them automatically.`,
  },
  {
    slug: "analytics-trends",
    title: "Find trends in Analytics",
    category: "Analytics & Reports",
    summary: "Per-field analytics across every form flagged 'Use Form Item Data In Analytics'. Surfaces hot spots, repeat failures, and worker trends.",
    tags: ["analytics", "trends", "drill down", "performance"],
    body: `## What feeds Analytics

On every form template, there is a per-form toggle: **Use Form Item Data In Analytics**. When that toggle is on, every submission feeds the analytics layer. Specific field values become reportable dimensions.

## Where to look

**Analytics** in the side nav opens the dashboards. Filter by form, by location, by date range. Click any chart row to drill down to the underlying submissions.

## Worker performance

The Workers tab in Analytics shows submission counts, on-time vs late completions, and failure rates by worker. Useful for both coaching and award-of-merit conversations.

## Exports

Every chart has an export button. CSV for spreadsheets, PDF for handout packets.`,
  },
  {
    slug: "offline-troubleshooting",
    title: "Submissions, photos, or signatures aren't syncing",
    category: "Offline & Sync",
    summary: "The app is offline-first. Here's how to check the queue and force a flush.",
    tags: ["offline", "sync", "queue", "not syncing", "stuck", "background sync"],
    body: `## How sync works

Every submission, photo, and signature is queued in IndexedDB on the worker's device the moment it's saved. When the device reconnects to the internet, the service worker flushes the queue automatically, silently, in the background.

## Check the queue

In the worker app, look at the **Offline Status** chip at the top. It shows pending submissions and their state. If you see "Stuck," tap the chip; the system surfaces the specific error and offers a retry.

## Common causes

- **Trial expired.** If a tenant's 30-day trial has ended, the database refuses writes with code 42501. Sub­scribe and the queue flushes on the next attempt.
- **Bad attachment.** A corrupt photo file can stop one submission. The Offline Status panel names the offending file; remove or replace it and the rest will sync.
- **Auth expired.** If the worker has been signed out for too long, they'll be asked to re-login when the queue tries to flush. After re-login the queue resumes.

## Force a flush

The PWA polls for sync every 30 minutes when online. To force one immediately, tap the Offline Status chip → **Flush queue** in the worker app.`,
  },
  {
    slug: "install-on-phone",
    title: "Install Core Pathways as an app on your phone",
    category: "Offline & Sync",
    summary: "Add to home screen turns the web app into a real installed app on iPhone, Android, and desktop.",
    tags: ["install", "pwa", "phone", "home screen", "iphone", "android"],
    body: `## Why install

Installed, the app launches in standalone mode (no browser chrome), opens like any other app, and stores data offline for as long as the device has room. It will receive automatic version updates every 30 minutes whenever the device is online, no App Store wait, no IT push.

## Android and desktop

In Chrome, Edge, or any Chromium browser, an **Install** banner appears at the bottom of the screen on the admin and worker surfaces. Tap **Install**. Or use the install icon in the address bar.

## iPhone and iPad

iOS Safari does not offer a one-tap install. Tap the **Share** button in Safari, then choose **Add to Home Screen**. Confirm. The Core Pathways icon now lives on the home screen and opens in standalone mode.

## Confirming the install

When the app is installed, the install banner disappears. The first launch may take a few seconds longer as the app caches static assets for offline use.`,
  },
  {
    slug: "trial-and-subscription",
    title: "How the 30-day trial works",
    category: "Account & Billing",
    summary: "Full app for 30 days, no card, no sales call. After day 30 the app stays readable while paused for new edits.",
    tags: ["trial", "subscription", "billing", "expired", "paywall"],
    body: `## What the trial includes

Every signup gets a full, unrestricted tenant for 30 days. Add workers, build forms, run inspections, capture photos, sign, the entire surface is available.

## What happens at the end

If the trial ends without a subscription, your tenant flips to **read-only**:
- Every worker, form, submission, photo, and document is still there.
- You can sign in and view everything.
- New submissions, new edits, and new uploads are paused until you subscribe.

The point of read-only is simple: by day 30 you've built up real work in the app, and you decide whether to keep it. The data is never deleted.

## Subscribing

Click **Subscribe** on the paywall page or the trial banner. The button currently opens an email to our team, we will get you onto a paid plan the same business day. Stripe self-serve checkout is coming.

## After subscribing

The moment your tenant flips to Active, every queued offline submission flushes and every paused action resumes. Nothing is lost in the gap.`,
  },
];

export function getHelpTopic(slug: string): HelpTopic | undefined {
  return helpTopics.find((topic) => topic.slug === slug);
}

export function searchHelpTopics(query: string): HelpTopic[] {
  const term = query.trim().toLowerCase();

  if (!term) {
    return helpTopics;
  }

  return helpTopics.filter((topic) => {
    const haystack = [topic.title, topic.summary, topic.body, topic.tags.join(" "), topic.category]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}
