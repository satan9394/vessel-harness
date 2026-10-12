/**
 * Vessel Local Web — strongly typed zh/en UI dictionary (tasks 045, 210).
 *
 * Zero-dependency zh/en dictionaries plus a `t(key)` translator. Default
 * language follows navigator.language (`zh*` → 'zh', otherwise 'en'); an
 * explicit user choice persists to localStorage under `vessel.ui.lang` and
 * overrides the detected default. Locale + storage are injectable so the logic
 * is unit-testable under node (which has neither `navigator` nor
 * `localStorage`); in the browser defaults read from the real globals.
 *
 * This module deliberately does NOT import i18next / react-i18next. The plain
 * dictionaries + `t()` below are enough for the core UI copy. All values are
 * strings; dynamic parts use `{var}` placeholders substituted by `t`.
 */

export type Lang = 'zh' | 'en';

/** localStorage key that persists the user's explicit language choice. */
export const LANG_STORAGE_KEY = 'vessel.ui.lang';

/** A string message; `{var}` placeholders are filled by `t` when params given. */
export type MessageTemplate = string;

/**
 * UI copy grouped by feature. Content (session text,
 * tool names, code) is intentionally left untranslated.
 */
// ponytail: Keep a flat key contract so existing consumers and translators stay small.
// Provider and common operation keys are reserved for the dependent V2.6 cards.
/** Common UI messages. */
export interface CommonMessages {
  cacheWriteLabel: MessageTemplate;
  uiUnclaimed: MessageTemplate;
  uiNone: MessageTemplate;
  uiNoWorkspaceChangesAgainstHEAD: MessageTemplate;
  messageCard: MessageTemplate;
  languageChinese: MessageTemplate;
  languageEnglish: MessageTemplate;
  confirm: MessageTemplate;
  save: MessageTemplate;
  delete: MessageTemplate;
  copy: MessageTemplate;
  loading: MessageTemplate;
  creating: MessageTemplate;
  resolvedChoice: MessageTemplate;
  estimatedUsage: MessageTemplate;
  agentCount: MessageTemplate;
  completedDuration: MessageTemplate;
  failedReason: MessageTemplate;
  turnCount: MessageTemplate;
  taskCount: MessageTemplate;
  artifactCount: MessageTemplate;
  pause: MessageTemplate;
  resume: MessageTemplate;
  budget: MessageTemplate;
  pauseHint: MessageTemplate;
  resumeHint: MessageTemplate;
  budgetHint: MessageTemplate;
  terminalTask: MessageTemplate;
  handoffCopied: MessageTemplate;
  folderOpened: MessageTemplate;
  reviewImported: MessageTemplate;
  clipboardUnavailable: MessageTemplate;
  noOwningWorkspace: MessageTemplate;
  taskDetails: MessageTemplate;
  cancelAgent: MessageTemplate;
  teamStage: MessageTemplate;
  heartbeatHistory: MessageTemplate;
  heartbeatSamples: MessageTemplate;
  localConnections: MessageTemplate;
  toolCalled: MessageTemplate;
  tokenUnit: MessageTemplate;
  usageTitle: MessageTemplate;
  cacheReadCount: MessageTemplate;
  cacheWriteCount: MessageTemplate;
  cacheBreakdown: MessageTemplate;
  cachePriceEstimate: MessageTemplate;
  interrupted: MessageTemplate;
  privilegeWindows: MessageTemplate;
  privilegeBwrap: MessageTemplate;
  privilegeLow: MessageTemplate;
  privilegeMac: MessageTemplate;
  privilegeNone: MessageTemplate;
  byteCount: MessageTemplate;
  noTool: MessageTemplate;
  moduleContext: MessageTemplate;
  moduleLogs: MessageTemplate;
  moduleMcp: MessageTemplate;
  modulePolicy: MessageTemplate;
  turnTool: MessageTemplate;
  turnFinal: MessageTemplate;
  turnContinue: MessageTemplate;
  legacyGenerator: MessageTemplate;
  legacyEvaluator: MessageTemplate;
  legacyOrchestrator: MessageTemplate;
  cancel: MessageTemplate;
  uiBilledCacheHitRate: MessageTemplate;
  uiCached: MessageTemplate;
  uiPromptTokens: MessageTemplate;
  uiCreated: MessageTemplate;
  uiEstimatedSavings: MessageTemplate;
  uiObservedBilledCacheHitRateHistory: MessageTemplate;
  uiLast: MessageTemplate;
  uiObservedModelCallsInThisSession: MessageTemplate;
  uiTrackedFiles: MessageTemplate;
  uiUncommittedDiffBytes: MessageTemplate;
  uiStable: MessageTemplate;
  uiScoped: MessageTemplate;
  uiVolatile: MessageTemplate;
  uiBytes: MessageTemplate;
  uiPrefixSHA256: MessageTemplate;
  uiNoCacheUsageObservedInThisSession: MessageTemplate;
  uiNoWorkspaceFingerprintObserved: MessageTemplate;
  uiNoPromptPrefixSegmentsObserved: MessageTemplate;
  uiObservedImpactReportsForThisSession: MessageTemplate;
  uiNoASTImpactReportsObserved: MessageTemplate;
  uiReviewTextChangesOneHunkAtATime: MessageTemplate;
  uiNoPatchProposalsObservedInThisSession: MessageTemplate;
  uiCtrlCmdKCommandsJKOrMessages: MessageTemplate;
  close: MessageTemplate;
  uiTeam: MessageTemplate;
  uiGoals: MessageTemplate;
  uiChangedFiles: MessageTemplate;
  uiCost: MessageTemplate;
  uiToolActivity: MessageTemplate;
  uiTaskQueue: MessageTemplate;
  uiTerminalTasksCanTBeRunRequeueThem: MessageTemplate;
  uiNoTasksYet: MessageTemplate;
  uiEnqueueAGoalAndRunItEachIteration: MessageTemplate;
  uiIterations: MessageTemplate;
  uiNoIterationsYet: MessageTemplate;
  uiRunThisTaskToProduceTheFirstIteration: MessageTemplate;
  uiAcceptance: MessageTemplate;
  uiAfterRetries: MessageTemplate;
  uiGenerator: MessageTemplate;
  uiGeneratorOutputSummary: MessageTemplate;
  uiNoGeneratorSnapshot: MessageTemplate;
  uiEvaluator: MessageTemplate;
  uiNoEvaluatorSnapshot: MessageTemplate;
  uiGoalEnqueueIntoThisProjectSTaskQueue: MessageTemplate;
  uiRunControlPauseSuspendsResumeContinuesBudgetSets: MessageTemplate;
  uiNoMatchingReflectiveRules: MessageTemplate;
  uiReflectiveRules: MessageTemplate;
  uiTrigger: MessageTemplate;
  uiLesson: MessageTemplate;
  uiRecommendedAction: MessageTemplate;
  uiHits: MessageTemplate;
  uiUpdated: MessageTemplate;
  uiConfidence: MessageTemplate;
  uiCategory: MessageTemplate;
  uiAllCategories: MessageTemplate;
  uiPolicyDenial: MessageTemplate;
  uiToolFailure: MessageTemplate;
  uiArchitectureConstraint: MessageTemplate;
  uiSearchRules: MessageTemplate;
  uiTriggerLessonOrAction: MessageTemplate;
  uiCognitiveRules: MessageTemplate;
  uiLoadingReflectiveRules: MessageTemplate;
  uiCognitiveMemoryIsUnavailable: MessageTemplate;
  uiPermissionAction: MessageTemplate;
  uiPermission: MessageTemplate;
  uiSendingResponse: MessageTemplate;
  uiExpired: MessageTemplate;
  uiResponseUnavailable: MessageTemplate;
  uiAwaitingYourDecision: MessageTemplate;
  uiImpact: MessageTemplate;
  uiFiles: MessageTemplate;
  uiCallers: MessageTemplate;
  uiModifiedFiles: MessageTemplate;
  uiAffectedCallers: MessageTemplate;
  uiNoAffectedCallersReported: MessageTemplate;
  uiSubagents: MessageTemplate;
  uiNoActiveSubagents: MessageTemplate;
  cancelLabel: MessageTemplate;
  uiID: MessageTemplate;
  uiProvider: MessageTemplate;
  uiStatus: MessageTemplate;
  uiWorktree: MessageTemplate;
  uiStarted: MessageTemplate;
  uiEnded: MessageTemplate;
  uiDuration: MessageTemplate;
  uiExitCode: MessageTemplate;
  uiTokenUsage: MessageTemplate;
  uiSubagentTokenUsage: MessageTemplate;
  uiExecutionStages: MessageTemplate;
  uiLocal: MessageTemplate;
  uiEndpoint: MessageTemplate;
  uiRoles: MessageTemplate;
  uiHeartbeatRTT: MessageTemplate;
  uiRemoteTaskActivity: MessageTemplate;
  uiMeshIsNotConfigured: MessageTemplate;
  uiSwarmPeerConnections: MessageTemplate;
  uiNoConnectedPeers: MessageTemplate;
  uiMeshNodes: MessageTemplate;
  uiSwarmTopology: MessageTemplate;
  uiDAGID: MessageTemplate;
  uiInspectObservedRemoteTasks: MessageTemplate;
  uiInspectDAG: MessageTemplate;
  uiLoadingMeshNodes: MessageTemplate;
  uiHeartbeatStateRefreshesEvery: MessageTemplate;
  uiSeconds: MessageTemplate;
  uiActive: MessageTemplate;
  uiPeersObserved: MessageTemplate;
  uiOf: MessageTemplate;
  uiObserved: MessageTemplate;
  uiTalkingSandboxAudits: MessageTemplate;
  uiUnableToLoadExecutionAudits: MessageTemplate;
  uiLoadingExecutionAudits: MessageTemplate;
  uiNoSandboxExecutionAuditsRecorded: MessageTemplate;
  uiExecutionOutcome: MessageTemplate;
  uiIsolationTier: MessageTemplate;
  uiReadOnlyPathWhitelist: MessageTemplate;
  uiWritePathWhitelist: MessageTemplate;
  uiMemoryLimit: MessageTemplate;
  uiPrivilegeReduction: MessageTemplate;
  uiReason: MessageTemplate;
  uiSandboxSecurityConstraints: MessageTemplate;
  uiCloseSandboxDetails: MessageTemplate;
  uiSandbox: MessageTemplate;
  uiTurnMetrics: MessageTemplate;
  uiCache: MessageTemplate;
  uiReadSavings: MessageTemplate;
  uiStagedTeamPlans: MessageTemplate;
  uiTeamPlanTask: MessageTemplate;
  uiPreviewATeamPlan: MessageTemplate;
  uiStagePlan: MessageTemplate;
  uiTeamTaskAutoResolvesTheRosterSmallDev: MessageTemplate;
  uiTeamActivityStreamsLiveFromTheSessionSSE: MessageTemplate;
  uiNoTeamRunYet: MessageTemplate;
  uiRunATaskWithThisSessionAndThe: MessageTemplate;
  uiLive: MessageTemplate;
  uiQueued: MessageTemplate;
  uiOutputPreview: MessageTemplate;
  uiOutput: MessageTemplate;
  uiDelegate: MessageTemplate;
  uiCloseTaskDetails: MessageTemplate;
  uiViewDiff: MessageTemplate;
  uiArtifactDiff: MessageTemplate;
  uiEditStagedTeamPlan: MessageTemplate;
  uiMemberRoutes: MessageTemplate;
  uiRole: MessageTemplate;
  uiLead: MessageTemplate;
  uiReasoning: MessageTemplate;
  uiDefault: MessageTemplate;
  uiLow: MessageTemplate;
  uiMedium: MessageTemplate;
  uiHigh: MessageTemplate;
  uiTemperature: MessageTemplate;
  uiTaskParameters: MessageTemplate;
  uiTitle: MessageTemplate;
  uiAssignedRole: MessageTemplate;
  uiDescription: MessageTemplate;
  uiDependenciesCommaSeparated: MessageTemplate;
  uiSaveRevisedPreview: MessageTemplate;
  uiEditPlanBeforeApproval: MessageTemplate;
  uiTeamPlanAwaitingApproval: MessageTemplate;
  uiReviewTeamPlan: MessageTemplate;
  uiApproveAmpRun: MessageTemplate;
  uiReject: MessageTemplate;
  uiTeamTaskDependencies: MessageTemplate;
  uiDetails: MessageTemplate;
  uiCollapsed: MessageTemplate;
  uiCardSpaceToExpand: MessageTemplate;
  uiExternalReviewRequired: MessageTemplate;
  uiCopyHandoff: MessageTemplate;
  uiCopyTheHandoffMdArtifactForTheExternal: MessageTemplate;
  uiOpenFolder: MessageTemplate;
  uiOpenVesselReviewsIdInTheOSFile: MessageTemplate;
  uiImportResult: MessageTemplate;
  uiReview: MessageTemplate;
  uiStatusLabel: MessageTemplate;
  uiSHA256: MessageTemplate;
  uiVerificationGate: MessageTemplate;
  uiVerificationDetails: MessageTemplate;
  uiPhase: MessageTemplate;
  uiCalls: MessageTemplate;
  uiChooseAnOptionToRetry: MessageTemplate;
  uiExecutor: MessageTemplate;
  uiExit: MessageTemplate;
  uiLastLabel: MessageTemplate;
  uiSuggest: MessageTemplate;
  uiUnmet: MessageTemplate;
  uiDependencies: MessageTemplate;
  uiAdding: MessageTemplate;
  uiEnqueue: MessageTemplate;
  uiRunTask: MessageTemplate;
  uiRunTeam: MessageTemplate;
  uiRunning: MessageTemplate;
  uiFingerprintChangedSinceThePreviousObservation: MessageTemplate;
  uiObservedWorkspaceFingerprint: MessageTemplate;
  uiLocalNode: MessageTemplate;
  uiNoDAGSnapshotObservedSelectADAGTo: MessageTemplate;
  uiNoRolesAdvertised: MessageTemplate;
  uiUnavailable: MessageTemplate;
  uiNotRecordedByTheExecutionAudit: MessageTemplate;
  uiNoExplicitReadOnlyRootsHostPermissionsApply: MessageTemplate;
  uiNoNativeMemoryCapConfigured: MessageTemplate;
  uiNoWritePathsAllowed: MessageTemplate;
  uiNotEnforcedForThisExecution: MessageTemplate;
  uiRedVerified: MessageTemplate;
  uiGreenVerified: MessageTemplate;
  uiRejected: MessageTemplate;
  uiRTTUnavailable: MessageTemplate;
  retry: MessageTemplate;
  uiRefresh: MessageTemplate;
  uiYou: MessageTemplate;
  uiEstimated: MessageTemplate;
  projects: MessageTemplate;
  settings: MessageTemplate;
  language: MessageTemplate;
  send: MessageTemplate;
  stop: MessageTemplate;
  running: MessageTemplate;
  metricPrompt: MessageTemplate;
  metricCompletion: MessageTemplate;
  metricThinking: MessageTemplate;
  metricCacheRead: MessageTemplate;
  metricLatency: MessageTemplate;
  metricCost: MessageTemplate;
  inputPlaceholder: MessageTemplate;
  serverDown: MessageTemplate;
  statusOk: MessageTemplate;
  statusDown: MessageTemplate;
  placeholderDev: MessageTemplate;
  unimplemented: MessageTemplate;
  tasksPlaceholder: MessageTemplate;
  changedFilesPlaceholder: MessageTemplate;
  customize: MessageTemplate;
  customizeHead: MessageTemplate;
  interruptTitle: MessageTemplate;
  teamModuleNoSession: MessageTemplate;
  goalModuleNoSession: MessageTemplate;
}

