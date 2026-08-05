import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { HelpShell } from "../HelpShell";
import { getHelpTopic, helpTopics } from "../_data/topics";

export const dynamic = "force-static";

export function generateStaticParams() {
  return helpTopics.map((topic) => ({ slug: topic.slug }));
}

type HelpTopicPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: HelpTopicPageProps) {
  const { slug } = await params;
  const topic = getHelpTopic(slug);

  if (!topic) {
    return { title: "Help, Core Pathways Operations" };
  }

  return {
    title: `${topic.title}, Help`,
    description: topic.summary,
  };
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; html: string }
  | { kind: "list"; items: string[] };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyInlineMarkdown(value: string) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, '<code class="rounded bg-[var(--surface-muted)] px-1 py-0.5 text-[0.85em] text-[var(--ink)]">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-[var(--ink)]">$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.split("\n");
  let buffer: string[] = [];
  let listBuffer: string[] = [];

  function flushParagraph() {
    if (buffer.length === 0) {
      return;
    }
    blocks.push({ kind: "paragraph", html: applyInlineMarkdown(buffer.join(" ").trim()) });
    buffer = [];
  }

  function flushList() {
    if (listBuffer.length === 0) {
      return;
    }
    blocks.push({ kind: "list", items: listBuffer.map((item) => applyInlineMarkdown(item)) });
    listBuffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: line.replace(/^##\s+/, "") });
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      listBuffer.push(line.replace(/^-\s+/, ""));
      continue;
    }

    buffer.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

export default async function HelpTopicPage({ params }: HelpTopicPageProps) {
  const { slug } = await params;
  const topic = getHelpTopic(slug);

  if (!topic) {
    notFound();
  }

  const blocks = parseBody(topic.body);
  const related = helpTopics
    .filter((other) => other.slug !== topic.slug && other.category === topic.category)
    .slice(0, 4);

  return (
    <HelpShell>
      <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <Link
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] hover:underline"
          href="/help"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          All help topics
        </Link>

        <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">{topic.category}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">{topic.title}</h1>
        <p className="mt-3 text-base text-[var(--ink-muted)]">{topic.summary}</p>

        <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-[var(--ink)]">
          {blocks.map((block, index) => {
            if (block.kind === "heading") {
              return (
                <h2 className="mt-8 text-xl font-semibold text-[var(--ink)]" key={index}>
                  {block.text}
                </h2>
              );
            }

            if (block.kind === "list") {
              return (
                <ul className="ml-5 list-disc space-y-1.5 text-[var(--ink-muted)]" key={index}>
                  {block.items.map((item, itemIndex) => (
                    <li
                      className="[&_strong]:text-[var(--ink)]"
                      dangerouslySetInnerHTML={{ __html: item }}
                      key={itemIndex}
                    />
                  ))}
                </ul>
              );
            }

            return (
              <p
                className="text-[var(--ink-muted)] [&_strong]:text-[var(--ink)]"
                dangerouslySetInnerHTML={{ __html: block.html }}
                key={index}
              />
            );
          })}
        </div>

        {related.length > 0 ? (
          <aside className="mt-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--primary)]">More in {topic.category}</h3>
            <ul className="mt-3 space-y-2">
              {related.map((other) => (
                <li key={other.slug}>
                  <Link className="text-sm font-semibold text-[var(--ink)] hover:text-[var(--primary)]" href={`/help/${other.slug}`}>
                    {other.title}
                  </Link>
                  <p className="text-sm text-[var(--ink-muted)]">{other.summary}</p>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </article>
    </HelpShell>
  );
}
