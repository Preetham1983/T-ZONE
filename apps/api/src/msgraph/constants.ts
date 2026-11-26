export const MSGRAPH_CLIENT_ID = '3d7688c6-f449-4d04-8b0d-57d94818e922';
export const MSGRAPH_TENANT = 'common';
export const MSGRAPH_AUTH_URL = `https://login.microsoftonline.com/${MSGRAPH_TENANT}/oauth2/v2.0/authorize`;
export const MSGRAPH_TOKEN_URL = `https://login.microsoftonline.com/${MSGRAPH_TENANT}/oauth2/v2.0/token`;

export const MSGRAPH_SCOPES = [
  'User.Read',
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
  'Calendars.ReadWrite',
  'Files.Read',
  'Files.ReadWrite',
  'Sites.Read.All',
  'Sites.ReadWrite.All',
  'Chat.Read',
  'Chat.ReadWrite',
  'ChannelMessage.Read.All',
  'ChannelMessage.Send',
  'OnlineMeetingTranscript.Read.All',
  'OnlineMeetings.Read',
  'People.Read',
  'Contacts.Read',
  'offline_access',
  'Notes.Read',
  'Notes.ReadWrite',
  'OnlineMeetingAiInsight.Read.All',
  'Tasks.ReadWrite',
  'Group.Read.All',
].join(' ');

export const GRAPH_V1_BASE = 'https://graph.microsoft.com/v1.0';
export const GRAPH_BETA_BASE = 'https://graph.microsoft.com/beta';
