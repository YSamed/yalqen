import type {
  AgentChatImage,
  AgentChatSession,
  AgentChatSettings,
  AgentChatSnapshot,
  AgentProviderId,
  AgentRewindPreview,
  AgentSessionState,
  AgentTerminalOutput,
  AgentTerminalSize,
  AgentTerminalSnapshot,
} from './agent.js';
import type { AnchorRect, BrowserState, ChromeLayout, SidebarFooterItem } from './chrome-types.js';
import type { SidebarMenuKind } from './command-bar-types.js';
import type { DevCommandId } from './page-override-types.js';
import type { ResponsiveScanApi } from './responsive-scan.js';
import type { TabId } from './tab-types.js';
import type { VisualComparisonApi } from './visual-comparison.js';

export type UiAction =
  | { type: 'new-tab'; url?: string }
  | { type: 'activate-tab'; id: TabId; animate?: boolean }
  | { type: 'select-tab'; id: TabId; mode: 'toggle' | 'range' }
  | { type: 'clear-tab-selection' }
  | { type: 'close-selected-tabs' }
  | { type: 'clean-tabs' }
  | { type: 'rename-tab-group'; name: string; next: string }
  | { type: 'toggle-tab-group'; name: string }
  | { type: 'move-tab-to-group'; id: TabId; name: string | null }
  | { type: 'move-tab-group'; name: string; parent: string | null }
  | { type: 'open-folder-menu'; name: string }
  | { type: 'add-live-folder'; kind: import('./live-folders').LiveFolderKind; input: string }
  | { type: 'toggle-live-folder'; id: string }
  | { type: 'refresh-live-folder'; id: string }
  | { type: 'open-live-folder-menu'; id: string }
  | { type: 'open-live-item'; id: string; itemId: string }
  | { type: 'switch-space'; id: string }
  | { type: 'create-space' }
  | { type: 'import-space' }
  | { type: 'export-spaces' }
  | { type: 'open-space-menu'; id: string }
  | { type: 'open-sidebar-context-menu' }
  | { type: 'close-tab'; id: TabId }
  | { type: 'open-favorite'; url: string }
  | { type: 'open-favorite-menu'; url: string }
  | { type: 'toggle-mute'; id: TabId }
  | { type: 'toggle-media'; id: TabId }
  | { type: 'show-tooltip'; tooltip: import('./tooltip').TooltipRequest }
  | { type: 'hide-tooltip' }
  | { type: 'show-preview'; preview: import('./previews').PreviewRequest }
  | { type: 'leave-preview' }
  | { type: 'hide-preview' }
  | { type: 'seek-media'; id: TabId; seconds: number }
  | { type: 'skip-media'; id: TabId; direction: import('./sidebar-widgets').MediaSkip }
  | { type: 'open-tab-menu'; id: TabId }
  | { type: 'move-tab'; id: TabId; toIndex: number }
  | { type: 'move-row'; id: TabId; target: TabId; after: boolean }
  | { type: 'preview-split'; id: TabId | null; side: 'left' | 'right' }
  | { type: 'split-tab'; id: TabId; side: 'left' | 'right' }
  | { type: 'split-new-tab' }
  | { type: 'split-into'; id: TabId; target: TabId }
  | { type: 'navigate'; input: string }
  | { type: 'go-home' }
  | { type: 'go-back' }
  | { type: 'go-forward' }
  | { type: 'reload' }
  | { type: 'resize-devtools'; x: number }
  | { type: 'resize-split'; index: number; x: number }
  | { type: 'open-dev-menu' }
  | { type: 'dev-command'; id: DevCommandId }
  | { type: 'resize-device'; width: number; height: number }
  | { type: 'set-device-scale-factor'; value: number }
  | { type: 'set-titlebar-tone'; tone: 'light' | 'dark' | null }
  | { type: 'stop' }
  | { type: 'reset-zoom' }
  | { type: 'open-site-info' }
  | { type: 'set-tab-mode'; mode: import('./tab-modes').TabMode }
  | { type: 'open-blocked-popups' }
  | { type: 'toggle-bookmark' }
  | { type: 'open-bookmarks-menu' }
  | { type: 'toggle-bookmarks-panel' }
  | { type: 'open-bookmark'; url: string }
  | { type: 'edit-bookmark'; id: string; title: string; url: string }
  | { type: 'rename-bookmark-folder'; id: string; title: string }
  | { type: 'open-bookmarks-page' }
  | { type: 'toggle-panel' }
  | { type: 'toggle-agent-panel' }
  | { type: 'set-agent-floating'; floating: boolean }
  | { type: 'move-floating-chat'; dx: number; dy: number }
  | { type: 'window-control'; control: 'close' | 'exit-full-screen' }
  | { type: 'open-address' }
  | { type: 'open-profile-menu' }
  | { type: 'open-sidebar-menu'; kind: SidebarMenuKind; anchor: AnchorRect; footer?: AnchorRect }
  | { type: 'set-sidebar-footer-items'; items: SidebarFooterItem[] }
  | { type: 'install-update' }
  | { type: 'open-extensions-menu'; anchor: AnchorRect }
  | { type: 'open-history' }
  | { type: 'toggle-translation' }
  | { type: 'open-app-menu' }
  | { type: 'open-settings' };