/** Session UI messages. */
export interface SessionMessages {
  create: MessageTemplate;
  permissionDangerFull: MessageTemplate;
  newSessionTitle: MessageTemplate;
  permissionLabel: MessageTemplate;
  permissionReadOnly: MessageTemplate;
  permissionWorkspaceWrite: MessageTemplate;
  workspacePath: MessageTemplate;
  workspacePlaceholder: MessageTemplate;
  conversationEmpty: MessageTemplate;
  uiSessionInspector: MessageTemplate;
  uiSession: MessageTemplate;
  newSession: MessageTemplate;
  recentSessions: MessageTemplate;
  topicSearch: MessageTemplate;
  topicToday: MessageTemplate;
  topicLastSevenDays: MessageTemplate;
  topicEarlier: MessageTemplate;
  topicUntitled: MessageTemplate;
  topicShowArchived: MessageTemplate;
  topicRename: MessageTemplate;
  topicArchive: MessageTemplate;
  topicRestore: MessageTemplate;
  topicSave: MessageTemplate;
  topicCancel: MessageTemplate;
  emptyTitle: MessageTemplate;
  emptyBody: MessageTemplate;
  noProjects: MessageTemplate;
  noSessions: MessageTemplate;
}

/** Model UI messages. */
export interface ModelMessages {
  providerPreset: MessageTemplate;
  providerCustom: MessageTemplate;
  providerName: MessageTemplate;
  providerProtocol: MessageTemplate;
  providerOpenai: MessageTemplate;
  providerAnthropic: MessageTemplate;
  providerBaseUrl: MessageTemplate;
  providerApiKey: MessageTemplate;
  providerModels: MessageTemplate;
  providerAdd: MessageTemplate;
  providerEmpty: MessageTemplate;
  providerKeyHint: MessageTemplate;
  providerTest: MessageTemplate;
  providerTesting: MessageTemplate;
  providerConnected: MessageTemplate;
  providerFailed: MessageTemplate;
  providerTimeout: MessageTemplate;
  providerHttp: MessageTemplate;
  providerBadResponse: MessageTemplate;
  providerOperationFailed: MessageTemplate;
  providerInvalidName: MessageTemplate;
  providerDuplicate: MessageTemplate;
  providerInvalidUrl: MessageTemplate;
  providerKeyRequired: MessageTemplate;
  providerModelsRequired: MessageTemplate;
  providerDeleteConfirm: MessageTemplate;
  providerRefreshFailed: MessageTemplate;
  providerSaved: MessageTemplate;
  providerDeleted: MessageTemplate;
  providerNoKey: MessageTemplate;
  providerPullModels: MessageTemplate;
  providerPulling: MessageTemplate;
  providerPulled: MessageTemplate;
  providerPullEmpty: MessageTemplate;
  providerErrInvalidProtocol: MessageTemplate;
  providerErrNotFound: MessageTemplate;
  providerErrBuiltin: MessageTemplate;
  providerErrSecureStore: MessageTemplate;
  providerErrStoreCorrupted: MessageTemplate;

  modelSettings: MessageTemplate;
  selectModel: MessageTemplate;
  modelLoadFailed: MessageTemplate;
  modelSwitchFailed: MessageTemplate;
  modelSwitchBusy: MessageTemplate;
  modelOffline: MessageTemplate;
  configureModels: MessageTemplate;
  sessionCreateFailed: MessageTemplate;
  currentModel: MessageTemplate;
  noModelsConfigured: MessageTemplate;
  modelAuto: MessageTemplate;
  modelFast: MessageTemplate;
  modelPro: MessageTemplate;
  uiModelMode: MessageTemplate;
  uiResolvedActualModel: MessageTemplate;
  uiResolveTheActualModelForThisMode: MessageTemplate;
  uiResolve: MessageTemplate;
  uiPinnedUnpin: MessageTemplate;
  uiPinForThisSession: MessageTemplate;
  uiUnpinTheNextAutoResolutionReJudges: MessageTemplate;
  uiPinThisResolutionForTheSessionNoAutomatic: MessageTemplate;
  uiModel: MessageTemplate;
}

/** Canvas UI messages. */
export interface CanvasMessages {
  tabSwarm: MessageTemplate;
  tabRules: MessageTemplate;
  tabCache: MessageTemplate;
  tabImpact: MessageTemplate;
  tabPatch: MessageTemplate;
  tabDiff: MessageTemplate;
  tabTree: MessageTemplate;
  reportedCallers: MessageTemplate;
  observedCallers: MessageTemplate;
  uiKVCacheEconomics: MessageTemplate;
  uiWorkspaceFingerprint: MessageTemplate;
  uiPromptPrefixSegments: MessageTemplate;
  uiASTSymbolDependencies: MessageTemplate;
  uiASTImpactRadar: MessageTemplate;
  uiToggleInspectorCtrlCmdI: MessageTemplate;
  inspectorTitle: MessageTemplate;
  uiCloseInspector: MessageTemplate;
  uiInspectorPanels: MessageTemplate;
  uiOpenInspector: MessageTemplate;
  uiCollapseInspector: MessageTemplate;
}

/** Patch UI messages. */
export interface PatchMessages {
  expandLines: MessageTemplate;
  patchFailed: MessageTemplate;
  uiPatchWorkbench: MessageTemplate;
  uiInteractivePatchPicker: MessageTemplate;
  viewUnified: MessageTemplate;
  viewSplit: MessageTemplate;
  acceptHunk: MessageTemplate;
  discardHunk: MessageTemplate;
  revertHunk: MessageTemplate;
  reapplyHunk: MessageTemplate;
  uiSideBySidePatch: MessageTemplate;
  uiUnifiedPatch: MessageTemplate;
  uiDiffInspector: MessageTemplate;
  uiCollapseDiff: MessageTemplate;
  uiUnifiedDiff: MessageTemplate;
  uiOldLineNewLinePatch: MessageTemplate;
}

