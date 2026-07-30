/**
 * Placeholder landing for the hub's main web app.
 *
 * The real "main hub" UI (organizer/admin console over the source of truth) is
 * being designed separately and will replace this. Backend (schema + sync
 * engine) is being built independently so the design can drop straight in.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "10vh auto", padding: "0 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>Office Hours Hub</h1>
      <p style={{ color: "#666", lineHeight: 1.6 }}>
        Source-of-truth + sync engine for Notion Office Hours bookings. The admin
        console UI is in design. Backend endpoints are live under{" "}
        <code>/api</code>.
      </p>
    </main>
  );
}
