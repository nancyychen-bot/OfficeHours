"use client";

import { useEffect, useState } from "react";

interface Q { id: string; label: string; kind: "text" | "select" | "slot"; options: string[] }

export default function CompleteRegistrationForm({ token }: { token: string }) {
  const [state, setState] = useState<"loading" | "form" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [eventName, setEventName] = useState("");
  const [questions, setQuestions] = useState<Q[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/complete-registration/load", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "This link is invalid."); setState("error"); return; }
        setEventName(data.eventName ?? "");
        setQuestions(data.questions ?? []);
        setState("form");
      } catch {
        setError("Something went wrong loading your registration.");
        setState("error");
      }
    })();
  }, [token]);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const answers = questions.map((q) => ({ label: q.label, kind: q.kind, value: values[q.id] ?? "" }));
      const res = await fetch("/api/complete-registration/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, answers }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
      setState("done");
    } catch {
      setError("Something went wrong saving your answers.");
    } finally {
      setBusy(false);
    }
  }

  const card = "w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-sm";
  const input = "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500";
  const btn = "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50";

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-12">
      <div className={card}>
        {state === "loading" ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : state === "error" ? (
          <div className="space-y-2 text-sm text-neutral-700">
            <h1 className="text-lg font-semibold">We couldn&rsquo;t open this form</h1>
            <p className="text-neutral-600">{error}</p>
          </div>
        ) : state === "done" ? (
          <div className="space-y-2 text-sm text-neutral-700">
            <h1 className="text-lg font-semibold text-green-700">You&rsquo;re all set 🎉</h1>
            <p>Thanks — your registration for {eventName || "the event"} is complete. You can close this page.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <h1 className="text-lg font-semibold">Finish registering for {eventName || "the event"}</h1>
            <p className="text-sm text-neutral-500">Take a minute to tell us a bit more so we can make the most of your time.</p>
            {questions.map((q) => (
              <label key={q.id} className="block space-y-1">
                <span className="text-sm font-medium">{q.label}</span>
                {q.kind === "text" ? (
                  <textarea className={input} rows={3}
                    value={values[q.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))} />
                ) : (
                  <select className={input}
                    value={values[q.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))}>
                    <option value="">Select…</option>
                    {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
              </label>
            ))}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button className={btn} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Submit"}</button>
          </div>
        )}
      </div>
    </main>
  );
}