export const PageChannel = {
  newTabMarkColor: 'yalqen:new-tab-mark-color',
  tabTransition: 'yalqen:tab-transition',
  swipe: 'yalqen:page-swipe',
  pointerDown: 'yalqen:page-pointer-down',
  credentialSubmitted: 'yalqen:credential-submitted',
  credentialAccepted: 'yalqen:credential-accepted',
  generatePassword: 'yalqen:generate-password',
  savedLogins: 'yalqen:saved-logins',
  fillSavedLogin: 'yalqen:fill-saved-login',
  chooseSavedLogin: 'yalqen:choose-saved-login',
  autofillAvailable: 'yalqen:autofill-available',
  chooseAutofill: 'yalqen:choose-autofill',
  oneTimeCodeAvailable: 'yalqen:one-time-code-available',
  chooseOneTimeCode: 'yalqen:choose-one-time-code',
} as const;

export interface SubmittedCredential {
  username: string;
  password: string;
}

export const IpcChannel = {
  getState: 'yalqen:get-state',
  state: 'yalqen:state',
  setLayout: 'yalqen:set-layout',
  action: 'yalqen:action',
  agentDraft: 'yalqen:agent-draft',
  agentDraftUpdate: 'yalqen:agent-draft-update',
  agentSnapshot: 'yalqen:agent-snapshot',
  agentSelectDirectory: 'yalqen:agent-select-directory',
  agentStart: 'yalqen:agent-start',
  agentStop: 'yalqen:agent-stop',
  agentInput: 'yalqen:agent-input',
  agentResize: 'yalqen:agent-resize',
  agentOutput: 'yalqen:agent-output',
  agentChatSnapshot: 'yalqen:agent-chat-snapshot',
  agentChatSend: 'yalqen:agent-chat-send',
  visualComparisonGet: 'yalqen:visual-comparison-get',
  visualComparisonCapture: 'yalqen:visual-comparison-capture',
  visualComparisonClear: 'yalqen:visual-comparison-clear',
  visualComparisonReview: 'yalqen:visual-comparison-review',
  responsiveScanGet: 'yalqen:responsive-scan-get',
  responsiveScanRun: 'yalqen:responsive-scan-run',
  responsiveScanCancel: 'yalqen:responsive-scan-cancel',
  responsiveScanClear: 'yalqen:responsive-scan-clear',
  responsiveScanReview: 'yalqen:responsive-scan-review',
  agentChatFix: 'yalqen:agent-chat-fix',
  agentChatInterrupt: 'yalqen:agent-chat-interrupt',
  agentChatSignIn: 'yalqen:agent-chat-sign-in',
  agentChatSignOut: 'yalqen:agent-chat-sign-out',
  agentChatReset: 'yalqen:agent-chat-reset',
  agentChatNew: 'yalqen:agent-chat-new',
  agentChatShowBackground: 'yalqen:agent-chat-show-background',
  agentChatDismissBackground: 'yalqen:agent-chat-dismiss-background',
  pagePress: 'yalqen:page-press',
  addLiveFolder: 'yalqen:add-live-folder',
  agentChatOpenBackground: 'yalqen:agent-chat-open-background',
  agentChatContinueBackground: 'yalqen:agent-chat-continue-background',
  agentChatPermission: 'yalqen:agent-chat-permission',
  agentChatConfigure: 'yalqen:agent-chat-configure',
  agentChatRewind: 'yalqen:agent-chat-rewind',
  agentChatOpenFile: 'yalqen:agent-chat-open-file',
  agentChatHistory: 'yalqen:agent-chat-history',
  agentChatOpen: 'yalqen:agent-chat-open',
  agentChatDelete: 'yalqen:agent-chat-delete',
  agentChatFiles: 'yalqen:agent-chat-files',
  agentChatProvider: 'yalqen:agent-chat-provider',
  agentChatCancelQueued: 'yalqen:agent-chat-cancel-queued',
  agentChatUpdate: 'yalqen:agent-chat-update',
  agentProjectAdd: 'yalqen:agent-project-add',
  agentProjectSelect: 'yalqen:agent-project-select',
  agentProjectClose: 'yalqen:agent-project-close',
  agentElementRemove: 'yalqen:agent-element-remove',
  agentElementHighlight: 'yalqen:agent-element-highlight',
  projectRunStart: 'yalqen:project-run-start',
  projectRunStop: 'yalqen:project-run-stop',
} as const;

