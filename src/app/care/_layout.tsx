import { Stack } from 'expo-router';

import { MoodProvider } from '@/ui/mood';

/** Care Team face — quieter, denser atmosphere (DESIGN.md §7). */
export default function CareLayout() {
  return (
    <MoodProvider mood="care">
      <Stack screenOptions={{ headerShown: false }} />
    </MoodProvider>
  );
}
