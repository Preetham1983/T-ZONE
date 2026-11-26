import type { PlaybookDefinition } from '@tzone/shared';

export const PLAYBOOKS: PlaybookDefinition[] = [
  {
    id: 'communication_email',
    title: 'Communication Emails Generation',
    description:
      'Collects recent Teams discussions, meeting transcripts, and open action items, then creates a clean Outlook HTML draft.',
    badge: 'Outlook Draft',
    defaultPrompt:
      'Review my recent Teams chats, channels, and meeting transcripts from the last 5 days, identify key updates and follow-ups, and create an Outlook email draft summarizing status and next steps.',
  },
  {
    id: 'customer_research',
    title: 'Customer Research',
    description:
      'Cross-searches Teams conversations, meeting transcripts, Outlook threads, and SharePoint files for stakeholder context.',
    badge: 'Research Brief',
    defaultPrompt:
      'Search across all Teams messages, extracted meeting transcripts, emails, and SharePoint sites for recent customer feedback, pain points, and commitments, and produce a structured research brief.',
  },
  {
    id: 'release_notes',
    title: 'Release Notes Generation',
    description:
      'Compiles completed Planner tasks, release channel announcements, and sprint meeting transcripts into formatted release notes.',
    badge: 'Release Notes',
    defaultPrompt:
      'Inspect Planner tasks, Teams release/engineering channels, and recent sprint transcripts to draft structured Release Notes (Features, Fixes, Known Issues, Owners).',
  },
  {
    id: 'requirements_analysis',
    title: 'Requirements Analysis',
    description:
      'Extracts functional/non-functional requirements and owners from stakeholder transcripts and OneNote notes.',
    badge: 'Specs & Tasks',
    defaultPrompt:
      'Analyze our recent meeting transcripts and OneNote pages to extract functional requirements, open questions, decisions, and proposed Planner tasks with owners.',
  },
];