/** Reasoning UI messages. */
export interface ReasoningMessages {
  reasoningRate: MessageTemplate;
  outputRate: MessageTemplate;
  tokenRateUnavailable: MessageTemplate;
  timeSeconds: MessageTemplate;
  timeMilliseconds: MessageTemplate;
  cognitiveRulesHit: MessageTemplate;
  uiRule: MessageTemplate;
  uiReflection: MessageTemplate;
  uiHistoricalGuidanceCurrentPolicyTakesPrecedence: MessageTemplate;
  uiRulesReadOnlyLatest1000Rules: MessageTemplate;
  thinking: MessageTemplate;
  thinkingFor: MessageTemplate;
}

/** Palette UI messages. */
export interface PaletteMessages {
  palettePlaceholder: MessageTemplate;
  paletteCategorySession: MessageTemplate;
  paletteCategoryAction: MessageTemplate;
  paletteCategoryView: MessageTemplate;
  paletteCategoryNavigation: MessageTemplate;
  paletteClearScreen: MessageTemplate;
  paletteExportJson: MessageTemplate;
  paletteCollapse: MessageTemplate;
  paletteExpand: MessageTemplate;
  paletteSandbox: MessageTemplate;
  paletteSession: MessageTemplate;
  paletteInspector: MessageTemplate;
  uiCommands: MessageTemplate;
  uiCommandsCtrlCmdK: MessageTemplate;
  uiKeyboardShortcuts: MessageTemplate;
  uiSearchCommandsAndSessions: MessageTemplate;
  uiMatchingCommands: MessageTemplate;
  uiNoMatchingCommands: MessageTemplate;
}

/** Attention UI messages. */
export interface AttentionMessages {
  notificationEnabled: MessageTemplate;
  notificationDenied: MessageTemplate;
  notificationUnsupported: MessageTemplate;
  attentionTitle: MessageTemplate;
  soundMute: MessageTemplate;
  soundUnmute: MessageTemplate;
  enableNotification: MessageTemplate;
  uiDesktopNotificationsForBackgroundOrUnfocusedTasksCompletion: MessageTemplate;
}

/** Status UI messages. */
export interface StatusMessages {
  rolePlanner: MessageTemplate;
  roleWorker: MessageTemplate;
  stateBusy: MessageTemplate;
  stateApproved: MessageTemplate;
  stateStaged: MessageTemplate;
  stateScheduled: MessageTemplate;
  kindMessage: MessageTemplate;
  kindWidget: MessageTemplate;
  kindThinking: MessageTemplate;
  actionFilesystemWrite: MessageTemplate;
  actionNetworkAccess: MessageTemplate;
  actionExternalProcess: MessageTemplate;
  actionApproval: MessageTemplate;
  roleDeveloper: MessageTemplate;
  roleReviewer: MessageTemplate;
  phaseOrchestrate: MessageTemplate;
  phaseGenerate: MessageTemplate;
  phaseEvaluate: MessageTemplate;
  statePending: MessageTemplate;
  stateAccepted: MessageTemplate;
  stateRejected: MessageTemplate;
  stateRunning: MessageTemplate;
  stateDone: MessageTemplate;
  stateFailed: MessageTemplate;
  stateError: MessageTemplate;
  stateStarted: MessageTemplate;
  stateDenied: MessageTemplate;
  stateImported: MessageTemplate;
  statePaused: MessageTemplate;
  stateProgress: MessageTemplate;
  stateMet: MessageTemplate;
  stateNotMet: MessageTemplate;
  stateImpossible: MessageTemplate;
  stateCancelled: MessageTemplate;
  stateCompleted: MessageTemplate;
  stateStopped: MessageTemplate;
  stateIdle: MessageTemplate;
  stateQueued: MessageTemplate;
  stateOnline: MessageTemplate;
  stateOffline: MessageTemplate;
  stateEnforced: MessageTemplate;
  stateUnavailable: MessageTemplate;
  stateExpired: MessageTemplate;
  stateClaimed: MessageTemplate;
  sourceExternal: MessageTemplate;
  sourceInternal: MessageTemplate;
  tierRestricted: MessageTemplate;
  tierBwrap: MessageTemplate;
  tierLow: MessageTemplate;
  tierMac: MessageTemplate;
  tierNone: MessageTemplate;
  stateFallback: MessageTemplate;
  tierSmall: MessageTemplate;
  tierStandard: MessageTemplate;
  tierAdvanced: MessageTemplate;
  gateRed: MessageTemplate;
  gateGreen: MessageTemplate;
  legacyStatusPass: MessageTemplate;
  legacyStatusFail: MessageTemplate;
}

export interface Messages extends CommonMessages, SessionMessages, ModelMessages, CanvasMessages,
  PatchMessages, ReasoningMessages, PaletteMessages, AttentionMessages, StatusMessages {}

