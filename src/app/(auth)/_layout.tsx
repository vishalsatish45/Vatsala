import { Stack } from 'expo-router';

import { MoodProvider } from '@/ui/mood';

export default function AuthLayout() {
  return (
    <MoodProvider mood="family">
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
    </MoodProvider>
  );
}
