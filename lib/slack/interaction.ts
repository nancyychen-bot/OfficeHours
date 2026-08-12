export type Interaction =
  | { kind: "open_feedback"; bookingId: string; triggerId: string }
  | { kind: "feedback_submit"; bookingId: string; attended?: boolean; rating?: number; note?: string; general?: string }
  | { kind: "ignore" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = any;

/** Pure: turn a parsed Slack interactivity payload into a typed Interaction.
 * The feedback flow is: a "Give feedback" button (block_actions, action_id fb_open)
 * opens a modal; the modal's Submit fires a view_submission carrying all fields. */
export function parseInteraction(payload: Payload): Interaction {
  if (payload?.type === "view_submission") {
    const bookingId = payload.view?.private_metadata as string | undefined;
    if (!bookingId) return { kind: "ignore" };
    const values = payload.view?.state?.values ?? {};
    const attendVal = values.attend?.attend_v?.selected_option?.value as string | undefined;
    const ratingVal = values.rating?.rating_v?.selected_option?.value as string | undefined;
    const noteVal = values.note?.note_v?.value as string | undefined;
    const generalVal = values.general?.general_v?.value as string | undefined;
    const attended = attendVal === "yes" ? true : attendVal === "no" ? false : undefined;
    const rating = ratingVal ? Number(ratingVal) : undefined;
    const note = typeof noteVal === "string" && noteVal.trim() !== "" ? noteVal : undefined;
    const general = typeof generalVal === "string" && generalVal.trim() !== "" ? generalVal : undefined;
    return { kind: "feedback_submit", bookingId, attended, rating, note, general };
  }
  if (payload?.type === "block_actions") {
    const action = payload.actions?.[0];
    if (action?.action_id === "fb_open") {
      const bookingId = String(action.value ?? "");
      if (bookingId) return { kind: "open_feedback", bookingId, triggerId: payload.trigger_id as string };
    }
  }
  return { kind: "ignore" };
}

export interface FeedbackModalState {
  guestName: string;
  attended?: boolean | null;
  rating?: number | null;
  note?: string | null;
  general?: string | null;
}

const RATING_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ text: { type: "plain_text", text: String(n) }, value: String(n) }));
const ATTEND_OPTIONS = [
  { text: { type: "plain_text", text: "✅ Showed up", emoji: true }, value: "yes" },
  { text: { type: "plain_text", text: "🚫 No-show", emoji: true }, value: "no" },
];

/** The feedback form modal for one 1:1. `bookingId` rides in private_metadata; any
 * existing answers pre-fill the fields so re-opening shows what was submitted. */
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
      {
        type: "input",
        block_id: "general",
        optional: true,
        label: { type: "plain_text", text: "General feedback & learnings" },
        element: {
          type: "plain_text_input",
          action_id: "general_v",
          multiline: true,
          ...(state.general ? { initial_value: state.general } : {}),
        },
      },
    ],
  };
}