export const zh: Messages = {
  providerPreset: "快捷模板",
  providerCustom: "自定义兼容端点",
  providerName: "供应商名称",
  providerProtocol: "接口协议",
  providerOpenai: "OpenAI 兼容 (OpenAI Compatible)",
  providerAnthropic: "Anthropic (Claude)",
  providerBaseUrl: "接口地址",
  providerApiKey: "API Key",
  providerModels: "可用模型（用逗号分隔）",
  providerAdd: "添加供应商",
  providerEmpty: "尚未配置供应商。选择模板并填写接口信息。",
  providerKeyHint: "密钥安全保存在本机；本地兼容端点可留空。",
  providerTest: "测试连接",
  providerTesting: "正在测试连接…",
  providerConnected: "连接成功 · {ms} 毫秒",
  providerFailed: "无法连接该端点，请检查地址和密钥。",
  providerTimeout: "连接超时，请检查网络后重试。",
  providerHttp: "连接失败 · HTTP {status}",
  providerBadResponse: "端点返回的模型列表格式无效。",
  providerOperationFailed: "操作失败，请检查本地服务后重试。",
  providerInvalidName: "名称只可包含字母、数字、下划线、点和短横线，且不能为 mock。",
  providerDuplicate: "该名称已存在，请使用其他名称。",
  providerInvalidUrl: "请输入有效的 HTTP 或 HTTPS 地址，不含凭据、查询参数或片段。",
  providerKeyRequired: "此端点需要 API Key。",
  providerModelsRequired: "请至少填写一个有效模型名称。",
  providerDeleteConfirm: "确认删除 {name}？",
  providerSaved: "供应商已保存。",
  providerDeleted: "供应商已删除。",
  providerNoKey: "无需密钥",
  providerPullModels: "拉取模型",
  providerPulling: "正在拉取模型…",
  providerPulled: "已拉取 {count} 个模型。",
  providerPullEmpty: "端点未返回任何模型，请检查接口地址与密钥。",
  providerErrInvalidProtocol: "接口协议无效，仅支持 OpenAI 兼容与 Anthropic。",
  providerErrNotFound: "该供应商不存在或已被删除。",
  providerErrBuiltin: "内置 mock 供应商不可删除。",
  providerErrSecureStore: "本机安全凭据存储不可用，无法保存密钥。",
  providerErrStoreCorrupted: "供应商配置文件损坏或含非法条目，请检查 ~/.vessel 或从备份恢复。",

  rolePlanner: "规划者",
  roleWorker: "执行者",
  stateBusy: "忙碌",
  stateApproved: "已批准",
  stateStaged: "待审批",
  stateScheduled: "已安排",
  cacheWriteLabel: "缓存写入",
  uiUnclaimed: "待认领",
  uiNone: "无",
  uiNoWorkspaceChangesAgainstHEAD: "工作区相对当前提交没有变更。",
  messageCard: "{kind}卡片",
  kindMessage: "消息",
  kindWidget: "交互组件",
  kindThinking: "思考推演",
  actionFilesystemWrite: "文件写入",
  actionNetworkAccess: "网络访问",
  actionExternalProcess: "外部进程",
  actionApproval: "人工审批",
  languageChinese: "中文",
  languageEnglish: "英语",
  confirm: "确认",
  save: "保存",
  delete: "删除",
  copy: "复制",
  loading: "正在加载…",
  create: "创建",
  creating: "正在创建…",
  permissionDangerFull: "完全访问权限",
  modelSettings: "模型设置",
  providerRefreshFailed: "配置已更新，但列表刷新失败。请重试。",
  selectModel: "选择模型",
  modelLoadFailed: "无法加载模型，请重试",
  modelSwitchFailed: "模型切换失败，当前模型保持不变",
  modelSwitchBusy: "会话正在执行，请结束当前任务后再切换",
  modelOffline: "离线演示",
  configureModels: "配置新模型",
  sessionCreateFailed: "无法创建会话，请检查工作目录和模型配置",
  currentModel: "当前模型",
  noModelsConfigured: "尚未配置模型",
  tabSwarm: "代理网络",
  tabRules: "认知规则",
  tabCache: "模型缓存",
  tabImpact: "影响范围",
  tabPatch: "代码补丁",
  tabDiff: "代码差异",
  tabTree: "文件树",
  expandLines: "展开 {count} 行",
  reasoningRate: "{rate} 推理词元／秒（供应商报告）",
  outputRate: "{rate} 输出词元／秒（模型调用均值）",
  tokenRateUnavailable: "词元速率不可用",
  timeSeconds: "{value} 秒",
  timeMilliseconds: "{value} 毫秒",
  notificationEnabled: "桌面通知已开启",
  notificationDenied: "桌面通知已拒绝",
  notificationUnsupported: "此浏览器不支持桌面通知",
  patchFailed: "补丁操作失败",
  resolvedChoice: "已处理 · {choice}",
  reportedCallers: "已报告 {count} 个 {symbol} 的调用者",
  observedCallers: "{symbol} 的已记录调用者",
  estimatedUsage: " · 用量为估算值",
  palettePlaceholder: "输入命令或搜索历史会话…",
  paletteCategorySession: "会话",
  paletteCategoryAction: "操作",
  paletteCategoryView: "视图",
  paletteCategoryNavigation: "导航",
  paletteClearScreen: "清空屏幕（仅清除本地显示）",
  paletteExportJson: "导出当前可见对话为 JSON",
  paletteCollapse: "收起对话卡片",
  paletteExpand: "展开对话卡片",
  paletteSandbox: "新建会话权限：{permission}",
  paletteSession: "会话：{title} — {root}",
  paletteInspector: "画布检视器：{tab}",
  agentCount: "{count} 个代理",
  completedDuration: "{count} 秒内完成",
  failedReason: "失败 — {reason}",
  turnCount: "{count} 个回合",
  taskCount: "{count} 个任务",
  artifactCount: "{count} 个产物已落盘",
  pause: "暂停",
  resume: "恢复",
  budget: "预算",
  pauseHint: "挂起正在运行的任务",
  resumeHint: "从暂停的位置继续任务",
  budgetHint: "设置最大迭代数与重试数，默认均为 1",
  terminalTask: "已结束的任务无法直接运行",
  handoffCopied: "交接材料已复制到剪贴板",
  folderOpened: "文件夹已打开",
  reviewImported: "评审结果已导入",
  clipboardUnavailable: "剪贴板不可用",
  noOwningWorkspace: "本会话没有所属项目工作区",
  taskDetails: "任务详情：{title}",
  cancelAgent: "取消 {name}",
  teamStage: "团队计划 {id}",
  heartbeatHistory: "{node} 最近的心跳往返延迟",
  heartbeatSamples: "最近 {count} 次成功记录：{samples} 毫秒",
  localConnections: "本机节点连接了 {count} 个节点",
  toolCalled: "调用工具 {name}",
  tokenUnit: "词元",
  usageTitle: "累计模型用量（调用次数、词元与估算费用）{hint}",
  cacheReadCount: "读取 {count}",
  cacheWriteCount: "写入 {count}",
  cacheBreakdown: "（缓存：{parts}）",
  cachePriceEstimate: "；缺少缓存写入价格时，按输入价格的 1.25 倍估算",
  interrupted: "[已中断]",
  privilegeWindows: "受限令牌、低完整性级别与作业对象隔离。",
  privilegeBwrap: "命名空间隔离。",
  privilegeLow: "低完整性令牌，未报告完整原生隔离。",
  privilegeMac: "系统沙箱配置隔离。",
  privilegeNone: "未报告原生权限降低。",
  byteCount: "{count} 字节",
  noTool: "（工具）",
  moduleContext: "上下文",
  moduleLogs: "日志",
  moduleMcp: "工具协议",
  modulePolicy: "策略",
  modelAuto: "自动",
  modelFast: "快速",
  modelPro: "专业",
  roleDeveloper: "开发者",
  roleReviewer: "评审者",
  phaseOrchestrate: "统筹",
  phaseGenerate: "生成",
  phaseEvaluate: "评审",
  statePending: "待处理",
  stateAccepted: "已采纳",
  stateRejected: "已放弃",
  stateRunning: "运行中",
  stateDone: "已完成",
  stateFailed: "失败",
  stateError: "错误",
  stateStarted: "已开始",
  stateDenied: "已拒绝",
  stateImported: "已导入",
  statePaused: "已暂停",
  stateProgress: "执行中",
  stateMet: "已达成",
  stateNotMet: "未达成",
  stateImpossible: "无法达成",
  stateCancelled: "已取消",
  stateCompleted: "已完成",
  stateStopped: "已停止",
  stateIdle: "空闲",
  stateQueued: "排队中",
  stateOnline: "在线",
  stateOffline: "离线",
  stateEnforced: "已强制应用",
  stateUnavailable: "不可用",
  stateExpired: "已过期",
  stateClaimed: "已认领",
  sourceExternal: "外部评审",
  sourceInternal: "内部评审",
  tierRestricted: "受限作业隔离",
  tierBwrap: "命名空间隔离",
  tierLow: "低完整性隔离",
  tierMac: "系统沙箱隔离",
  tierNone: "无原生隔离",
  stateFallback: "回退执行",
  tierSmall: "精简",
  tierStandard: "标准",
  tierAdvanced: "高级",
  turnTool: "工具调用",
  turnFinal: "最终回复",
  turnContinue: "继续执行",
  gateRed: "失败验证已确认",
  gateGreen: "通过验证已确认",
  legacyStatusPass: "通过",
  legacyStatusFail: "失败",
  legacyGenerator: "生成者",
  legacyEvaluator: "评估者",
  legacyOrchestrator: "统筹者",
  newSessionTitle: "新建会话",
  permissionLabel: "新会话权限（不影响当前会话）",
  permissionReadOnly: "只读探索权限",
  permissionWorkspaceWrite: "工作区读写权限",
  workspacePath: "工作区路径",
  workspacePlaceholder: "输入项目的绝对路径",
  cancel: "取消",
  conversationEmpty: "发送一条消息开始对话，实时响应将在这里显示。",
  uiKVCacheEconomics: "缓存效益",
  uiBilledCacheHitRate: "计费缓存命中率",
  uiCached: "缓存词元／",
  uiPromptTokens: "输入词元 ·",
  uiCreated: "新建缓存词元",
  uiEstimatedSavings: "预计节省费用 $ ",
  uiObservedBilledCacheHitRateHistory: "计费缓存命中率历史",
  uiLast: "最近",
  uiObservedModelCallsInThisSession: "次会话内模型调用。",
  uiWorkspaceFingerprint: "工作区指纹",
  uiTrackedFiles: "个受跟踪文件 ·",
  uiUncommittedDiffBytes: "字节未提交差异",
  uiPromptPrefixSegments: "提示词前缀分段",
  uiStable: "稳定段 ·",
  uiScoped: "作用域段 ·",
  uiVolatile: "易变段 ·",
  uiBytes: "字节",
  uiPrefixSHA256: "前缀校验值",
  uiNoCacheUsageObservedInThisSession: "本会话暂无缓存用量记录。",
  uiNoWorkspaceFingerprintObserved: "暂无工作区指纹记录。",
  uiNoPromptPrefixSegmentsObserved: "暂无提示词前缀分段记录。",
  uiASTSymbolDependencies: "语法符号依赖",
  uiASTImpactRadar: "代码影响范围",
  uiObservedImpactReportsForThisSession: "本会话的代码影响报告。",
  uiNoASTImpactReportsObserved: "暂无代码影响报告。",
  uiPatchWorkbench: "代码补丁审阅",
  uiReviewTextChangesOneHunkAtATime: "逐块审阅代码修改。回退可安全撤回已采纳的代码块，重新应用可恢复该块。",
  uiNoPatchProposalsObservedInThisSession: "本会话暂无补丁提案。",
  uiToggleInspectorCtrlCmdI: "切换画布检视器（Ctrl/Cmd+I）",
  uiSessionInspector: "会话检视器",
  inspectorTitle: "画布检视器",
  uiCloseInspector: "关闭检视器",
  uiInspectorPanels: "检视器面板",
  uiInteractivePatchPicker: "交互式补丁审阅",
  viewUnified: "统一视图",
  viewSplit: "并排视图",
  acceptHunk: "采纳此块",
  discardHunk: "放弃修改",
  revertHunk: "回退此块",
  reapplyHunk: "重新应用此块",
  uiSideBySidePatch: "并排补丁",
  uiUnifiedPatch: "统一补丁",
  uiDiffInspector: "差异检视器",
  uiCollapseDiff: "收起差异",
  uiUnifiedDiff: "统一差异",
  uiOldLineNewLinePatch: "原行号、新行号与补丁",
  cognitiveRulesHit: "命中的认知规则",
  uiRule: "规则",
  uiReflection: "反思建议：",
  uiHistoricalGuidanceCurrentPolicyTakesPrecedence: "历史经验仅供参考，以当前策略为准。",
  uiCommands: "命令",
  uiCommandsCtrlCmdK: "命令（Ctrl/Cmd+K）",
  uiKeyboardShortcuts: "键盘快捷键",
  uiSearchCommandsAndSessions: "搜索命令与会话",
  uiCtrlCmdKCommandsJKOrMessages: "Ctrl/Cmd+K：打开命令面板 · J/K 或 ↑/↓：选择消息 · Esc：退出消息焦点 · 空格：折叠卡片 · 回车：选择审批选项 · ?：快捷键帮助",
  uiMatchingCommands: "匹配的命令",
  uiNoMatchingCommands: "没有匹配的命令。",
  close: "关闭",
  attentionTitle: "提醒设置",
  soundMute: "关闭提示音",
  soundUnmute: "开启提示音",
  enableNotification: "开启桌面通知",
  uiDesktopNotificationsForBackgroundOrUnfocusedTasksCompletion: "后台或未聚焦任务可发送桌面通知。运行超过五秒才触发完成提醒。",
  uiModelMode: "模型模式",
  uiResolvedActualModel: "实际使用的模型",
  uiResolveTheActualModelForThisMode: "确定当前模式使用的模型",
  uiResolve: "确定模型",
  uiPinnedUnpin: "已固定 · 取消固定",
  uiPinForThisSession: "为本会话固定模型",
  uiUnpinTheNextAutoResolutionReJudges: "取消固定，下次自动选择时将重新判断",
  uiPinThisResolutionForTheSessionNoAutomatic: "为本会话固定当前模型，停止自动重新判断",
  uiSession: "会话",
  uiTeam: "协作团队",
  uiGoals: "目标任务",
  uiChangedFiles: "变更文件",
  uiCost: "费用",
  uiToolActivity: "工具活动",
  uiTaskQueue: "任务队列",
  uiTerminalTasksCanTBeRunRequeueThem: "已结束的任务无法直接运行，请先重新加入队列。",
  uiNoTasksYet: "暂无任务",
  uiEnqueueAGoalAndRunItEachIteration: "添加目标并运行，每次迭代都会显示生成结果与评估结论。",
  uiIterations: "迭代记录",
  uiNoIterationsYet: "暂无迭代记录",
  uiRunThisTaskToProduceTheFirstIteration: "运行此任务以开始首轮迭代：生成、评估并判断目标是否达成。",
  uiAcceptance: "验收标准",
  uiAfterRetries: "· 重试后达成",
  uiGenerator: "生成者",
  uiGeneratorOutputSummary: "生成结果摘要",
  uiNoGeneratorSnapshot: "（暂无生成结果快照）",
  uiEvaluator: "评估者",
  uiNoEvaluatorSnapshot: "（暂无评估结果快照）",
  uiGoalEnqueueIntoThisProjectSTaskQueue: "输入目标，加入本项目的任务队列…",
  uiRunControlPauseSuspendsResumeContinuesBudgetSets: "暂停可挂起运行，恢复可继续执行；预算用于设置最大迭代数与重试数，默认均为 1。",
  uiNoMatchingReflectiveRules: "没有匹配的反思规则。",
  uiReflectiveRules: "反思规则",
  uiTrigger: "触发条件",
  uiLesson: "经验",
  uiRecommendedAction: "建议操作",
  uiHits: "命中次数",
  uiUpdated: "更新时间",
  uiConfidence: "可信度",
  uiCategory: "类别",
  uiAllCategories: "全部类别",
  uiPolicyDenial: "策略拒绝",
  uiToolFailure: "工具失败",
  uiArchitectureConstraint: "架构约束",
  uiSearchRules: "搜索规则",
  uiTriggerLessonOrAction: "触发条件、经验或建议操作",
  uiCognitiveRules: "认知规则",
  uiLoadingReflectiveRules: "正在加载反思规则…",
  uiCognitiveMemoryIsUnavailable: "认知记忆不可用。",
  uiRulesReadOnlyLatest1000Rules: "条规则 · 只读 · 显示最近 1,000 条",
  uiPermissionAction: "权限审批",
  uiPermission: "权限审批 ·",
  uiSendingResponse: "正在提交回应…",
  uiExpired: "已过期",
  uiResponseUnavailable: "无法提交回应",
  uiAwaitingYourDecision: "等待您的决定",
  uiImpact: "影响范围 ·",
  uiFiles: "个文件 ·",
  uiCallers: "个调用者",
  uiModifiedFiles: "变更文件",
  uiAffectedCallers: "受影响的调用者",
  uiNoAffectedCallersReported: "未报告受影响的调用者。",
  uiSubagents: "子代理",
  uiNoActiveSubagents: "暂无运行中的子代理",
  cancelLabel: "取消",
  uiID: "标识",
  uiProvider: "供应商",
  uiStatus: "状态",
  uiWorktree: "工作树",
  uiStarted: "开始时间",
  uiEnded: "结束时间",
  uiDuration: "耗时",
  uiExitCode: "退出码",
  uiTokenUsage: "词元用量",
  uiSubagentTokenUsage: "子代理词元用量",
  uiExecutionStages: "执行阶段",
  uiLocal: "本机",
  uiEndpoint: "端点",
  uiRoles: "角色",
  uiHeartbeatRTT: "心跳往返延迟",
  uiRemoteTaskActivity: "远端任务活动",
  uiMeshIsNotConfigured: "尚未配置代理网络。",
  uiSwarmPeerConnections: "代理节点连接",
  uiNoConnectedPeers: "暂无已连接节点。",
  uiMeshNodes: "代理网络节点",
  uiSwarmTopology: "代理网络拓扑",
  uiDAGID: "任务图标识",
  uiInspectObservedRemoteTasks: "查看已记录的远端任务",
  uiInspectDAG: "查看任务图",
  uiLoadingMeshNodes: "正在加载代理网络节点…",
  uiHeartbeatStateRefreshesEvery: "心跳状态刷新间隔为",
  uiSeconds: "秒。",
  uiActive: "运行中／",
  uiPeersObserved: "个节点 · 记录时间",
  uiOf: "／",
  uiObserved: "已记录",
  uiTalkingSandboxAudits: "会话沙箱审计",
  uiUnableToLoadExecutionAudits: "无法加载执行审计。",
  uiLoadingExecutionAudits: "正在加载执行审计…",
  uiNoSandboxExecutionAuditsRecorded: "暂无沙箱执行审计记录。",
  uiExecutionOutcome: "执行结果",
  uiIsolationTier: "隔离级别",
  uiReadOnlyPathWhitelist: "只读路径白名单",
  uiWritePathWhitelist: "写入路径白名单",
  uiMemoryLimit: "内存限制",
  uiPrivilegeReduction: "权限降低",
  uiReason: "原因",
  uiSandboxSecurityConstraints: "沙箱安全约束",
  uiCloseSandboxDetails: "关闭沙箱详情",
  uiSandbox: "沙箱：",
  uiTurnMetrics: "回合指标",
  uiCache: "⚡ 缓存",
  uiReadSavings: "读取节省费用 $ ",
  uiStagedTeamPlans: "待审批的团队计划",
  uiTeamPlanTask: "团队计划任务",
  uiPreviewATeamPlan: "预览团队计划…",
  uiStagePlan: "生成计划预览",
  uiTeamTaskAutoResolvesTheRosterSmallDev: "输入团队任务，自动安排精简、开发与评审或完整协作团队…",
  uiTeamActivityStreamsLiveFromTheSessionSSE: "团队活动实时更新，评审交接材料保存在 .vessel/reviews 目录。",
  uiNoTeamRunYet: "暂无团队运行记录",
  uiRunATaskWithThisSessionAndThe: "在本会话中运行团队任务后，将显示负责人、开发者与评审者的活动。",
  uiLive: "实时运行",
  uiQueued: "排队中…",
  uiOutputPreview: "输出预览",
  uiOutput: "输出",
  uiDelegate: "委派 →",
  uiCloseTaskDetails: "关闭任务详情",
  uiViewDiff: "查看差异",
  uiArtifactDiff: "产物差异",
  uiEditStagedTeamPlan: "编辑待审批的团队计划",
  uiMemberRoutes: "成员模型配置",
  uiRole: "角色",
  uiLead: "负责人",
  uiModel: "模型",
  uiReasoning: "推理深度",
  uiDefault: "默认",
  uiLow: "浅度",
  uiMedium: "中度",
  uiHigh: "深度",
  uiTemperature: "采样温度",
  uiTaskParameters: "任务参数",
  uiTitle: "标题",
  uiAssignedRole: "执行角色",
  uiDescription: "说明",
  uiDependenciesCommaSeparated: "依赖任务（以逗号分隔）",
  uiSaveRevisedPreview: "保存修改后的预览",
  uiEditPlanBeforeApproval: "审批前编辑计划",
  uiTeamPlanAwaitingApproval: "团队计划等待审批",
  uiReviewTeamPlan: "审阅团队计划 ·",
  uiApproveAmpRun: "批准并运行",
  uiReject: "拒绝",
  uiTeamTaskDependencies: "团队任务依赖",
  uiDetails: "详情",
  uiCollapsed: "已折叠",
  uiCardSpaceToExpand: "卡片 · 按空格展开",
  uiExternalReviewRequired: "需要外部评审",
  uiCopyHandoff: "复制交接材料",
  uiCopyTheHandoffMdArtifactForTheExternal: "复制交接材料给外部评审者",
  uiOpenFolder: "打开文件夹",
  uiOpenVesselReviewsIdInTheOSFile: "在文件管理器中打开评审材料目录",
  uiImportResult: "导入结果",
  uiReview: "评审：",
  uiStatusLabel: "状态：",
  uiSHA256: "校验值：",
  uiVerificationGate: "验证门禁",
  uiVerificationDetails: "验证详情",
  uiPhase: "阶段",
  uiCalls: "次调用",
  uiChooseAnOptionToRetry: "· 请选择一个选项重试。",
  uiExecutor: "· 执行器：",
  uiExit: "· 退出码",
  uiLastLabel: "· 最近",
  uiSuggest: "建议：",
  uiUnmet: "未达成：",
  uiDependencies: "依赖任务：",
  uiAdding: "正在添加…",
  uiEnqueue: "加入队列",
  uiRunTask: "运行任务",
  uiRunTeam: "运行团队",
  uiRunning: "运行中…",
  uiFingerprintChangedSinceThePreviousObservation: "工作区指纹自上次记录后已变化。",
  uiObservedWorkspaceFingerprint: "已记录工作区指纹。",
  uiOpenInspector: "打开检视器",
  uiCollapseInspector: "收起检视器",
  uiLocalNode: "本机节点",
  uiNoDAGSnapshotObservedSelectADAGTo: "暂无任务图快照，请选择任务图查看任务。",
  uiNoRolesAdvertised: "未公布角色",
  uiUnavailable: "不可用",
  uiNotRecordedByTheExecutionAudit: "执行审计未记录此项。",
  uiNoExplicitReadOnlyRootsHostPermissionsApply: "未指定只读根目录，使用系统权限。",
  uiNoNativeMemoryCapConfigured: "未配置原生内存上限。",
  uiNoWritePathsAllowed: "不允许写入任何路径。",
  uiNotEnforcedForThisExecution: "本次执行未强制应用。",
  uiRedVerified: "失败验证已确认",
  uiGreenVerified: "通过验证已确认",
  uiRejected: "已拒绝",
  uiRTTUnavailable: "往返延迟不可用",
  retry: "重试",
  uiRefresh: "刷新",
  uiYou: "您",
  uiEstimated: "估算",
  newSession: '+ 新建会话',
  projects: '项目',
  recentSessions: "历史会话",
  topicSearch: '搜索主题或会话…',
  topicToday: '今天',
  topicLastSevenDays: '最近 7 天',
  topicEarlier: '更早',
  topicUntitled: '未命名主题',
  topicShowArchived: '显示已归档',
  topicRename: '重命名主题',
  topicArchive: '归档主题',
  topicRestore: '恢复主题',
  topicSave: '保存',
  topicCancel: '取消',
  settings: '设置',
  language: '语言',
  send: '发送',
  stop: '停止',
  running: '运行中…',
  thinking: "思考推演中…",
  thinkingFor: '思考用时 {duration}',
  metricPrompt: '提示',
  metricCompletion: '输出',
  metricThinking: '推理',
  metricCacheRead: '缓存读取',
  metricLatency: '时延',
  metricCost: '估算成本',
  inputPlaceholder: "输入消息…（按回车发送）",
  serverDown: "无法连接本地服务，请先运行 vessel serve（127.0.0.1:5678）。",
  statusOk: "Vessel 本地服务运行正常（版本 {version}）",
  statusDown: "本地服务未连接，请先运行 vessel serve（127.0.0.1:5678）。",
  emptyTitle: '选择或新建会话',
  emptyBody: "从左侧历史会话选择一个会话开始对话，或点击“新建会话”打开项目。",
  noProjects: '暂无项目',
  noSessions: '暂无会话',
  placeholderDev: '（开发中）',
  unimplemented: '未实现（占位）。',
  tasksPlaceholder: '任务列表占位（开发中）。',
  changedFilesPlaceholder: '变更文件列表占位（开发中）。',
  customize: '自定义',
  customizeHead: '显示模块',
  interruptTitle: "中断当前回合",
  teamModuleNoSession: "选择或新建会话后，将显示模型选择、团队活动与外部评审面板。",
  goalModuleNoSession: "选择或新建会话后，将显示任务队列、迭代回放与运行控制面板。",
};

