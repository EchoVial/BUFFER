import { parseMessage, type Intent, type ParsedMessage } from "./nlp";
import { modelLabel, understandSetupWithModel, understandWithModel, type SetupUnderstanding, type Understanding } from "./llm";
import type { UserRecord } from "./types";

/**
 * One entry point for "what did they mean": the model first (natural language,
 * context, ambiguity, and the words to say back when someone goes off script),
 * the regex parser as the offline fallback and as the source of a few slots
 * Claude does not bother with (bullet lists, slang).
 */

type Llm = typeof understandWithModel;
type SetupLlm = typeof understandSetupWithModel;
let llm: Llm = understandWithModel;
let setupLlm: SetupLlm = understandSetupWithModel;

/** Swap the model call (tests, offline demos). Pass nothing to restore the configured model. */
export function setUnderstandingEngine(fn?: Llm, setupFn?: SetupLlm) {
  llm = fn ?? understandWithModel;
  setupLlm = setupFn ?? understandSetupWithModel;
}

export async function understand(raw: string, user: UserRecord): Promise<ParsedMessage> {
  const fallback = parseMessage(raw, user);
  const out = await llm(raw, user);
  if (!out) {
    fallback.notes.push("engine: rules");
    return fallback;
  }
  return merge(fallback, out);
}

/** The setup questions: the model reads loose answers; null means "use the regexes". */
export async function understandSetup(step: "work" | "unwind" | "people", raw: string, user: UserRecord): Promise<SetupUnderstanding | null> {
  return setupLlm(step, raw, user);
}

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : undefined);
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function merge(base: ParsedMessage, out: Understanding): ParsedMessage {
  const intent = out.intent as Intent;
  const eventTitle = clean(out.title) ? titleCase(clean(out.title)!) : base.event.title;
  const parsed: ParsedMessage = {
    ...base,
    intent,
    confirm: intent === "confirm",
    cancel: intent === "cancel",
    event: {
      ...base.event,
      title: eventTitle,
      date: clean(out.date) ?? base.event.date,
      start: clean(out.start) ?? (intent === "add_event" || intent === "protect" || intent === "edit_item" ? undefined : base.event.start),
      durationMinutes: out.duration_minutes ?? base.event.durationMinutes,
      kind: out.kind ?? base.event.kind,
      timeUnknown: !clean(out.start),
    },
    todo: {
      ...base.todo,
      title: clean(out.title) ?? base.todo.title,
      items: out.items && out.items.length > 1 ? out.items.map((t) => titleCase(t.trim())).filter(Boolean) : base.todo.items,
      priority: out.priority ?? base.todo.priority,
      estimatedMinutes: out.duration_minutes ?? base.todo.estimatedMinutes,
      dueDate: clean(out.due_date) ?? base.todo.dueDate,
      kind: out.kind ?? base.todo.kind,
      doneHint: clean(out.target) ?? base.todo.doneHint,
    },
    prefs: out.prefs ? Object.fromEntries(Object.entries(out.prefs).filter(([, v]) => v !== null && v !== undefined)) : base.prefs,
    renameTo: clean(out.rename_to) ?? base.renameTo,
    targetHint: clean(out.target) ?? base.targetHint,
    question: clean(out.question) ?? (intent === "clarify" ? clean(out.reply) : undefined),
    options: out.options ?? undefined,
    reply: clean(out.reply),
    lead: clean(out.lead),
    people: out.people?.map((p) => p.trim()).filter(Boolean),
    memoryNotes: out.memory_notes ?? undefined,
    notes: [...base.notes, `engine: ${modelLabel()} (${Math.round((out.confidence ?? 0.6) * 100)}%)`],
    debug: {
      ...base.debug,
      intent,
      slots: {
        ...base.debug.slots,
        llmTitle: out.title ?? undefined,
        llmDate: out.date ?? undefined,
        llmStart: out.start ?? undefined,
        llmKind: out.kind ?? undefined,
        llmConfidence: out.confidence,
      },
      notes: [...base.debug.notes, `model intent ${intent}`, ...(out.reply ? [`reply: ${out.reply.slice(0, 80)}`] : [])],
    },
  };
  // The regex parser is better at literal bullet lists; keep its items when Claude saw fewer.
  if (base.todo.items && base.todo.items.length > (parsed.todo.items?.length ?? 0)) parsed.todo.items = base.todo.items;
  return parsed;
}
