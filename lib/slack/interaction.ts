export type Interaction =
  | { kind: "open_feedback"; bookingId: string; triggerId: string }
  | { kind: "feedback_submit"; bookingId: string; attended?: boolean; rating?: number; note?: string }
  | { kind: "open_general"; eventId: string; expertEmail: string; triggerId: string }
  | { kind: "general_submit"; eventId: string; expertEmail: string; note?: string }
  | { kind: "ignore" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = any;

/** Pure: turn a parsed Slack interactivity payload into a typed Interaction.
 *  - Per-1:1 feedback: "Give feedback" button (fb_open) → per-guest modal (private_metadata = bookingId).
 *  - Overall event feedback: top-level button (gfb_open) → general modal (private_metadata = "g:<eventId>|<email>").
 */
export function parseInteraction(payload: Payload): Interaction {
  if (payload?.type === "view_submission") {
    const pm = payload.view?.private_metadata as string | undefined;
    if (!pm) return { kind: "ignore" };
    const values = payload.view?.state?.values ?? {};

    // Overall event feedback (guest-less, one per event+expert).
    if (pm.startsWith("g:")) {
      const [eventId, expertEmail] = pm.slice(2).split("|");
      if (!eventId || !expertEmail) return { kind: "ignore" };
      const noteVal = values.general?.general_v?.value as string | undefined;
      const note = typeof noteVal === "string" && noteVal.trim() !== "" ? noteVal : undefined;
      return { kind: "general_submit", eventId, expertEmail, note };
    }

    // Per-1:1 feedback.
    const bookingId = pm;
    const attendVal = values.attend?.attend_v?.selected_option?.value as string | undefined;
    const ratingVal = values.rating?.rating_v?.selected_option?.value as string | undefined;
    const noteVal = values.note?.note_v?.value as string | undefined;
    const attended = attendVal === "yes" ? true : attendVal === "no" ? false : undefined;
    const rating = ratingVal ? Number(ratingVal) : undefined;
    const note = typeof noteVal === "string" && noteVal.trim() !== "" ? noteVal : undefined;
    return { kind: "feedback_submit", bookingId, attended, rating, note };
  }

  if (payload?.type === "block_actions") {
    const action = payload.actions?.[0];
    if (action?.action_id === "fb_open") {
      const bookingId = String(action.value ?? "");
      if (bookingId) return { kind: "open_feedback", bookingId, triggerId: payload.trigger_id as string };
    }
    if (action?.action_id === "gfb_open") {
      const [eventId, expertEmail] = String(action.value ?? "").split("|");
      if (eventId && expertEmail) {
        return { kind: "open_general", eventId, expertEmail, triggerId: payload.trigger_id as string };
      }
    }
  }
  return { kind: "ignore" };
}

export interface FeedbackModalState {
  guestName: string;
  attended?: boolean | null;
  rating?: number | null;
  note?: string | null;
}

const RATING_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ text: { type: "plain_text", text: String(n) }, value: String(n) }));
const ATTEND_OPTIONS = [
  { text: { type: "plain_text", text: "✅ Showed up", emoji: true }, value: "yes" },
  { text: { type: "plain_text", text: "🚫 No-show", emoji: true }, value: "no" },
];

/** The feedback form modal for one 1:1. `bookingId` rides in private_metadata; any
 * existing answers pre-fill the fields so re-opening shows what was submitted.
 * Overall/event feedback lives in its own modal now (generalFeedbackModalView). */
export function feedbackModalView(bookingId: string, state: FeedbackModalState): unknown {
  const attendInitial =
    state.attended === true ? ATTEND_OPTIONS[0] : state.attended === false ? ATTEND_OPTIONS[1] : undefined;
  const ratingInitial = state.rating ? RATING_OPTIONS.find((o) => o.value === String(state.rating)) : undefined;

  return {
    type: "modal",
    private_metadata: bookingId,
    title: { type: "plain_text", text: "1:1 feedback" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `Feedback for *${state.guestName}*` } },
      {
        type: "input",
        block_id: "attend",
        optional: true,
        label: { type: "plain_text", text: "Did they show up?" },
        element: {
          type: "radio_buttons",
          action_id: "attend_v",
          options: ATTEND_OPTIONS,
          ...(attendInitial ? { initial_option: attendInitial } : {}),
        },
      },
      {
        type: "input",
        block_id: "rating",
        optional: true,
        label: { type: "plain_text", text: "How did it go? (1–5)" },
        element: {
          type: "static_select",
          action_id: "rating_v",
          placeholder: { type: "plain_text", text: "Pick a rating" },
          options: RATING_OPTIONS,
          ...(ratingInitial ? { initial_option: ratingInitial } : {}),
        },
      },
      {
        type: "input",
        block_id: "note",
        optional: true,
        label: { type: "plain_text", text: "Anything to note?" },
        element: {
          type: "plain_text_input",
          action_id: "note_v",
          multiline: true,
          ...(state.note ? { initial_value: state.note } : {}),
        },
      },
    ],
  };
}

/** The overall event-feedback modal (guest-less, one per event+expert). A single
 * written box; `(eventId, expertEmail)` ride in private_metadata (prefixed "g:").
 * Pre-fills from any prior submission. */
export function generalFeedbackModalView(
  eventId: string,
  expertEmail: string,
  state: { note?: string | null },
): unknown {
  return {
    type: "modal",
    private_metadata: `g:${eventId}|${expertEmail}`,
    title: { type: "plain_text", text: "Event feedback" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "Your overall thoughts on the event — what went well, what we could improve, anything you learned." } },
      {
        type: "input",
        block_id: "general",
        optional: true,
        label: { type: "plain_text", text: "Overall event feedback & learnings" },
        element: {
          type: "plain_text_input",
          action_id: "general_v",
          multiline: true,
          ...(state.note ? { initial_value: state.note } : {}),
        },
      },
    ],
  };
}