export const en: Messages = {
  providerPreset: "Preset",
  providerCustom: "Custom compatible endpoint",
  providerName: "Provider name",
  providerProtocol: "Protocol",
  providerOpenai: "OpenAI Compatible",
  providerAnthropic: "Anthropic (Claude)",
  providerBaseUrl: "Base URL",
  providerApiKey: "API Key",
  providerModels: "Models (comma separated)",
  providerAdd: "Add provider",
  providerEmpty: "No providers configured. Choose a preset and enter connection details.",
  providerKeyHint: "Keys are stored securely on this machine. Local compatible endpoints may omit the key.",
  providerTest: "Test connection",
  providerTesting: "Testing connection…",
  providerConnected: "Connected · {ms} ms",
  providerFailed: "Connection failed. Check the endpoint and key.",
  providerTimeout: "Connection timed out. Check your network and retry.",
  providerHttp: "Connection failed · HTTP {status}",
  providerBadResponse: "The endpoint returned an invalid model list.",
  providerOperationFailed: "Operation failed. Check the local server and retry.",
  providerInvalidName: "Use letters, numbers, underscores, dots or hyphens; mock is reserved.",
  providerDuplicate: "That name is already configured. Use a different name.",
  providerInvalidUrl: "Enter an HTTP or HTTPS URL without credentials, query or fragment.",
  providerKeyRequired: "An API key is required for this endpoint.",
  providerModelsRequired: "Enter at least one valid model name.",
  providerDeleteConfirm: "Delete {name}?",
  providerSaved: "Provider saved.",
  providerDeleted: "Provider deleted.",
  providerNoKey: "No key required",
  providerPullModels: "Pull models",
  providerPulling: "Pulling models…",
  providerPulled: "Pulled {count} models.",
  providerPullEmpty: "The endpoint returned no models. Check the base URL and API key.",
  providerErrInvalidProtocol: "Invalid protocol. Only OpenAI Compatible and Anthropic are supported.",
  providerErrNotFound: "That provider does not exist or was already removed.",
  providerErrBuiltin: "The built-in mock provider cannot be deleted.",
  providerErrSecureStore: "Secure credential storage is unavailable, so the key cannot be saved.",
  providerErrStoreCorrupted: "The provider configuration file is corrupted or has an invalid entry. Check ~/.vessel or restore a backup.",

  rolePlanner: "planner",
  roleWorker: "worker",
  stateBusy: "busy",
  stateApproved: "approved",
  stateStaged: "staged",
  stateScheduled: "scheduled",
  cacheWriteLabel: "Cache write",
  uiUnclaimed: "Unclaimed",
  uiNone: "None",
  uiNoWorkspaceChangesAgainstHEAD: "No workspace changes against HEAD.",
  messageCard: "{kind} card",
  kindMessage: "message",
  kindWidget: "widget",
  kindThinking: "thinking",
  actionFilesystemWrite: "filesystem write",
  actionNetworkAccess: "network access",
  actionExternalProcess: "external process",
  actionApproval: "human approval",
  languageChinese: "Chinese",
  languageEnglish: "English",
  confirm: "Confirm",
  save: "Save",
  delete: "Delete",
  copy: "Copy",
  loading: "Loading…",
  create: "Create",
  creating: "Creating…",
  permissionDangerFull: "Full access",
  modelSettings: "Model settings",
  providerRefreshFailed: "Configuration updated, but the list could not refresh. Please retry.",
  selectModel: "Select model",
  modelLoadFailed: "Unable to load models. Please retry.",
  modelSwitchFailed: "Model switch failed. The current model is unchanged.",
  modelSwitchBusy: "Wait for the active task to finish before switching models.",
  modelOffline: "Offline demo",
  configureModels: "Configure new model",
  sessionCreateFailed: "Unable to create session. Check the workspace and model configuration.",
  currentModel: "Current model",
  noModelsConfigured: "No models configured",
  tabSwarm: "Swarm",
  tabRules: "Cognition",
  tabCache: "KV Cache",
  tabImpact: "AST",
  tabPatch: "Patch",
  tabDiff: "Diff",
  tabTree: "Tree",
  expandLines: "Expand {count} lines",
  reasoningRate: "{rate} reasoning tokens/s (provider reported)",
  outputRate: "{rate} output tokens/s (model-call average)",
  tokenRateUnavailable: "Token rate unavailable",
  timeSeconds: "{value}s",
  timeMilliseconds: "{value}ms",
  notificationEnabled: "Notifications: granted",
  notificationDenied: "Notifications: denied",
  notificationUnsupported: "Notifications: unsupported",
  patchFailed: "Patch action failed",
  resolvedChoice: "Resolved · {choice}",
  reportedCallers: "{count} reported callers of {symbol}",
  observedCallers: "Observed callers of {symbol}",
  estimatedUsage: " · Estimated usage",
  palettePlaceholder: "Type a command or search sessions…",
  paletteCategorySession: "session",
  paletteCategoryAction: "action",
  paletteCategoryView: "view",
  paletteCategoryNavigation: "navigation",
  paletteClearScreen: "Clear screen (local display only)",
  paletteExportJson: "Export visible conversation as JSON",
  paletteCollapse: "Collapse conversation cards",
  paletteExpand: "Expand conversation cards",
  paletteSandbox: "Sandbox: new session with {permission} permission",
  paletteSession: "Session: {title} — {root}",
  paletteInspector: "Canvas Inspector: {tab}",
  agentCount: "{count} agent{plural}",
  completedDuration: "completed in {count}s",
  failedReason: "failed — {reason}",
  turnCount: "{count} turn{plural}",
  taskCount: "{count} task{plural}",
  artifactCount: "{count} artifact{plural} on disk",
  pause: "Pause",
  resume: "Resume",
  budget: "Budget",
  pauseHint: "Suspend the running task (not an abort)",
  resumeHint: "Continue a paused task from the same boundary",
  budgetHint: "Query/set maxIterations & maxRetries ($11.1 default 1/1)",
  terminalTask: "run not available on a terminal task",
  handoffCopied: "Handoff copied to clipboard",
  folderOpened: "Folder opened",
  reviewImported: "Review result imported",
  clipboardUnavailable: "Clipboard unavailable",
  noOwningWorkspace: "No owning project workspace for this session",
  taskDetails: "Task details: {title}",
  cancelAgent: "Cancel {name}",
  teamStage: "Team stage {id}",
  heartbeatHistory: "Recent heartbeat RTT for {node}",
  heartbeatSamples: "Last {count} successful observations: {samples} ms",
  localConnections: "Local node connected to {count} peers",
  toolCalled: "Called tool {name}",
  tokenUnit: "tok",
  usageTitle: "Total model usage (calls, tokens and estimated cost){hint}",
  cacheReadCount: "read {count}",
  cacheWriteCount: "write {count}",
  cacheBreakdown: " (cache {parts})",
  cachePriceEstimate: "; cache write price estimated at 1.25× input when not configured",
  interrupted: "[interrupted]",
  privilegeWindows: "Restricted token, Low Integrity, and Job Object confinement.",
  privilegeBwrap: "Bubblewrap namespace confinement.",
  privilegeLow: "Low Integrity token; full native isolation is not reported.",
  privilegeMac: "macOS Seatbelt profile confinement.",
  privilegeNone: "No native privilege reduction reported.",
  byteCount: "{count} bytes",
  noTool: "(tool)",
  moduleContext: "Context",
  moduleLogs: "Logs",
  moduleMcp: "MCP",
  modulePolicy: "Policy",
  modelAuto: "Auto",
  modelFast: "Fast",
  modelPro: "Pro",
  roleDeveloper: "Developer",
  roleReviewer: "Reviewer",
  phaseOrchestrate: "Orchestrate",
  phaseGenerate: "Generate",
  phaseEvaluate: "Review",
  statePending: "pending",
  stateAccepted: "accepted",
  stateRejected: "rejected",
  stateRunning: "running",
  stateDone: "done",
  stateFailed: "failed",
  stateError: "error",
  stateStarted: "started",
  stateDenied: "denied",
  stateImported: "imported",
  statePaused: "paused",
  stateProgress: "in progress",
  stateMet: "Met",
  stateNotMet: "Not met",
  stateImpossible: "Impossible",
  stateCancelled: "cancelled",
  stateCompleted: "completed",
  stateStopped: "stopped",
  stateIdle: "idle",
  stateQueued: "queued",
  stateOnline: "online",
  stateOffline: "offline",
  stateEnforced: "enforced",
  stateUnavailable: "unavailable",
  stateExpired: "expired",
  stateClaimed: "claimed",
  sourceExternal: "external",
  sourceInternal: "internal",
  tierRestricted: "windows-job-restricted",
  tierBwrap: "bwrap-ns",
  tierLow: "lowIntegrity",
  tierMac: "macos-seatbelt",
  tierNone: "none",
  stateFallback: "fallback",
  tierSmall: "small",
  tierStandard: "standard",
  tierAdvanced: "advanced",
  turnTool: "tool",
  turnFinal: "final",
  turnContinue: "continue",
  gateRed: "Red verified",
  gateGreen: "Green verified",
  legacyStatusPass: "pass",
  legacyStatusFail: "fail",
  legacyGenerator: "generator",
  legacyEvaluator: "evaluator",
  legacyOrchestrator: "orchestrator",
  newSessionTitle: "New Session",
  permissionLabel: "New session permission (current session unchanged)",
  permissionReadOnly: "Read-only",
  permissionWorkspaceWrite: "Workspace write",
  workspacePath: "workspaceRoot",
  workspacePlaceholder: "/path/to/project",
  cancel: "Cancel",
  conversationEmpty: "Send a message to start a conversation. Live responses appear here.",
  uiKVCacheEconomics: "KV Cache economics",
  uiBilledCacheHitRate: "Billed cache hit rate",
  uiCached: "cached /",
  uiPromptTokens: "prompt tokens ·",
  uiCreated: "created",
  uiEstimatedSavings: "Estimated savings $",
  uiObservedBilledCacheHitRateHistory: "Observed billed cache hit rate history",
  uiLast: "Last",
  uiObservedModelCallsInThisSession: "observed model calls in this session.",
  uiWorkspaceFingerprint: "Workspace fingerprint",
  uiTrackedFiles: "tracked files ·",
  uiUncommittedDiffBytes: "uncommitted diff bytes",
  uiPromptPrefixSegments: "Prompt prefix segments",
  uiStable: "Stable ·",
  uiScoped: "Scoped ·",
  uiVolatile: "Volatile ·",
  uiBytes: "bytes",
  uiPrefixSHA256: "Prefix SHA-256",
  uiNoCacheUsageObservedInThisSession: "No cache usage observed in this session.",
  uiNoWorkspaceFingerprintObserved: "No workspace fingerprint observed.",
  uiNoPromptPrefixSegmentsObserved: "No prompt prefix segments observed.",
  uiASTSymbolDependencies: "AST symbol dependencies",
  uiASTImpactRadar: "AST impact radar",
  uiObservedImpactReportsForThisSession: "Observed impact reports for this session.",
  uiNoASTImpactReportsObserved: "No AST impact reports observed.",
  uiPatchWorkbench: "Patch workbench",
  uiReviewTextChangesOneHunkAtATime: "Review text changes one hunk at a time. Revert safely removes a selected applied hunk; reapply restores it.",
  uiNoPatchProposalsObservedInThisSession: "No patch proposals observed in this session.",
  uiToggleInspectorCtrlCmdI: "Toggle Inspector (Ctrl/Cmd+I)",
  uiSessionInspector: "Session Inspector",
  inspectorTitle: "Inspector",
  uiCloseInspector: "Close Inspector",
  uiInspectorPanels: "Inspector panels",
  uiInteractivePatchPicker: "Interactive patch picker",
  viewUnified: "Unified view",
  viewSplit: "Side-by-side view",
  acceptHunk: "Accept hunk",
  discardHunk: "Discard hunk",
  revertHunk: "Revert hunk",
  reapplyHunk: "Reapply hunk",
  uiSideBySidePatch: "Side-by-side patch",
  uiUnifiedPatch: "Unified patch",
  uiDiffInspector: "Diff inspector",
  uiCollapseDiff: "Collapse diff",
  uiUnifiedDiff: "Unified diff",
  uiOldLineNewLinePatch: "Old line, new line, patch",
  cognitiveRulesHit: "Matched cognitive rules",
  uiRule: "Rule",
  uiReflection: "Reflection:",
  uiHistoricalGuidanceCurrentPolicyTakesPrecedence: "Historical guidance; current policy takes precedence.",
  uiCommands: "Commands",
  uiCommandsCtrlCmdK: "Commands (Ctrl/Cmd+K)",
  uiKeyboardShortcuts: "Keyboard shortcuts",
  uiSearchCommandsAndSessions: "Search commands and sessions",
  uiCtrlCmdKCommandsJKOrMessages: "Ctrl/Cmd+K: commands · J/K or ↑/↓: messages · Esc: exit message focus · Space: fold card · Enter: focus approval choices · ?: this guide",
  uiMatchingCommands: "Matching commands",
  uiNoMatchingCommands: "No matching commands.",
  close: "Close",
  attentionTitle: "Attention settings",
  soundMute: "Mute cues",
  soundUnmute: "Unmute cues",
  enableNotification: "Enable notifications",
  uiDesktopNotificationsForBackgroundOrUnfocusedTasksCompletion: "Desktop notifications for background or unfocused tasks. Completion cues require five seconds.",
  uiModelMode: "model mode",
  uiResolvedActualModel: "resolved actual model",
  uiResolveTheActualModelForThisMode: "resolve the actual model for this mode",
  uiResolve: "Resolve",
  uiPinnedUnpin: "Pinned · Unpin",
  uiPinForThisSession: "Pin for this session",
  uiUnpinTheNextAutoResolutionReJudges: "unpin — the next auto resolution re-judges",
  uiPinThisResolutionForTheSessionNoAutomatic: "pin this resolution for the session (no automatic re-judge)",
  uiSession: "session",
  uiTeam: "Team",
  uiGoals: "Goals",
  uiChangedFiles: "Changed Files",
  uiCost: "Cost",
  uiToolActivity: "Tool Activity",
  uiTaskQueue: "Task queue",
  uiTerminalTasksCanTBeRunRequeueThem: "Terminal tasks can't be run — requeue them first (runtime).",
  uiNoTasksYet: "No tasks yet",
  uiEnqueueAGoalAndRunItEachIteration: "Enqueue a goal and run it — each iteration shows the generator output and the evaluator verdict.",
  uiIterations: "Iterations",
  uiNoIterationsYet: "No iterations yet",
  uiRunThisTaskToProduceTheFirstIteration: "Run this task to produce the first iteration (gen → eval → met/not_met).",
  uiAcceptance: "Acceptance",
  uiAfterRetries: "· after retries",
  uiGenerator: "Generator",
  uiGeneratorOutputSummary: "generator output summary",
  uiNoGeneratorSnapshot: "(no generator snapshot)",
  uiEvaluator: "Evaluator",
  uiNoEvaluatorSnapshot: "(no evaluator snapshot)",
  uiGoalEnqueueIntoThisProjectSTaskQueue: "Goal… (enqueue into this project's task queue)",
  uiRunControlPauseSuspendsResumeContinuesBudgetSets: "Run control: Pause suspends, Resume continues; Budget sets maxIterations/maxRetries (§11.1 default 1/1).",
  uiNoMatchingReflectiveRules: "No matching reflective rules.",
  uiReflectiveRules: "Reflective rules",
  uiTrigger: "Trigger",
  uiLesson: "Lesson",
  uiRecommendedAction: "Recommended action",
  uiHits: "Hits",
  uiUpdated: "Updated",
  uiConfidence: "Confidence",
  uiCategory: "Category",
  uiAllCategories: "All categories",
  uiPolicyDenial: "policy_denial",
  uiToolFailure: "tool_failure",
  uiArchitectureConstraint: "architecture_constraint",
  uiSearchRules: "Search rules",
  uiTriggerLessonOrAction: "Trigger, lesson or action",
  uiCognitiveRules: "Cognitive rules",
  uiLoadingReflectiveRules: "Loading reflective rules…",
  uiCognitiveMemoryIsUnavailable: "Cognitive memory is unavailable.",
  uiRulesReadOnlyLatest1000Rules: "rules · Read-only · Latest 1,000 rules",
  uiPermissionAction: "Permission action",
  uiPermission: "Permission ·",
  uiSendingResponse: "Sending response…",
  uiExpired: "Expired",
  uiResponseUnavailable: "Response unavailable",
  uiAwaitingYourDecision: "Awaiting your decision",
  uiImpact: "Impact ·",
  uiFiles: "files ·",
  uiCallers: "callers",
  uiModifiedFiles: "Modified files",
  uiAffectedCallers: "Affected callers",
  uiNoAffectedCallersReported: "No affected callers reported.",
  uiSubagents: "Subagents",
  uiNoActiveSubagents: "No active subagents",
  cancelLabel: "Cancel",
  uiID: "ID",
  uiProvider: "Provider",
  uiStatus: "Status",
  uiWorktree: "Worktree",
  uiStarted: "Started",
  uiEnded: "Ended",
  uiDuration: "Duration",
  uiExitCode: "Exit code",
  uiTokenUsage: "Token usage",
  uiSubagentTokenUsage: "Subagent token usage",
  uiExecutionStages: "Execution stages",
  uiLocal: "Local",
  uiEndpoint: "Endpoint",
  uiRoles: "Roles",
  uiHeartbeatRTT: "Heartbeat RTT",
  uiRemoteTaskActivity: "Remote task activity",
  uiMeshIsNotConfigured: "Mesh is not configured.",
  uiSwarmPeerConnections: "Swarm peer connections",
  uiNoConnectedPeers: "No connected peers.",
  uiMeshNodes: "Mesh nodes",
  uiSwarmTopology: "Swarm topology",
  uiDAGID: "DAG ID",
  uiInspectObservedRemoteTasks: "Inspect observed remote tasks",
  uiInspectDAG: "Inspect DAG",
  uiLoadingMeshNodes: "Loading mesh nodes…",
  uiHeartbeatStateRefreshesEvery: "Heartbeat state refreshes every",
  uiSeconds: "seconds.",
  uiActive: "active /",
  uiPeersObserved: "peers · Observed",
  uiOf: "of",
  uiObserved: "observed",
  uiTalkingSandboxAudits: "Talking sandbox audits",
  uiUnableToLoadExecutionAudits: "Unable to load execution audits.",
  uiLoadingExecutionAudits: "Loading execution audits…",
  uiNoSandboxExecutionAuditsRecorded: "No sandbox execution audits recorded.",
  uiExecutionOutcome: "Execution outcome",
  uiIsolationTier: "Isolation tier",
  uiReadOnlyPathWhitelist: "Read-only path whitelist",
  uiWritePathWhitelist: "Write path whitelist",
  uiMemoryLimit: "Memory limit",
  uiPrivilegeReduction: "Privilege reduction",
  uiReason: "Reason",
  uiSandboxSecurityConstraints: "Sandbox security constraints",
  uiCloseSandboxDetails: "Close sandbox details",
  uiSandbox: "Sandbox:",
  uiTurnMetrics: "Turn metrics",
  uiCache: "⚡ Cache",
  uiReadSavings: "read savings $",
  uiStagedTeamPlans: "Staged team plans",
  uiTeamPlanTask: "Team plan task",
  uiPreviewATeamPlan: "Preview a team plan…",
  uiStagePlan: "Stage plan",
  uiTeamTaskAutoResolvesTheRosterSmallDev: "Team task… (Auto resolves the roster: small / dev+reviewer / lead+dev+reviewer)",
  uiTeamActivityStreamsLiveFromTheSessionSSE: "Team activity streams live from the session SSE; review handoffs live under .vessel/reviews.",
  uiNoTeamRunYet: "No team run yet",
  uiRunATaskWithThisSessionAndThe: "Run a task with this session and the 3-agent activity (Lead / Developer / Reviewer) will appear here.",
  uiLive: "live",
  uiQueued: "queued…",
  uiOutputPreview: "output preview",
  uiOutput: "Output",
  uiDelegate: "delegate →",
  uiCloseTaskDetails: "Close task details",
  uiViewDiff: "View diff",
  uiArtifactDiff: "Artifact diff",
  uiEditStagedTeamPlan: "Edit staged team plan",
  uiMemberRoutes: "Member routes",
  uiRole: "Role",
  uiLead: "Lead",
  uiModel: "Model",
  uiReasoning: "Reasoning",
  uiDefault: "Default",
  uiLow: "Low",
  uiMedium: "Medium",
  uiHigh: "High",
  uiTemperature: "Temperature",
  uiTaskParameters: "Task parameters",
  uiTitle: "Title",
  uiAssignedRole: "Assigned role",
  uiDescription: "Description",
  uiDependenciesCommaSeparated: "Dependencies (comma separated)",
  uiSaveRevisedPreview: "Save revised preview",
  uiEditPlanBeforeApproval: "Edit plan before approval",
  uiTeamPlanAwaitingApproval: "Team plan awaiting approval",
  uiReviewTeamPlan: "Review team plan ·",
  uiApproveAmpRun: "Approve & Run",
  uiReject: "Reject",
  uiTeamTaskDependencies: "Team task dependencies",
  uiDetails: "Details",
  uiCollapsed: "Collapsed",
  uiCardSpaceToExpand: "card · Space to expand",
  uiExternalReviewRequired: "External Review Required",
  uiCopyHandoff: "Copy Handoff",
  uiCopyTheHandoffMdArtifactForTheExternal: "copy the handoff.md artifact for the external reviewer",
  uiOpenFolder: "Open Folder",
  uiOpenVesselReviewsIdInTheOSFile: "open .vessel/reviews/<id> in the OS file manager",
  uiImportResult: "Import Result",
  uiReview: "Review:",
  uiStatusLabel: "Status:",
  uiSHA256: "SHA-256:",
  uiVerificationGate: "Verification gate",
  uiVerificationDetails: "Verification details",
  uiPhase: "phase",
  uiCalls: "calls",
  uiChooseAnOptionToRetry: "· Choose an option to retry.",
  uiExecutor: "· Executor:",
  uiExit: "· exit",
  uiLastLabel: "· last",
  uiSuggest: "suggest:",
  uiUnmet: "unmet:",
  uiDependencies: "Dependencies:",
  uiAdding: "Adding…",
  uiEnqueue: "Enqueue",
  uiRunTask: "Run task",
  uiRunTeam: "Run team",
  uiRunning: "Running…",
  uiFingerprintChangedSinceThePreviousObservation: "Fingerprint changed since the previous observation.",
  uiObservedWorkspaceFingerprint: "Observed workspace fingerprint.",
  uiOpenInspector: "Open Inspector",
  uiCollapseInspector: "Collapse Inspector",
  uiLocalNode: "Local node",
  uiNoDAGSnapshotObservedSelectADAGTo: "No DAG snapshot observed. Select a DAG to inspect tasks.",
  uiNoRolesAdvertised: "No roles advertised",
  uiUnavailable: "Unavailable",
  uiNotRecordedByTheExecutionAudit: "Not recorded by the execution audit.",
  uiNoExplicitReadOnlyRootsHostPermissionsApply: "No explicit read-only roots; host permissions apply.",
  uiNoNativeMemoryCapConfigured: "No native memory cap configured.",
  uiNoWritePathsAllowed: "No write paths allowed.",
  uiNotEnforcedForThisExecution: "Not enforced for this execution.",
  uiRedVerified: "Red verified",
  uiGreenVerified: "Green verified",
  uiRejected: "Rejected",
  uiRTTUnavailable: "RTT unavailable",
  retry: "Retry",
  uiRefresh: "Refresh",
  uiYou: "You",
  uiEstimated: "estimated ",
  newSession: '+ New Session',
  projects: 'Projects',
  recentSessions: 'Recent Sessions',
  topicSearch: 'Search topics or sessions…',
  topicToday: 'Today',
  topicLastSevenDays: 'Previous 7 days',
  topicEarlier: 'Earlier',
  topicUntitled: 'Untitled topic',
  topicShowArchived: 'Show archived',
  topicRename: 'Rename topic',
  topicArchive: 'Archive topic',
  topicRestore: 'Restore topic',
  topicSave: 'Save',
  topicCancel: 'Cancel',
  settings: 'Settings',
  language: 'Language',
  send: 'Send',
  stop: 'Stop',
  running: 'Running…',
  thinking: 'Thinking…',
  thinkingFor: 'Thought for {duration}',
  metricPrompt: 'Prompt',
  metricCompletion: 'Completion',
  metricThinking: 'Reasoning',
  metricCacheRead: 'Cache read',
  metricLatency: 'Latency',
  metricCost: 'Est. cost',
  inputPlaceholder: 'Type a message… (Enter to send)',
  serverDown: 'Cannot reach local server — please run `vessel serve` (127.0.0.1:5678).',
  statusOk: 'Vessel local server ok (v{version})',
  statusDown: 'Local server not connected — please run `vessel serve` (127.0.0.1:5678).',
  emptyTitle: 'Select or start a session',
  emptyBody:
    'Pick a session from Recent Sessions to start chatting, or click + New Session to open a project.',
  noProjects: 'No projects',
  noSessions: 'No sessions',
  placeholderDev: '（under development）',
  unimplemented: 'Not implemented (placeholder).',
  tasksPlaceholder: 'Task list placeholder (under development).',
  changedFilesPlaceholder: 'Changed files placeholder (under development).',
  customize: 'Customize',
  customizeHead: 'Display modules',
  interruptTitle: 'Interrupt the current turn (placeholder: POST /interrupt)',
  teamModuleNoSession:
    'Select or start a session and the Team panel (model select / 3-agent activity / External Review) appears here.',
  goalModuleNoSession:
    'Select or start a session and the Goals panel (task queue / iteration replay / per-run control) appears here.',
};

