"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The signed-in studio account (admin or designer), as the SERVER resolved it
 * for this page. The Design Studio scopes its crash-recovery copies to this
 * id, so on a shared browser one account never receives another's unsaved
 * design. Without a provider there is no actor and no local recovery.
 */
const StudioActorContext = createContext("");

export function StudioActorProvider({ actorId, children }: { actorId: string; children: ReactNode }) {
  return <StudioActorContext.Provider value={String(actorId || "")}>{children}</StudioActorContext.Provider>;
}

export function useStudioActorId(): string {
  return useContext(StudioActorContext);
}
