import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  BarChart3,
  BellRing,
  Boxes,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  CloudOff,
  Download,
  Code2,
  FileSliders,
  FileText,
  GitBranch,
  Globe2,
  Handshake,
  HardHat,
  IdCard,
  KeyRound,
  Layers,
  LineChart,
  ListChecks,
  Lock,
  MapPin,
  PencilRuler,
  PenLine,
  Phone,
  Receipt,
  RefreshCcw,
  ScanText,
  Server,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Truck,
  Unlock,
  UserRound,
  UsersRound,
  Wrench,
  Zap,
} from "lucide-react";
import { demoLogin } from "@/app/login/actions";
import { isDemoLoginEnabled } from "@/lib/demo";

const PHONE_DISPLAY = "780-832-5158";
const PHONE_HREF = "tel:+17808325158";
const ADVISOR = {
  name: "Ken Rentergem",
  title: "Senior Safety Consultant",
  credential: "Certified AMTA COR Auditor",
  phoneDisplay: "403-866-9517",
  phoneHref: "tel:+14038669517",
};
/**
 * Marketing and content live on their own site, in a separate repository, so the
 * outbound links here point there rather than at pages inside the application.
 *
 * Safe to deploy before the domain move: today this resolves to the apex, which is
 * still this landing page, so nothing changes for a visitor. After the apex moves
 * to the marketing site, these links become correct without another deploy.
 */
const MARKETING_URL = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://corpathway360.com";

const REPO_URL = "https://github.com/Yeti567/cor-pathways";
const REPO_ZIP_URL = "https://github.com/Yeti567/cor-pathways/archive/refs/heads/main.zip";
const REPO_CLONE = "git clone https://github.com/Yeti567/cor-pathways.git";
const BOOK_HREF =
  "mailto:blake.safetyconsultant@gmail.com?subject=Cor%20Pathway%20360%20-%20book%20a%20call&body=Trade%3A%0ACrew%20size%3A%0APortals%20my%20clients%20use%3A%0A";

type Feature = { title: string; body: string; icon: typeof ClipboardList };
type FeatureGroup = { eyebrow: string; title: string; tagline: string; features: Feature[] };

const ownership: { icon: typeof KeyRound; title: string; body: string }[] = [
  {
    icon: Server,
    title: "Your Supabase and Vercel accounts",
    body: "The hosting and the database are opened in your name, on your billing. I get invited in as a member, the same as any staff member, and you can revoke that on any day you like.",
  },
  {
    icon: KeyRound,
    title: "Your API keys, your usage",
    body: "Every key belongs to you and every bill comes to you directly. Nothing is resold to you with a margin on top, and nothing routes through an account you cannot see.",
  },
  {
    icon: Lock,
    title: "Your data stays yours",
    body: "Your workers, your forms, your evidence, and your audit history sit in a database you own. There is no export request to file and nobody to ask for permission.",
  },
  {
    icon: Unlock,
    title: "No lock in, ever",
    body: "The app is open source and you keep your own copy of it. If you stop paying me tomorrow, the app keeps running and your crew never notices.",
  },
];

const buildIncludes: string[] = [
  "Your own app instance stood up: hosting, domain, secure login, keys wired in",
  "Full safety program built in: policies, procedures, forms, hazard assessments",
  "Your existing documents imported and your crew loaded",
  "Hands on training for your team on the app",
  "Delivered audit ready, tested, and working",
  "Tailored to your certifying partner and your trade",
];

const managedIncludes: string[] = [
  "Program and forms kept current as ISN, Avetta, ComplyWorks, and OHS rules change",
  "App updates and security patches applied to your instance",
  "Automatic backups",
  "Support line: it breaks, I fix it",
  "Up to 1 hour of small changes each month included",
];

const managedPlusIncludes: string[] = [
  "Everything in Managed",
  "Larger change allowance: up to 3 hours each month",
  "Priority support",
  "Quarterly program review before audit season",
  "Multi location and higher worker counts supported",
];

