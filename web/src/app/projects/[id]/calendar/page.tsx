"use client";

// Planned vs. actual, day by day - docs/issues/09-project-workspace-flow.md §5.

import { useState } from "react";
import { useParams } from "next/navigation";
import { CloudRain, Wrench, Zap, Clock3 } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import PlanCalendar from "@/components/PlanCalendar";
import DayLogForm from "@/components/DayLogForm";
import { deleteDayLog, saveDayLog, useProject } from "@/lib/projectStore";

export default function ProjectCalendarPage() {
  const params = useParams<{ id: string }>();
  const { project } = useProject(params?.id ?? null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  if (!project) return null;

  const planDay = project.plan.find((d) => d.date === selectedDate) ?? null;
  const logged = Object.keys(project.logs).length;
  const produced = Object.values(project.logs).reduce((s, l) => s + l.actualTonnes, 0);

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 620px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Daily plan vs. actual</h2>
            <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 4 }}>
              {logged} of {project.plan.length} days logged · {produced.toLocaleString()} t recorded.
              Click any day to enter or edit it.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: "var(--ink-dim)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CloudRain size={12} /> monsoon</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Wrench size={12} /> maintenance</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Zap size={12} /> blast risk</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Clock3 size={12} /> rest day</span>
          </div>
        </div>

        <PlanCalendar
          plan={project.plan}
          logs={project.logs}
          calibration={project.calibration}
          selectedDate={selectedDate}
          onSelectDate={(d) => setSelectedDate((prev) => (prev === d ? null : d))}
        />
      </div>

      <div style={{ flex: "0 1 420px", width: "min(420px, 100%)", position: "sticky", top: 16 }}>
        {planDay ? (
          <DayLogForm
            // Remount per day: the form seeds its fields from that day's log on mount, so
            // the key is what stops one day's numbers showing under another day's heading.
            key={planDay.date}
            planDay={planDay}
            existing={project.logs[planDay.date] ?? null}
            calibration={project.calibration}
            onSave={(log) => saveDayLog(project.id, log)}
            onDelete={() => {
              deleteDayLog(project.id, planDay.date);
              setSelectedDate(null);
            }}
            onClose={() => setSelectedDate(null)}
          />
        ) : (
          <GlassCard style={{ padding: 18, fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6 }}>
            Pick a day to log what actually came out. Entry is structured — tonnes, grade, and each
            delay as a reason code with a machine id and its hours — because that is what the model
            can learn from. A sentence describing the same thing cannot be trained on.
          </GlassCard>
        )}
      </div>
    </div>
  );
}
