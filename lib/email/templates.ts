export interface CheckInEmailInput {
  guestName: string;
  company: string | null;
  slotLabel: string | null;
  challenge: string | null;
}

export function checkInEmail(i: CheckInEmailInput): { subject: string; text: string } {
  const subject = `Your Office Hours guest just checked in: ${i.guestName}`;
  const text = [
    `${i.guestName}${i.company ? ` (${i.company})` : ""} just checked in for your 1:1.`,
    i.slotLabel ? `Slot: ${i.slotLabel}` : null,
    i.challenge ? `What they need help with: ${i.challenge}` : null,
    ``,
    `Head over when you're ready.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
  return { subject, text };
}

export interface CancellationEmailInput {
  guestName: string;
  slotLabel: string | null;
}

export function cancellationEmail(i: CancellationEmailInput): { subject: string; text: string } {
  const subject = `Office Hours 1:1 cancelled: ${i.guestName}`;
  const text = [
    `Heads up — ${i.guestName} cancelled their Office Hours registration, so your 1:1${
      i.slotLabel ? ` at ${i.slotLabel}` : ""
    } is no longer happening.`,
    `The slot has been freed up for someone else.`,
  ].join("\n");
  return { subject, text };
}
