export type Interaction =
  | { kind: "attend"; bookingId: string; attended: boolean; channel?: string; ts?: string }
  | { kind: "rating"; bookingId: string; rating: number; channel?: string; ts?: string }
  | { kind: "note_open"; bookingId: string; triggerId: string }
  | { kind: "note_submit"; bookingId: string; note: string }
  | { kind: "ignore" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = any;

/** Pure: turn a parsed Slack interactivity payload into a typed Interaction. */
export function parseInteraction(payload: Payload): Interaction {
  if (payload?.type === "view_submission") {
    const bookingId = payload.view?.private_metadata as string | undefined;
    const note = payload.view?.state?.values?.note_block?.note_input?.value as string | undefined;
    if (bookingId) return { kind: "note_submit", bookingId, note: note ?? "" };
    return { kind: "ignore" };
  }
  if (payload?.type === "block_actions") {
    const action = payload.actions?.[0];
    const channel = payload.container?.channel_id as string | undefined;
    const ts = payload.container?.message_ts as string | undefined;
    if (action?.action_id === "fb_attend") {
      const [bookingId, yn] = String(action.value ?? "").split(":");
      if (bookingId) return { kind: "attend", bookingId, attended: yn === "yes", channel, ts };
    }
    if (action?.action_id === "fb_rating") {
      const [bookingId, n] = String(action.selected_option?.value ?? "").split(":");
      if (bookingId) return { kind: "rating", bookingId, rating: Number(n), channel, ts };
    }
    if (action?.action_id === "fb_note") {
      const bookingId = String(action.value ?? "");
      if (bookingId) return { kind: "note_open", bookingId, triggerId: payload.trigger_id as string };
    }
  }
  return { kind: "ignore" };
}

/** The modal opened by the 📝 Note button. `bookingId` rides in private_metadata. */
export function noteModalView(bookingId: string): unknown {
  return {
    type: "modal",
    private_metadata: bookingId,
    title: { type: "plain_text", text: "Add a note" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "note_block",
        label: { type: "plain_text", text: "How did it go?" },
        element: { type: "plain_text_input", action_id: "note_input", multiline: true },
        optional: true,
      },
    ],
  };
}
