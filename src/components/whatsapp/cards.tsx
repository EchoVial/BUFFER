"use client";

import { ChatMessage, DayStats } from "@/lib/types";
import { durationLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

export function MessageCards({ message }: { message: ChatMessage }) {
  const card = message.card;
  if (!card) return null;
  if (card.type === "schedule") {
    return (
      <ScheduleCard
        date={card.date}
        lines={card.lines}
        warnings={card.warnings}
        stats={card.stats}
      />
    );
  }
  if (card.type === "proposal") {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-[13px] font-medium text-[#00a884]">{card.eventPreview}</p>
        <SplitSchedule before={card.before} after={card.after} />
        <Box title="What moves">
          {card.moves.map((m) => (
            <p key={m} className="text-[12.5px] leading-5 text-[#e9edef]">
              → {m}
            </p>
          ))}
        </Box>
        {card.warnings.length ? (
          <Box title="Watch outs" warn>
            {card.warnings.map((w) => (
              <p key={w} className="text-[12.5px] leading-5">
                {w}
              </p>
            ))}
          </Box>
        ) : null}
      </div>
    );
  }
  if (card.type === "todos") {
    return (
      <Box title="To-do hierarchy">
        <pre className="whitespace-pre-wrap font-[inherit] text-[12.5px] leading-5 text-[#e9edef]">
          {card.lines.join("\n")}
        </pre>
      </Box>
    );
  }
  if (card.type === "overlaps") {
    return (
      <Box title="Overlaps" warn>
        {card.items.map((w) => (
          <p key={w} className="text-[12.5px] leading-5">
            {w}
          </p>
        ))}
      </Box>
    );
  }
  return (
    <pre className="mt-2 max-h-40 overflow-auto rounded bg-black/30 p-2 text-[11px] text-[#8696a0]">
      {card.json}
    </pre>
  );
}

function ScheduleCard({
  date,
  lines,
  warnings,
  stats,
}: {
  date: string;
  lines: string[];
  warnings: string[];
  stats: DayStats;
}) {
  return (
    <div className="mt-2 space-y-2">
      <Box title={`Schedule · ${date}`}>
        {lines.length ? (
          lines.map((l) => (
            <p key={l} className="text-[12px] leading-5 tracking-tight text-[#e9edef]">
              {l}
            </p>
          ))
        ) : (
          <p className="text-[12.5px] text-[#8696a0]">empty day — add something</p>
        )}
        <p className="pt-1 text-[11px] text-[#00a884]">
          Work {durationLabel(stats.workMinutes)}/{durationLabel(stats.workCap)} · Social{" "}
          {durationLabel(stats.socialMinutes)}/{durationLabel(stats.socialTarget)} · Free{" "}
          {durationLabel(stats.freeMinutes)}
        </p>
      </Box>
      {warnings.length ? (
        <Box title="Balance check" warn>
          {warnings.map((w) => (
            <p key={w} className="text-[12.5px] leading-5">
              {w}
            </p>
          ))}
        </Box>
      ) : null}
    </div>
  );
}

function SplitSchedule({ before, after }: { before: string[]; after: string[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Box title="Before">
        {before.map((l) => (
          <p key={l} className="text-[12px] leading-4 tracking-tight text-[#8696a0]">
            {l}
          </p>
        ))}
      </Box>
      <Box title="Possible after">
        {after.map((l) => (
          <p key={l} className="text-[12px] leading-4 tracking-tight text-[#e9edef]">
            {l}
          </p>
        ))}
      </Box>
    </div>
  );
}

function Box({
  title,
  children,
  warn,
}: {
  title: string;
  children: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-2.5 py-2",
        warn
          ? "border-[#f59e0b]/40 bg-[#f59e0b]/10 text-[#fcd34d]"
          : "border-white/10 bg-black/20",
      )}
    >
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8696a0]">
        {title}
      </p>
      {children}
    </div>
  );
}
