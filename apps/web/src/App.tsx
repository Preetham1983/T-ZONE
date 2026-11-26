import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/AppShell.js';
import { CommandPalette } from './components/CommandPalette.js';
import { AuthScreen } from './features/auth/AuthScreen.js';
import { ChatScreen } from './features/chat/ChatScreen.js';
import { DashboardScreen } from './features/dashboard/DashboardScreen.js';
import { HubScreen } from './features/hub/HubScreen.js';
import { MeetingAgentScreen } from './features/meetings/MeetingAgentScreen.js';
import { SettingsScreen } from './features/settings/SettingsScreen.js';
import { TeamsScreen } from './features/teams/TeamsScreen.js';
import { TranscriptsScreen } from './features/transcripts/TranscriptsScreen.js';
import { useAppStore } from './stores/appStore.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function ScreenRouter() {
  const activeScreen = useAppStore((s) => s.activeScreen);
  switch (activeScreen) {
    case 'dashboard':
      return <DashboardScreen />;
    case 'auth':
      return <AuthScreen />;
    case 'meetings':
      return <MeetingAgentScreen />;
    case 'transcripts':
      return <TranscriptsScreen />;
    case 'teams':
      return <TeamsScreen />;
    case 'hub':
      return <HubScreen />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return <ChatScreen />;
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell>
        <ScreenRouter />
      </AppShell>
      <CommandPalette />
    </QueryClientProvider>
  );
}

export default App;
