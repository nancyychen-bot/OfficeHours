"use client";

import { useState } from "react";
import type { SentLogRow } from "@/lib/comms/log";
import { CityFlow } from "./CityFlow";
import { CitySentLog } from "./CitySentLog";

export function CityTabs({ sentLog }: { sentLog: SentLogRow[] }) {
  const [tab, setTab] = useState<"flow" | "log">("flow");
  const Tab = ({ id, label }: { id: "flow" | "log"; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={`border-b-2 px-4 py-2 text-sm ${tab === id ? "border-neutral-900 font-semibold" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
    >
      {label}
    </button>
  );
  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-line">
        <Tab id="flow" label="Flow" />
        <Tab id="log" label={`Sent log · ${sentLog.length}`} />
        <span className="border-b-2 border-transparent px-4 py-2 text-sm text-neutral-300">Localization (later)</span>
      </div>
      {tab === "flow" ? <CityFlow /> : <CitySentLog rows={sentLog} />}
    </div>
  );
}