const groups: FeatureGroup[] = [
  {
    eyebrow: "Forms",
    title: "Replace every clipboard with a form that fills itself in",
    tagline: "A section-based builder, 20+ field types, and a PDF importer that turns the form you already use into a live digital one.",
    features: [
      { title: "Drag-and-drop form builder", body: "Sections, repeatable sections, required fields, conditional logic. Mobile first, then tablet, then desktop.", icon: ClipboardList },
      { title: "20+ field types", body: "Pass/Fail/NA, dropdowns linked to managed lists, dates, times, numbers, signatures, photos, GPS, PDFs, worker pickers, equipment pickers, and more.", icon: Layers },
      { title: "PDF-to-form importer", body: "Upload a blank PDF; Google Document AI plus Gemini auto-detect the fields and the form is built for you to refine.", icon: ScanText },
      { title: "Managed lists", body: "Reusable, company-wide dropdown lists (Vehicle Types, Hazards, Risk Severity, Days of Week, anything you want). Edit once, every form updates.", icon: ListChecks },
      { title: "Standard vs Private forms", body: "Choose who can see signed copies. Private forms are confined to the device or admin panel.", icon: Lock },
      { title: "Use as label, flag, evidence photo", body: "Per-field tweaks: mark a field as the form's label, allow flagging for follow-up, capture an evidence photo right on the question.", icon: PenLine },
    ],
  },
  {
    eyebrow: "Work in the field",
    title: "A worker app that works in the dirt",
    tagline: "Built offline-first. Submissions, photos, and signatures keep flowing through dead zones and shaky LTE.",
    features: [
      { title: "Fully offline", body: "Open the app with no signal, fill the form, snap photos, sign it. Everything queues locally in IndexedDB.", icon: CloudOff },
      { title: "Silent background sync", body: "When connectivity returns, the queue flushes automatically. No 'press to sync,' no lost submissions.", icon: RefreshCcw },
      { title: "Camera + signature capture", body: "Take photos and capture signatures with no network round-trip. Both are stored locally and uploaded on reconnect.", icon: Camera },
      { title: "Time cards", body: "Clock in and clock out by location, with notes. Tracks hours by worker and project.", icon: Activity },
      { title: "Assigned forms feed", body: "Workers see exactly what's assigned to them, sorted by due date.", icon: ClipboardList },
      { title: "Worker ticket upload", body: "Photograph a First Aid or H2S card. OCR pulls the expiry date and files it against the worker.", icon: IdCard },
    ],
  },
  {
    eyebrow: "COR",
    title: "COR audit readiness, mapped to your certifying partner",
    tagline: "Pick your certifying partner and the whole module organizes your evidence the way that partner's auditor scores it.",
    features: [
      { title: "Choose your certifying partner", body: "AMTA, ACSA, AASP, or IHSA COR 2020. The module renumbers and renames to that partner's audit, so what you see on screen matches the instrument the auditor uses.", icon: Handshake },
      { title: "Evidence mapped to the elements", body: "Documents, forms, and live app data are tagged to the right audit element, with a readiness percentage and the exact gaps left to close.", icon: ListChecks },
      { title: "Question-by-question crosswalk", body: "Every audit question paired with the document that answers it, the verification method, and where that evidence lives.", icon: ClipboardList },
      { title: "Auditor package in one click", body: "Export a print-ready package that walks the auditor through each element and its supporting evidence.", icon: FileText },
      { title: "Policy expiry tracking", body: "Upload a policy, tag its COR section, set its expiry date. The app reminds the right person before it lapses.", icon: FileSliders },
      { title: "Built on a real program", body: "Hazard assessments, inspections, incidents, corrective actions, orientation, and training records that feed the audit as you work.", icon: ShieldCheck },
    ],
  },
  {
    eyebrow: "Field service & projects",
    title: "Run the jobs, not just the safety binder",
    tagline: "Service work orders, customer equipment, job checklists, and time and materials, for trades and contractors who do the work and own the safety program.",
    features: [
      { title: "Service work orders", body: "Dispatch, track, and sign off jobs. Add the materials and equipment used, capture time and travel, attach photos, all from the field.", icon: ClipboardList },
      { title: "Customer equipment history", body: "Every unit you service gets a file: make, model, location, and the full history of work performed on it.", icon: Boxes },
      { title: "Job checklists", body: "Reusable, trade-specific checklists workers complete on site, tied to the work order and stored as evidence.", icon: ListChecks },
      { title: "Contractor and subtrade management", body: "Pre-qualify, orient, and monitor the contractors and subtrades on your sites, with the records the COR audit asks for.", icon: Handshake },
      { title: "Time, travel, and materials", body: "Workers log hours, travel, and materials in the field. Pricing, costing, and invoicing stay on the admin side.", icon: Activity },
      { title: "Equipment follow-ups", body: "A failed check or a deficiency on a unit becomes a tracked follow-up routed to the right person.", icon: Wrench },
    ],
  },
  {
    eyebrow: "Automation",
    title: "Workflows that route the work, not your time",
    tagline: "Forms trigger forms. Failures spawn corrective actions. Schedules fire reminders. You set it once.",
    features: [
      { title: "Form chains with branching", body: "Completing a First Aid form can route to a WSIB form, an Incident Report, and a Ministry of Labour form based on the answers given.", icon: GitBranch },
      { title: "Flag-and-assign loop", body: "Flag a failed inspection item, attach a photo, assign it to a worker. The corrective action lives on with its own lifecycle: open → assigned → in progress → completed → signed off.", icon: Wrench },
      { title: "Schedules with reminders", body: "Monthly site inspections, weekly toolbox talks, biweekly time cards. The system reminds the right person and flags overdue work.", icon: Zap },
      { title: "Auto-Share", body: "Completed forms email themselves to the right recipients automatically, per location or all locations.", icon: Share2 },
    ],
  },
  {
    eyebrow: "Visibility",
    title: "The analytics layer, included, because there is nothing to upsell you",
    tagline: "A live monitor of submitted forms, full reports, and an analytics layer that surfaces trends across every form, location, and worker.",
    features: [
      { title: "Live Monitor", body: "Submitted forms stream in, grouped by day, with signature counts and date-range filters. The dashboard your owner refreshes all day.", icon: Activity },
      { title: "Reports", body: "Filter, group, and export submission data. Generate the audit packet without copying anything by hand.", icon: BarChart3 },
      { title: "Analytics", body: "Field-level analytics across every form flagged for analytics. Watch trends, hot spots, repeat failures, and worker performance over time.", icon: LineChart },
      { title: "Incidents", body: "A focused view of incident submissions, who reported them, who is following up, and what is still open.", icon: AlertTriangle },
      { title: "Corrective Actions register", body: "Every flag and follow-up tracked in one place, with status, assignee, attached photos, and sign-off history.", icon: CheckCircle2 },
    ],
  },
  {
    eyebrow: "Equipment + Resources",
    title: "Run the trucks, tools, and documents from the same place",
    tagline: "Equipment files with meter readings, maintenance, and scheduled service. A resource library with document control numbers and revision history.",
    features: [
      { title: "Equipment files", body: "Per-unit pages with meter history, maintenance log, scheduled services, attached documents, and every form ever submitted against the unit.", icon: Truck },
      { title: "Scheduled service due", body: "Service intervals by date OR by meter. Overdue services surface automatically.", icon: Wrench },
      { title: "Resource library", body: "Sectioned, reorderable document repository, manuals, signed policies, SDS, toolbox talks. Viewable in the worker app.", icon: FileText },
      { title: "Document Control Numbers", body: "Optional. Every document and form gets a DCN with a two-digit revision and an optional year segment. Full revision register included.", icon: FileSliders },
    ],
  },
  {
    eyebrow: "Inventory",
    title: "Know how many you have, and exactly where",
    tagline: "One ledger for anything you count: rental units on customer sites, tools out with a crew, parts on a truck, PPE in the yard. Every number traces back to a move, so a balance is never simply edited.",
    features: [
      { title: "A ledger you never edit", body: "Stock only moves between places, and every balance is added up from those moves. Fix a mistake by recording the move that corrects it, so the history always explains itself.", icon: ArrowLeftRight },
      { title: "Every place stock can sit", body: "Yards, customer sites, trucks, and crews are all just places, plus built-in transit and loss. A delivery, a tool check-out, truck stock, and a write-off are the same move with different ends.", icon: MapPin },
      { title: "On Hand at a glance", body: "A grid of every item against every place that holds it, filtered by category or kind, with the full list of moves behind every single number.", icon: Boxes },
      { title: "Truck transfers in two legs", body: "A load leaves, sits in transit, and arrives. Deliver less than was loaded and the residual stays visible in transit instead of quietly vanishing.", icon: Truck },
      { title: "Field capture, offline", body: "A driver records a pickup or a drop from their phone in a dead zone. It saves on the device and syncs when signal returns, and it posts exactly once no matter how many times the sync runs.", icon: CloudOff },
      { title: "Counts that reconcile themselves", body: "Count the shelf, enter the real number, and the system posts the difference to the loss place. Nobody edits a balance, and shrinkage stays reviewable in a variance report.", icon: ClipboardCheck },
      { title: "Low-stock alerts", body: "Set a reorder point on the things you must not run out of. The on-hand total is watched live against it, and your managers are told before you run out.", icon: BellRing },
      { title: "Rental billing from the ledger", body: "What each customer site owes for a period: how many units sat there, for how long, at the item's rate. Partial pickups fall out of the math on their own. Admin only.", icon: Receipt },
    ],
  },
  {
    eyebrow: "Subcontractors",
    title: "The carriers you hire, on file and in date",
    tagline: "Alberta does not require you to hold paperwork on a carrier you hire; your insurer, your customers, and your lawyer do. This is that file, kept current by the carriers themselves.",
    features: [
      { title: "A portal that costs them nothing", body: "The big prequalification networks charge a subcontractor 800 to 1,500 a year just to hand you a certificate, which is why small carriers refuse to sign up. Yours pay nothing, ever.", icon: Handshake },
      { title: "A link, not a password", body: "You send a sign-in link and they are in. Nothing to create, nothing to forget, nothing to reset six months later when their office manager leaves.", icon: KeyRound },
      { title: "Your limits, actually enforced", body: "Set the coverage you require once. A certificate that arrives underneath it is flagged the moment it is filed, instead of during a claim. A blank limit fails too, because it cannot be shown to meet the bar.", icon: ShieldCheck },
      { title: "Expiry dates that chase themselves", body: "Insurance by the date printed on it, carrier profiles and WCB rate statements on an interval, because those carry no expiry. One warning as it enters your window, a sharper one in the last week, and a notice when it lapses.", icon: BellRing },
      { title: "Nothing counts until you say so", body: "A carrier can send, and only you can accept. Everything arrives for review, and what you send back carries your reason so they know what to fix.", icon: ClipboardCheck },
      { title: "The file that answers afterwards", body: "One page with every document, every limit, and the history of what you held and when you checked it. Print it for an insurer or an auditor. Holding the current certificate is easy; proving what you held two years ago is the part that counts.", icon: FileText },
    ],
  },
  {
    eyebrow: "People + Permissions",
    title: "Built for industrial orgs, not five-person startups",
    tagline: "Workers, supervisors, managers, admins, super admins, and visitors, each scoped to the projects they should see.",
    features: [
      { title: "Workers + Locations", body: "A master worker grid, location/project pages with visibility rules, and reach assignments that scope users to the projects they touch.", icon: UsersRound },
      { title: "Certifications + Tickets", body: "Per-worker certification grid with expiry tracking, image attachments, and a company-level certification types library.", icon: BadgeCheck },
      { title: "Custom Permission Profiles", body: "Build profiles that match your org chart. Power tiers set the ceiling; profiles tune what users can actually do.", icon: FileSliders },
      { title: "Visitor sign-in", body: "Replace the paper sign-in sheet. Ministry inspectors, auditors, suppliers, captured with reason and time, available as a live roster.", icon: UserRound },
      { title: "Full admin audit trail", body: "Every administrative action is logged and visible to your Super Admin, including mine. You can see everything I do in your instance.", icon: ShieldCheck },
    ],
  },
];