export interface YalqenApi extends VisualComparisonApi, ResponsiveScanApi {
  getState(): Promise<BrowserState>;
  onState(listener: (serializedState: string) => void): () => void;
  setLayout(layout: ChromeLayout): void;
  send(action: UiAction): void;
  getAgentDraft(projectId: string, id: string): Promise<import('./agent-panel').AgentChatComposer | null>;
  updateAgentDraft(projectId: string, id: string, patch: Partial<import('./agent-panel').AgentChatComposer>): void;
  getAgentTerminal(): Promise<AgentTerminalSnapshot | null>;
  selectAgentDirectory(): Promise<AgentSessionState | null>;
  startAgentSession(size: AgentTerminalSize): Promise<AgentSessionState | null>;
  stopAgentSession(sessionId: string): Promise<void>;
  writeAgentTerminal(sessionId: string, data: string): void;
  resizeAgentTerminal(sessionId: string, size: AgentTerminalSize): void;
  onAgentOutput(listener: (output: AgentTerminalOutput) => void): () => void;
  removeAgentElement(id: string): Promise<void>;
  highlightAgentElement(id: string): Promise<boolean>;
  startProjectRun(): Promise<boolean>;
  stopProjectRun(): Promise<void>;
  getAgentChat(): Promise<AgentChatSnapshot | null>;
  sendAgentChat(
    sessionId: string | null,
    text: string,
    tabIds: TabId | TabId[] | null,
    images?: AgentChatImage[],
  ): Promise<boolean>;
  fixAgentEpisode(tabId: TabId): Promise<boolean>;
  interruptAgentChat(sessionId: string): Promise<void>;
  signInAgent(): Promise<boolean>;
  newAgentChat(): Promise<void>;
  showBackgroundAgentChat(id: string): Promise<boolean>;
  dismissBackgroundAgentChat(id: string): Promise<boolean>;
  openBackgroundAgentChatInTab(id: string): Promise<boolean>;
  continueAgentChatInProject(id: string): Promise<boolean>;
  signOutAgent(): Promise<boolean>;
  resetAgentChat(sessionId: string | null): Promise<void>;
  respondAgentChat(
    sessionId: string,
    requestId: string,
    allow: boolean,
    answers?: Record<string, string>,
    always?: boolean,
  ): Promise<void>;
  configureAgentChat(sessionId: string | null, settings: AgentChatSettings): Promise<void>;
  rewindAgentChat(sessionId: string, messageId: string, dryRun: boolean): Promise<AgentRewindPreview | null>;
  openAgentFile(path: string): Promise<boolean>;
  listAgentChats(): Promise<AgentChatSession[]>;
  openAgentChat(sessionId: string, fork: boolean): Promise<boolean>;
  deleteAgentChat(sessionId: string): Promise<boolean>;
  searchAgentFiles(query: string): Promise<string[]>;
  selectAgentProvider(provider: AgentProviderId): Promise<boolean>;
  newAgentProject(): Promise<boolean>;
  selectAgentProject(id: string): Promise<boolean>;
  closeAgentProject(id: string): Promise<boolean>;
  cancelQueuedAgentChat(sessionId: string, messageId: string): Promise<void>;
  onAgentChat(listener: (serializedSnapshot: string) => void): () => void;
  onPagePress(listener: () => void): () => void;
  onAddLiveFolder(listener: (kind: import('./live-folders').LiveFolderKind | undefined) => void): () => void;
}
