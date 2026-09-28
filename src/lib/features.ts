"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

let cached: Promise<boolean> | null = null;

function loadAutoCopy(): Promise<boolean> {
  cached ??= api.features().then((f) => f.autoCopy === true).catch(() => false);
  return cached;
}

/** Server auto-copy switch (AUTO_COPY_ENABLED). null while loading; false = show auto-copy UI disabled. */
export function useAutoCopyEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void loadAutoCopy().then((v) => { if (alive) setEnabled(v); });
    return () => { alive = false; };
  }, []);
  return enabled;
}
