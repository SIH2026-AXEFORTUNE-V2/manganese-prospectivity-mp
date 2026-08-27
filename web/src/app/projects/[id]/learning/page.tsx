"use client";

// What each kind of feedback actually retrains - docs/issues/09-project-workspace-flow.md §7.

import { useParams } from "next/navigation";
import LearningPanel from "@/components/LearningPanel";
import { addBlockOutcome, useProject } from "@/lib/projectStore";

export default function ProjectLearningPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject(params?.id ?? null);
  if (!project) return null;

  return (
    <div style={{ maxWidth: 1000 }}>
      <LearningPanel project={project} onRecordOutcome={(o) => addBlockOutcome(project.id, o)} />
    </div>
  );
}
