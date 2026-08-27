"use client";

// Dynamic Route: /projects/[projectId]/plan
// Matches ORE COMPASS / Projects / <project> / Plan workspace

import { use } from "react";
import ProjectPlanWorkspace from "@/components/ProjectPlanWorkspace";

export default function ProjectPlanPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const resolvedParams = use(params);
  const projectId = resolvedParams?.projectId || "prj_mtbxjq1z_rgxho";

  return <ProjectPlanWorkspace projectId={projectId} projectName="tamil nadu" />;
}
