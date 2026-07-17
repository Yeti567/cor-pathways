import { notFound } from "next/navigation";
import { WorkflowBranchFixture } from "./WorkflowBranchFixture";

export const dynamic = "force-dynamic";

type WorkflowBranchFixturePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function fixtureId(value: string | undefined) {
  return value?.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 48) || "default";
}

export default async function WorkflowBranchFixturePage({ searchParams }: WorkflowBranchFixturePageProps) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const runId = fixtureId(firstParam(params.run));

  return <WorkflowBranchFixture runId={runId} />;
}
