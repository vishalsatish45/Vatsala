import { createContext, useContext, type ReactNode } from 'react';

import { moods, type Mood, type MoodName } from './tokens';

const MoodContext = createContext<Mood>(moods.family);

/** Sets the atmosphere for a subtree: `family` (full glass world) or `care` (quieter, denser). */
export function MoodProvider({ mood, children }: { mood: MoodName; children: ReactNode }) {
  return <MoodContext value={moods[mood]}>{children}</MoodContext>;
}

export function useMood(): Mood {
  return useContext(MoodContext);
}