/** All dictionaries keyed by language. */
export const DICT: Record<Lang, Messages> = { zh, en };

export type MessageKey = keyof Messages;

/** Minimal storage contract so tests can inject an in-memory stub. */
export interface PersistStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Minimal locale provider contract (navigator.language in the browser). */
export interface LocaleSource {
  language: string;
}

function pickStorage(): PersistStorage | null {
  try {
    return (globalThis as { localStorage?: PersistStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function pickLocale(): LocaleSource | null {
  try {
    return (globalThis as { navigator?: LocaleSource }).navigator ?? null;
  } catch {
    return null;
  }
}

function isLang(value: string | null | undefined): value is Lang {
  return value === 'zh' || value === 'en';
}

/** Read the persisted override ('zh'|'en'); null when absent / invalid. */
export function loadStoredLang(storage?: PersistStorage | null): Lang | null {
  const store = storage === undefined ? pickStorage() : storage;
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
  return isLang(raw) ? raw : null;
}

/** Infer the default from locale: `zh*` → 'zh', anything else → 'en'. */
export function inferLang(locale?: LocaleSource | null): Lang {
  const source = locale === undefined ? pickLocale() : locale;
  const lang = source?.language ?? '';
  return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** Resolve the effective language: stored override wins, else locale default. */
export function getInitialLang(opts?: {
  storage?: PersistStorage | null;
  locale?: LocaleSource | null;
}): Lang {
  return loadStoredLang(opts?.storage) ?? inferLang(opts?.locale);
}

/** Persist the user's explicit choice; safe no-op when storage unavailable. */
export function saveLang(lang: Lang, storage?: PersistStorage | null): void {
  const store = storage === undefined ? pickStorage() : storage;
  if (!store) return;
  try {
    store.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* storage blocked/full — degrade silently */
  }
}

/**
 * Return a bound `t` translator for `lang`. Fills `{var}` placeholders from
 * params. Unknown keys and missing languages fall back to en, then the raw key,
 * so a missing translation never crashes and stays greppable.
 */
export function translate(lang: Lang): (key: MessageKey, params?: Record<string, string>) => string {
  return (key, params) => {
    let value: string | undefined = DICT[lang]?.[key];
    if (value === undefined) value = en[key]; // fallback: en
    if (value === undefined) return key; // fallback: raw key
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
  };
}

/** The i18n API surfaced via React context: current lang, a `t`, a setter. */
export interface I18nApi {
  lang: Lang;
  t: (key: MessageKey, params?: Record<string, string>) => string;
  setLang: (lang: Lang) => void;
}

/** Translate UI enum labels without changing their protocol values. Unknown values remain evidence. */
const VALUE_MESSAGES: Record<string, MessageKey> = {
  planner: "rolePlanner",
  worker: "roleWorker",
  busy: "stateBusy",
  approved: "stateApproved",
  staged: "stateStaged",
  scheduled: "stateScheduled",
  "Swarm": "tabSwarm",
  "CognitiveRules": "tabRules",
  "Team": "uiTeam",
  "Tasks": "uiGoals",
  "ChangedFiles": "uiChangedFiles",
  "ToolActivity": "uiToolActivity",
  "Cost": "uiCost",
  "Context": "moduleContext",
  "Logs": "moduleLogs",
  "MCP": "moduleMcp",
  "Policy": "modulePolicy",
  "auto": "modelAuto",
  "fast": "modelFast",
  "pro": "modelPro",
  "lead": "uiLead",
  "developer": "roleDeveloper",
  "reviewer": "roleReviewer",
  "orchestrate": "phaseOrchestrate",
  "generate": "phaseGenerate",
  "evaluate": "phaseEvaluate",
  "pending": "statePending",
  "accepted": "stateAccepted",
  "rejected": "stateRejected",
  "running": "stateRunning",
  "done": "stateDone",
  "failed": "stateFailed",
  "error": "stateError",
  "started": "stateStarted",
  "denied": "stateDenied",
  "imported": "stateImported",
  "paused": "statePaused",
  "in-progress": "stateProgress",
  "met": "stateMet",
  "not_met": "stateNotMet",
  "impossible": "stateImpossible",
  "cancelled": "stateCancelled",
  "completed": "stateCompleted",
  "stopped": "stateStopped",
  "idle": "stateIdle",
  "queued": "stateQueued",
  "online": "stateOnline",
  "offline": "stateOffline",
  "enforced": "stateEnforced",
  "unavailable": "stateUnavailable",
  "expired": "stateExpired",
  "claimed": "stateClaimed",
  "external": "sourceExternal",
  "internal": "sourceInternal",
  "windows-job-restricted": "tierRestricted",
  "bwrap-ns": "tierBwrap",
  "lowIntegrity": "tierLow",
  "macos-seatbelt": "tierMac",
  "none": "tierNone",
  "fallback": "stateFallback",
  "small": "tierSmall",
  "standard": "tierStandard",
  "advanced": "tierAdvanced",
  "tool": "turnTool",
  "final": "turnFinal",
  "continue": "turnContinue",
  "red_verified": "gateRed",
  "green_verified": "gateGreen",
  "pass": "legacyStatusPass",
  "fail": "legacyStatusFail",
  "generator": "legacyGenerator",
  "evaluator": "legacyEvaluator",
  "orchestrator": "legacyOrchestrator",
  "policy_denial": "uiPolicyDenial",
  "tool_failure": "uiToolFailure",
  "architecture_constraint": "uiArchitectureConstraint",
  "message": "kindMessage",
  "widget": "kindWidget",
  "thinking": "kindThinking",
  "filesystem_write": "actionFilesystemWrite",
  "network_access": "actionNetworkAccess",
  "external_process": "actionExternalProcess",
  "human_approval": "actionApproval",
  "low": "uiLow",
  "medium": "uiMedium",
  "high": "uiHigh",
  "default": "uiDefault"
};
export function localizedValue(value: string, t: I18nApi["t"]): string {
  const key = VALUE_MESSAGES[value];
  return key ? t(key) : value;
}
