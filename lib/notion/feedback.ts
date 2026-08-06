import type { getNotionClient } from "./client";

/**
 * Notion-side helpers for the feedback form enrichment + Dev mirror.
 * Property names are pinned from the live "Build Bar Feedback" schema.
 */

export const FB = {
  name: "What is your name?",
  title: "Name",
  email: "What email do you use for Notion?",
  eventDate: "Event Date",
  location: "Location",
  helper: "Notion Expert",
  needsReview: "Needs review",
  satisfaction: "How satisfied were you with this event?",
  satisfactionScore: "Satisfaction score",
  confidence: "How confident are you using Notion after this event vs. before?",
  featureIntent: "Which feature or workflow will you try this week?",
  highlight: "What was the highlight, and anything we should improve?",
  interests: "Would you be interested in any of these?",
} as const;

// Database + data-source ids (v2025-09-03: pages are created under a data source).
export const FEEDBACK_AMBASSADOR_DB = "cf3bd8e9cf0d4594b273835809eef5ad";
export const FEEDBACK_AMBASSADOR_DS = "9bfd46cd-519f-4c0b-95be-08ac97549b51";
export const FEEDBACK_DEV_DB = "d9ffd103ba354e35aeaf8e11101c2a42";
export const FEEDBACK_DEV_DS = "3d542dad-4839-4dae-b56f-911c0e60fb11";

type Props = Record<string, unknown>;

/** Leading integer of a satisfaction select ("5 - Amazing" → 5); null otherwise. */
export function parseSatisfactionScore(v: string | null | undefined): number | null {
  const m = (v ?? "").match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Read the respondent's email from the feedback page's email property. */
export function readFeedbackEmail(props: Props): string | null {
  const p = props[FB.email] as { email?: string | null } | undefined;
  return p?.email ?? null;
}

/** Read the respondent's name from the "What is your name?" rich_text property. */
export function readFeedbackName(props: Props): string | null {
  const p = props[FB.name] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  if (!p?.rich_text?.length) return null;
  return p.rich_text.map((r) => r.plain_text ?? "").join("") || null;
}

/** Read the satisfaction select option name (used to derive the numeric score). */
export function readSatisfactionSelect(props: Props): string | null {
  return readSelectName(props, FB.satisfaction);
}

/** Read a named select property's option name. */
export function readSelectName(props: Props, name: string): string | null {
  const p = props[name] as { select?: { name?: string } | null } | undefined;
  return p?.select?.name ?? null;
}

/** Read a named rich_text property's plain text. */
export function readRichTextProp(props: Props, name: string): string | null {
  const p = props[name] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  if (!p?.rich_text?.length) return null;
  return p.rich_text.map((r) => r.plain_text ?? "").join("") || null;
}

/** Read a named multi_select property's option names. */
export function readMultiSelect(props: Props, name: string): string[] {
  const p = props[name] as { multi_select?: Array<{ name: string }> } | undefined;
  return (p?.multi_select ?? []).map((o) => o.name);
}

/** All feedback content parsed off the page (for persisting to Supabase). */
export interface FeedbackContent {
  satisfactionLabel: string | null;
  satisfactionScore: number | null;
  confidence: string | null;
  interests: string[];
  featureIntent: string | null;
  highlight: string | null;
}
export function readFeedbackContent(props: Props): FeedbackContent {
  const satisfactionLabel = readSatisfactionSelect(props);
  return {
    satisfactionLabel,
    satisfactionScore: parseSatisfactionScore(satisfactionLabel),
    confidence: readSelectName(props, FB.confidence),
    interests: readMultiSelect(props, FB.interests),
    featureIntent: readRichTextProp(props, FB.featureIntent),
    highlight: readRichTextProp(props, FB.highlight),
  };
}

/** Build the enrichment write payload for a feedback row. */
export function enrichmentProperties(input: {
  guestName: string | null;
  eventDate: string | null;
  city: string | null;
  helperName: string | null;
  needsReview: boolean;
  satisfactionScore: number | null;
}): Props {
  const props: Props = {
    [FB.eventDate]: { date: input.eventDate ? { start: input.eventDate } : null },
    // Location is a select; Notion auto-creates the option if the city is new.
    [FB.location]: { select: input.city ? { name: input.city } : null },
    [FB.helper]: {
      rich_text: input.helperName ? [{ type: "text", text: { content: input.helperName.slice(0, 2000) } }] : [],
    },
    [FB.needsReview]: { checkbox: input.needsReview },
  };
  if (input.satisfactionScore != null) {
    props[FB.satisfactionScore] = { number: input.satisfactionScore };
  }
  // Set the page title (the "Submission" title property) to the respondent's name.
  if (input.guestName) {
    props[FB.title] = { title: [{ type: "text", text: { content: input.guestName.slice(0, 2000) } }] };
  }
  return props;
}

/**
 * Rebuild a WRITE payload from a fetched page's properties, for the value types
 * the feedback form uses. Computed/read-only types (created_time, etc.) are
 * skipped so we can recreate the row in the Dev DB.
 */
export function copyableProperties(props: Props): Props {
  const out: Props = {};
  for (const [name, raw] of Object.entries(props)) {
    const p = raw as { type?: string; [k: string]: unknown };
    switch (p?.type) {
      case "title":
        out[name] = { title: toText(p.title) };
        break;
      case "rich_text":
        out[name] = { rich_text: toText(p.rich_text) };
        break;
      case "email":
        out[name] = { email: (p.email as string) ?? null };
        break;
      case "phone_number":
        out[name] = { phone_number: (p.phone_number as string) ?? null };
        break;
      case "url":
        out[name] = { url: (p.url as string) ?? null };
        break;
      case "number":
        out[name] = { number: (p.number as number) ?? null };
        break;
      case "checkbox":
        out[name] = { checkbox: !!p.checkbox };
        break;
      case "date":
        out[name] = { date: (p.date as unknown) ?? null };
        break;
      case "select": {
        const sel = p.select as { name?: string } | null;
        out[name] = { select: sel?.name ? { name: sel.name } : null };
        break;
      }
      case "multi_select": {
        const ms = (p.multi_select as Array<{ name: string }>) ?? [];
        out[name] = { multi_select: ms.map((o) => ({ name: o.name })) };
        break;
      }
      default:
        // created_time, last_edited_time, formula, rollup, people, relation, …
        break;
    }
  }
  return out;
}

function toText(rich: unknown): Array<{ type: "text"; text: { content: string } }> {
  const arr = (rich as Array<{ plain_text?: string }>) ?? [];
  const content = arr.map((r) => r.plain_text ?? "").join("");
  return content ? [{ type: "text", text: { content: content.slice(0, 2000) } }] : [];
}

/**
 * Create (or update an existing) mirror row in the Dev feedback DB. Returns the
 * Dev page id. `existingDevPageId` makes repeat webhooks update in place.
 */
export async function upsertMirrorRow(
  devClient: ReturnType<typeof getNotionClient>,
  dataSourceId: string,
  properties: Props,
  existingDevPageId?: string | null,
): Promise<string> {
  if (existingDevPageId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = (await devClient.pages.retrieve({ page_id: existingDevPageId })) as any;
      if (!existing.archived && !existing.in_trash) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await devClient.pages.update({ page_id: existingDevPageId, properties: properties as any });
        return existingDevPageId;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not[ _]?found|could not find/i.test(msg)) throw err;
      // fall through to create a fresh mirror row
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const created = (await devClient.pages.create({
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: properties as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as any;
  return created.id as string;
}
