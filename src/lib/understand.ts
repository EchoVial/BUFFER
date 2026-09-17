import { parseMessage, type Intent, type ParsedMessage } from "./nlp";
import { understandWithClaude, type Understanding } from "./llm";
import type { UserRecord } from "./types";

/**
 * One entry point for "what did they mean": Claude first (natural language,
 * context, ambiguity), the regex parser as the offline fallback and as the
 * source of a few slots Claude does not bother with (bullet lists, slang).
 */
export async function understand(raw: string, user: UserRecord): Promise<ParsedMessage> {
  const fallback = parseMessage(raw, user);
  const llm = await understandWithClaude(raw, user);
  if (!llm) {
    fallback.notes.push("engine: rules");
    return fallback;
  }
  return merge(fallback, llm, raw);
}

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : undefined);
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function merge(base: ParsedMessage, llm: Understanding, raw: string): ParsedMessage {
  const intent = llm.intent as Intent;
  const eventTitle = clean(llm.title) ? titleCase(clean(llm.title)!) : base.event.title;
  const parsed: ParsedMessage = {
    ...base,
    intent,
    confirm: intent === "confirm",
    cancel: intent === "cancel",
    event: {
      ...base.event,
      title: eventTitle,
      date: clean(llm.date) ?? base.event.date,
      start: clean(llm.start) ?? (intent === "add_event" || intent === "protect" || intent === "edit_item" ? undefined : base.event.start),
      durationMinutes: llm.duration_minutes ?? base.event.durationMinutes,
      kind: llm.kind ?? base.event.kind,
      timeUnknown: !clean(llm.start),
    },
    todo: {
      ...base.todo,
      title: clean(llm.title) ?? base.todo.title,
      items: llm.items && llm.items.length > 1 ? llm.items.map((t) => titleCase(t.trim())).filter(Boolean) : base.todo.items,
      priority: llm.priority ?? base.todo.priority,
      estimatedMinutes: llm.duration_minutes ?? base.todo.estimatedMinutes,
      dueDate: clean(llm.due_date) ?? base.todo.dueDate,
      kind: llm.kind ?? base.todo.kind,
      doneHint: clean(llm.target) ?? base.todo.doneHint,
    },
    prefs: llm.prefs ? Object.fromEntries(Object.entries(llm.prefs).filter(([, v]) => v !== null && v !== undefined)) : base.prefs,
    renameTo: clean(llm.rename_to) ?? base.renameTo,
    targetHint: clean(llm.target) ?? base.targetHint,
    question: clean(llm.question),
    options: llm.options ?? undefined,
    replyHint: clean(llm.reply_hint),
    memoryNotes: llm.memory_notes ?? undefined,
    notes: [...base.notes, `engine: claude (${Math.round(llm.confidence * 100)}%)`],
    debug: {
      ...base.debug,
      intent,
      slots: {
        ...base.debug.slots,
        llmTitle: llm.title ?? undefined,
        llmDate: llm.date ?? undefined,
        llmStart: llm.start ?? undefined,
        llmKind: llm.kind ?? undefined,
        llmConfidence: llm.confidence,
      },
      notes: [...base.debug.notes, `claude intent ${intent}`, ...(llm.question ? [`question: ${llm.question}`] : [])],
    },
  };
  // The regex parser is better at literal bullet lists; keep its items when Claude saw fewer.
  if (base.todo.items && base.todo.items.length > (parsed.todo.items?.length ?? 0)) parsed.todo.items = base.todo.items;
  void raw;
  return parsed;
}