const differentiators = [
  {
    icon: CloudOff,
    title: "Built offline-first, not bolted on later",
    body: "Most field-ops apps need a connection to load the form. Cor Pathways stores everything in IndexedDB, signs and submits offline, and quietly catches up when the truck rolls back into town. Workers stop saying 'I'll do it when I get back to the office.'",
  },
  {
    icon: HardHat,
    title: "Built by someone who has done the audits",
    body: "This is not a general purpose form builder with a safety skin on it. The COR module is shaped the way an auditor actually scores the instrument, because the person who built it has sat on both sides of that table.",
  },
  {
    icon: Smartphone,
    title: "An app you install, not just a website",
    body: "Add Cor Pathways to a phone's home screen and it runs in standalone mode like a native app. Updates reach every device within 30 minutes, no App Store review cycle, no waiting for IT to push anything.",
  },
  {
    icon: Code2,
    title: "Open source, so the receipts are public",
    body: "The whole app is on GitHub under the AGPL. Your IT person can read every line before it touches your data, and you are never negotiating with a vendor who knows you cannot leave.",
  },
];

const platformBullets = [
  { icon: Smartphone, label: "Installable as a PWA on iPhone, Android, and desktop." },
  { icon: RefreshCcw, label: "Automatic version refresh across every device every 30 minutes." },
  { icon: Lock, label: "Data isolation enforced at the database, not in app code." },
  { icon: Globe2, label: "Email login with optional SSO." },
  { icon: PencilRuler, label: "Custom print headers for completed forms with logo + company info." },
  { icon: Sparkles, label: "PDF-to-form import using Google Document AI + Gemini." },
  { icon: MapPin, label: "Reach-based access, workers see only their assigned projects." },
  { icon: Boxes, label: "Multi-location, multi-project, multi-form workflows." },
];

const industries: { icon: typeof Wrench; title: string; body: string }[] = [
  {
    icon: Wrench,
    title: "HVAC and mechanical trades",
    body: "Dispatch service work orders, track customer equipment and its history, run job checklists, and capture time, travel, and materials from the field. Your COR safety program rides along on the same app.",
  },
  {
    icon: HardHat,
    title: "Construction and contractors",
    body: "Manage projects, daily field work, contractor and subtrade pre-qualification, site inspections, and field-level hazard assessments. Built for general contractors and trades that outgrew paper but do not want enterprise bloat.",
  },
  {
    icon: Truck,
    title: "Trucking and carriers",
    body: "Full NSC compliance: Hours of Service, driver qualification files, daily trip inspections, vehicle maintenance and CVIP, plus live ELD data flowing in from Motive and more.",
  },
];

function GithubMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 16 16">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function Check() {
  return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />;
}

export default function LandingPage() {
  const demoEnabled = isDemoLoginEnabled();
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <a className="flex items-center gap-3 text-sm font-bold tracking-tight text-[var(--ink)]" href={MARKETING_URL}>
            <Image
              alt="Cor Pathways"
              className="h-9 w-auto"
              height={41}
              priority
              src="/images/cor%20pathways%20logo%20bg%20removed.png"
              width={128}
            />
            <span className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)] sm:inline">
              360
            </span>
          </a>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              className="hidden h-9 items-center rounded-md px-3 font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] sm:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              href="#offer"
            >
              What it costs
            </Link>
            <Link
              className="hidden h-9 items-center rounded-md px-3 font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] sm:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              href="#features"
            >
              Features
            </Link>
            <Link
              className="hidden h-9 items-center rounded-md px-3 font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] sm:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              href="#self-host"
            >
              Self-host
            </Link>
            <a
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-white px-3 font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              href={REPO_URL}
              rel="noreferrer noopener"
              target="_blank"
            >
              <GithubMark className="h-4 w-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
            <Link
              className="inline-flex h-9 items-center rounded-md border border-[var(--border)] bg-white px-3 font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              href="/login"
            >
              Log in
            </Link>
            <a
              className="inline-flex h-9 items-center rounded-md bg-[var(--primary)] px-3 font-semibold text-white transition hover:bg-[var(--primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              href={BOOK_HREF}
            >
              Book a call
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--border)] bg-gradient-to-b from-emerald-50 via-[var(--surface)] to-[var(--background)] px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/30 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">
            <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
            Open source. Done for you deployment.
          </p>
          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-[var(--ink)] sm:text-5xl">
            Your safety program,<br className="hidden sm:block" /> live in your own app.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-[var(--ink-muted)] sm:text-lg">
            Built and run by someone who has actually done the audits. You own the accounts, the keys, and the data. I
            stand it up, build your program inside it, and keep you audit ready every month.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <a
              className="inline-flex h-11 items-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              href={BOOK_HREF}
            >
              Book a free call
              <Zap className="h-4 w-4" aria-hidden="true" />
            </a>
            {demoEnabled ? (
              <form action={demoLogin} className="contents">
                <button
                  className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--primary)] bg-white px-5 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                  type="submit"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Try the live demo
                </button>
              </form>
            ) : null}
            <Link
              className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              href="#offer"
            >
              See what it costs
            </Link>
          </div>
          <p className="mt-6 text-sm font-semibold text-[var(--ink)]">
            You own it. I run it.
          </p>
        </div>
      </section>

      {/* Ownership */}
      <section className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-16 sm:px-6" id="ownership">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">You own it. I run it.</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)]">
              Most safety software rents you access to your own records.
            </h2>
            <p className="mt-4 text-base text-[var(--ink-muted)]">
              This one does not. The app is open source and free. You open your own Vercel and Supabase accounts, the
              app runs on your infrastructure under your keys, and I get invited in to build it and look after it. The
              day you decide you no longer need me is the day nothing breaks.
            </p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-2 md:gap-x-12 lg:grid-cols-4 lg:gap-x-8">
            {ownership.map((item) => {
              const Icon = item.icon;
              return (
                <div className="border-t-2 border-[var(--primary)] pt-5" key={item.title}>
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-[var(--ink)]">{item.title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* The offer */}
      <section className="border-b border-[var(--border)] bg-[var(--background)] px-4 py-16 sm:px-6" id="offer">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">What it costs</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)]">
              One build to get you audit ready. One monthly to keep you there.
            </h2>
            <p className="mt-4 text-base text-[var(--ink-muted)]">
              The software is free. What you are paying for is the program built inside it and the person who keeps it
              current. No per-user fees, no seat counts. Every company starts from a different place, some with a full
              program, some with a binder, some with nothing, so we review where you are and give you a firm price
              before any work begins.
            </p>
          </div>

          {/* 01 The build */}
          <div className="mt-12">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-xs font-bold tabular-nums text-[var(--primary)]">01</span>
              <h3 className="text-xl font-bold tracking-tight text-[var(--ink)]">The build</h3>
              <p className="text-sm text-[var(--ink-muted)]">One time. Required. This is the foundation.</p>
            </div>

            <article className="mt-5 overflow-hidden rounded-xl border-2 border-[var(--primary)] bg-white shadow-md">
              <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:gap-12">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Audit ready
                  </span>
                  <p className="mt-4 max-w-xl text-base text-[var(--ink)]">
                    A working, audit ready instance with your safety program already inside it. Not a blank shell you
                    have to figure out.
                  </p>
                  <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
                    {buildIncludes.map((item) => (
                      <li className="flex items-start gap-2 text-sm text-[var(--ink)]" key={item}>
                        <Check />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col justify-center gap-3 border-t border-[var(--border)] pt-6 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">One time build</p>
                    <p className="mt-1 text-3xl font-bold tracking-tight text-[var(--ink)]">Priced to your setup</p>
                    <p className="mt-2 text-sm text-[var(--ink-muted)]">A firm number after a short call, before any work starts.</p>
                  </div>
                  <a
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                    href={BOOK_HREF}
                  >
                    Get a firm number
                  </a>
                </div>
              </div>
              <p className="border-t border-[var(--border)] bg-[var(--surface-muted)] px-6 py-4 text-sm text-[var(--ink-muted)] sm:px-8">
                Every company starts from a different place. We look at your crew size and how much program you already
                have, then give you a solid, firm price before any work starts. You approve the number before we
                continue.
              </p>
            </article>
          </div>

          {/* 02 Keep it running */}
          <div className="mt-14">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-xs font-bold tabular-nums text-[var(--primary)]">02</span>
              <h3 className="text-xl font-bold tracking-tight text-[var(--ink)]">Keep it running</h3>
              <p className="text-sm text-[var(--ink-muted)]">Pick one. Starts after the build. Cancel anytime.</p>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <article className="relative flex flex-col rounded-xl border-2 border-[var(--primary)] bg-white p-6 shadow-md">
                <span className="absolute -top-3 left-6 inline-flex items-center rounded-full bg-[var(--primary)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                  Where most start
                </span>
                <h4 className="text-xl font-bold text-[var(--ink)]">Managed</h4>
                <p className="mt-3 text-sm font-semibold text-[var(--ink)]">Flat monthly, set to your size</p>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">
                  For a single company that wants to stay current without thinking about it.
                </p>
                <ul className="mt-6 grid flex-1 gap-2.5">
                  {managedIncludes.map((item) => (
                    <li className="flex items-start gap-2 text-sm text-[var(--ink)]" key={item}>
                      <Check />
                      {item}
                    </li>
                  ))}
                </ul>
                <a
                  className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                  href={BOOK_HREF}
                >
                  Book a call
                </a>
              </article>

              <article className="relative flex flex-col rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm transition-colors hover:border-[var(--primary)]/60">
                <span className="absolute -top-3 left-6 inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  Multi location
                </span>
                <h4 className="text-xl font-bold text-[var(--ink)]">Managed Plus</h4>
                <p className="mt-3 text-sm font-semibold text-[var(--ink)]">Flat monthly, set to your size</p>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">
                  For larger crews, multiple locations, or heavier month to month change.
                </p>
                <ul className="mt-6 grid flex-1 gap-2.5">
                  {managedPlusIncludes.map((item) => (
                    <li className="flex items-start gap-2 text-sm text-[var(--ink)]" key={item}>
                      <Check />
                      {item}
                    </li>
                  ))}
                </ul>
                <a
                  className="mt-6 inline-flex h-11 items-center justify-center rounded-md border border-[var(--border)] bg-white px-5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                  href={BOOK_HREF}
                >
                  Book a call
                </a>
              </article>
            </div>

            <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
              <h4 className="text-sm font-semibold text-[var(--ink)]">What the monthly does not cover</h4>
              <p className="mt-2 max-w-4xl text-sm leading-relaxed text-[var(--ink-muted)]">
                The monthly keeps you current and running. It does not include custom builds. A new module, a custom
                feature, an outside integration, or building a second company&apos;s program is quoted separately,
                either hourly or as a flat project price. You always see the number before I start. No surprise
                invoices.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Self-host */}
      <section className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-16 sm:px-6" id="self-host">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">Or do it yourself</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)]">
              Free means free. Here is the source code.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[var(--ink-muted)]">
              If you have someone technical and the time, take the repo, point it at your own Supabase project, deploy
              it to your own Vercel account, and run the whole thing without ever talking to me. That is not a trial and
              it does not expire. It is the same app I install for paying clients.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">
              What you will not get for free is the part that takes the expertise: a safety program written for your
              trade, your documents imported, your evidence mapped to the way your certifying partner actually scores
              the audit, and someone watching it every month. That is what the build and the monthly are for.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                className="inline-flex h-11 items-center gap-2 rounded-md bg-[var(--ink)] px-5 text-sm font-semibold text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                href={REPO_URL}
                rel="noreferrer noopener"
                target="_blank"
              >
                <GithubMark className="h-4 w-4" />
                Get the code on GitHub
              </a>
              <a
                className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                href={REPO_ZIP_URL}
              >
                <Download className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                Download ZIP
              </a>
            </div>
            <div className="mt-4 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--ink)] px-4 py-3">
              <code className="whitespace-nowrap font-mono text-xs text-emerald-200">
                <span className="select-none text-white/40">$ </span>
                {REPO_CLONE}
              </code>
            </div>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              AGPL-3.0. Clone it, read it, run it. Setup is in the README and takes about twenty minutes.
            </p>
          </div>
          <ul className="grid gap-3">
            <li className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-white p-4 text-sm text-[var(--ink)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <Code2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="font-semibold">Licensed AGPL-3.0.</span> Free to run for your own company, forever.
                Read every line before it touches your data.
              </span>
            </li>
            <li className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-white p-4 text-sm text-[var(--ink)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <Server className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="font-semibold">Vercel and Supabase.</span> Both have a free tier that a small crew fits
                inside. You pay them directly when you outgrow it.
              </span>
            </li>
            <li className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-white p-4 text-sm text-[var(--ink)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="font-semibold">Bring your own keys.</span> Supabase is all you need to start. PDF form
                import, email, and ELD each switch on when you add that key.
              </span>
            </li>
            <li className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-white p-4 text-sm text-[var(--ink)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <Handshake className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                <span className="font-semibold">Start free, call me later.</span> Self-host it now and hire me to build
                the program on top of it whenever you are ready. Nothing gets migrated.
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* Who it is for */}
      <section className="border-b border-[var(--border)] bg-[var(--background)] px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">Who it is for</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)]">
              One app, whether you fix it, build it, or haul it.
            </h2>
            <p className="mt-4 text-base text-[var(--ink-muted)]">
              Trades, contractors, and carriers run different work, but they all answer to a safety program and, more
              and more, a COR audit. Cor Pathways fits each one, and the COR module adapts to the certifying partner you
              actually use.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {industries.map((item) => {
              const Icon = item.icon;
              return (
                <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm" key={item.title}>
                  <div className="flex h-11 w-11 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-[var(--ink)]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{item.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-12 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {differentiators.map((item) => {
            const Icon = item.icon;
            return (
              <article className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm" key={item.title}>
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-base font-semibold text-[var(--ink)]">{item.title}</h2>
                <p className="mt-2 text-sm text-[var(--ink-muted)]">{item.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* Features */}
      <section className="px-4 py-16 sm:px-6" id="features">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">Every capability</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)]">
            One app, all the modules, nothing behind a tier.
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-[var(--ink-muted)]">
            There is no premium edition, because there is nothing to upsell you. Every install gets the entire surface,
            whether I built it for you or you deployed it yourself on a Sunday.
          </p>

          <div className="mt-12 space-y-12">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">{group.eyebrow}</p>
                <h3 className="mt-1 text-2xl font-bold tracking-tight text-[var(--ink)]">{group.title}</h3>
                <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">{group.tagline}</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.features.map((feature) => {
                    const Icon = feature.icon;
                    return (
                      <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm" key={feature.title}>
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <h4 className="mt-3 text-sm font-semibold text-[var(--ink)]">{feature.title}</h4>
                        <p className="mt-1 text-sm text-[var(--ink-muted)]">{feature.body}</p>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Platform */}
      <section className="border-y border-[var(--border)] bg-[var(--surface)] px-4 py-16 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">Platform</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-[var(--ink)]">
              Modern infrastructure under the hood. You see one calm app.
            </h2>
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              The stack is picked so your IT team does not have to. Supabase Postgres with row-level security. A PWA
              that installs on every device. A service worker that ships new versions to every phone within 30 minutes.
              Data isolation enforced at the database level, not just the app.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {platformBullets.map((bullet) => {
              const Icon = bullet.icon;
              return (
                <li className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-white p-3 text-sm text-[var(--ink)]" key={bullet.label}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {bullet.label}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-3xl rounded-xl border border-[var(--primary)]/40 bg-gradient-to-br from-emerald-50 to-white p-8 text-center shadow-sm">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--ink)]">Book a free call.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--ink-muted)]">
            Tell me your trade, your crew size, and which portals your clients use. You walk away with a firm setup
            number and the right monthly tier. No obligation.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a
              className="inline-flex h-11 items-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              href={BOOK_HREF}
            >
              Book the call
              <Zap className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              href={PHONE_HREF}
            >
              <Phone className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
              Call {PHONE_DISPLAY}
            </a>
          </div>

          <div className="mt-8 border-t border-[var(--primary)]/20 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Or speak to our safety advisor
            </p>
            <div className="mt-3 flex flex-col items-center justify-center gap-x-6 gap-y-2 sm:flex-row">
              <div className="text-center sm:text-left">
                <p className="text-base font-semibold text-[var(--ink)]">{ADVISOR.name}</p>
                <p className="text-sm text-[var(--ink-muted)]">{ADVISOR.title}</p>
                <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[var(--primary)] ring-1 ring-[var(--primary)]/25">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {ADVISOR.credential}
                </p>
              </div>
              <a
                className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
                href={ADVISOR.phoneHref}
              >
                <Phone className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                {ADVISOR.phoneDisplay}
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm text-[var(--ink-muted)] md:flex-row md:items-center md:justify-between">
          <div>
            <p>© Cor Pathway 360. You own your code, your data, and your accounts. No lock in.</p>
            <p className="mt-1 text-xs">
              Cor Pathways is owned and operated by <span className="font-semibold text-[var(--ink)]">Yeti Digital Services Ltd.</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            {/* Marketing and content live on the separate marketing site. */}
            <a className="hover:text-[var(--ink)]" href={MARKETING_URL}>Site</a>
            <a className="hover:text-[var(--ink)]" href={`${MARKETING_URL}/pricing`}>What it costs</a>
            <a className="hover:text-[var(--ink)]" href={`${MARKETING_URL}/cor`}>COR guides</a>
            <a className="hover:text-[var(--ink)]" href={REPO_URL} rel="noreferrer noopener" target="_blank">GitHub</a>
            <Link className="hover:text-[var(--ink)]" href="/help">Help</Link>
            <Link className="hover:text-[var(--ink)]" href="/login">Log in</Link>
            <a className="hover:text-[var(--ink)]" href={PHONE_HREF}>{PHONE_DISPLAY}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
