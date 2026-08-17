const state = {
  sessions: [],
  selectedId: localStorage.getItem("sessionHub.selectedId"),
  selected: null,
  filter: "wrapped",
  query: "",
  editField: null,
  view: localStorage.getItem("sessionHub.view") || "sessions",
  projects: [],
  selectedProjectId: localStorage.getItem("sessionHub.projectId"),
  commandIndex: 0
};
let modalReturnFocus = null;

const sessionHubCommands = [
  {
    command: "/wrap",
    title: "Wrap this session",
    description: "Save where you stopped, the real next action, and unfinished checklist items."
  },
  {
    command: "/wrap-with-next",
    title: "Wrap with a todo list",
    description: "Save the session plus an explicit list of what you want to do next time."
  },
  {
    command: "/kanban",
    title: "Generate an execution plan",
    description: "Analyze unfinished chat work, order it, and populate the project board."
  },
  {
    command: "/kanban-update",
    title: "Synchronize board progress",
    description: "Move completed, blocked, and discovered work based on actual conversation evidence."
  },
  {
    command: "/kanban-process",
    title: "Execute the next task",
    description: "Choose the best actionable card, move it to In Progress, execute it, and update the board."
  },
  {
    command: "/context",
    title: "Inspect context window",
    description: "Show current context-window usage and visualization."
  },
  {
    command: "/usage",
    title: "Inspect AI usage",
    description: "Show session usage metrics and AI credit information."
  },
  {
    command: "/compact",
    title: "Compact conversation context",
    description: "Summarize history to free context while preserving the important work state."
  },
  {
    command: "/share",
    title: "Share this session",
    description: "Export the session as Markdown, HTML, a gist, or a shareable GitHub link."
  },
  {
    command: "/fork",
    title: "Fork this session",
    description: "Create a new session from the current context without losing this one."
  }
];

const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element])
);

await refresh();
connectEvents();
bindEvents();
applyView();
syncSidebarAccessibility();
window.matchMedia("(max-width: 900px)").addEventListener("change", syncSidebarAccessibility);

async function refresh({ preserveSelection = true } = {}) {
  const [sessions, stats] = await Promise.all([
    api(`/api/sessions?filter=${encodeURIComponent(state.filter)}&q=${encodeURIComponent(state.query)}`),
    api("/api/stats")
  ]);
  state.sessions = sessions;
  elements.wrappedCount.textContent = stats.wrapped || 0;
  elements.activeCount.textContent = stats.active || 0;
  elements.pausedCount.textContent = stats.paused || 0;
  renderSessionList();
  const hasSelected = preserveSelection && sessions.some((session) => session.id === state.selectedId);
  const nextId = hasSelected ? state.selectedId : sessions[0]?.id;
  if (nextId) await selectSession(nextId);
  else renderEmpty();
  if (state.view === "board") await refreshBoard();
  applyView();
}

function bindEvents() {
  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelector(".filter.active")?.classList.remove("active");
      document.querySelectorAll(".filter").forEach((item) => item.setAttribute("aria-pressed", "false"));
      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");
      state.filter = button.dataset.filter;
      await refresh({ preserveSelection: false });
    });
  });
  elements.searchInput.addEventListener("input", debounce(async (event) => {
    state.query = event.target.value;
    if (state.view === "board") renderProjectList();
    else await refresh({ preserveSelection: false });
  }, 180));
  elements.refreshButton.addEventListener("click", () => refresh());
  elements.resumeMainButton.addEventListener("click", resumeSelected);
  elements.openCopilotButton.addEventListener("click", resumeSelected);
  elements.repoChip.addEventListener("click", () => action("folder"));
  elements.sessionIdChip.addEventListener("click", copyResumeCommand);
  elements.moreButton.addEventListener("click", () => elements.moreMenu.classList.toggle("hidden"));
  elements.moreMenu.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    elements.moreMenu.classList.add("hidden");
    await action(button.dataset.action);
  });
  elements.emptyState.querySelector("[data-action]")?.addEventListener("click", async (event) => {
    await action(event.currentTarget.dataset.action);
  });
  document.addEventListener("click", (event) => {
    if (!elements.moreButton.contains(event.target) && !elements.moreMenu.contains(event.target)) {
      elements.moreMenu.classList.add("hidden");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      elements.searchInput.focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommandPalette();
    }
    if (!elements.commandPalette.classList.contains("hidden")) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveCommandSelection(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveCommandSelection(-1);
      } else if (event.key === "Enter" && document.activeElement === elements.commandSearch) {
        event.preventDefault();
        copySelectedCommand();
      }
    }
    if (event.key === "Escape") {
      closeDialog();
      closeWorkItemDialog();
      closeCommandPalette();
      closeSidebar();
    }
  });
  document.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openDialog(button.dataset.edit));
  });
  elements.editForm.addEventListener("submit", saveEdit);
  elements.cancelEdit.addEventListener("click", closeDialog);
  elements.editDialog.addEventListener("click", (event) => {
    if (event.target === elements.editDialog) closeDialog();
  });
  elements.taskForm.addEventListener("submit", addTask);
  elements.workItemForm.addEventListener("submit", addWorkItem);
  elements.linkWorkItemButton.addEventListener("click", openWorkItemDialog);
  elements.closeWorkItemDialog.addEventListener("click", closeWorkItemDialog);
  elements.workItemDialog.addEventListener("click", (event) => {
    if (event.target === elements.workItemDialog) closeWorkItemDialog();
  });
  elements.trackProjectButton.addEventListener("click", toggleProjectTracking);
  elements.mobileMenu.addEventListener("click", openSidebar);
  elements.closeSidebar.addEventListener("click", closeSidebar);
  elements.sidebarBackdrop.addEventListener("click", closeSidebar);
  elements.themeButton.addEventListener("click", toggleTheme);
  elements.commandPaletteButton.addEventListener("click", openCommandPalette);
  elements.commandSearch.addEventListener("input", () => {
    state.commandIndex = 0;
    renderCommandPalette();
  });
  elements.commandPalette.addEventListener("click", (event) => {
    if (event.target === elements.commandPalette) closeCommandPalette();
  });
  elements.projectSelect.addEventListener("change", async () => {
    state.selectedProjectId = elements.projectSelect.value;
    localStorage.setItem("sessionHub.projectId", state.selectedProjectId);
    await refreshBoard();
  });
  elements.openProjectButton.addEventListener("click", async () => {
    if (!state.selectedProjectId) return;
    state.view = "sessions";
    localStorage.setItem("sessionHub.view", "sessions");
    await selectSession(state.selectedProjectId);
    applyView();
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.view = button.dataset.view;
      localStorage.setItem("sessionHub.view", state.view);
      if (state.view === "board") {
        state.query = "";
        elements.searchInput.value = "";
        await refreshBoard();
        applyView();
      } else {
        state.query = "";
        elements.searchInput.value = "";
        await refresh();
      }
    });
  });
  bindBoardDropzones();
}

function openCommandPalette() {
  modalReturnFocus = document.activeElement;
  state.commandIndex = 0;
  elements.commandSearch.value = "";
  elements.commandPalette.classList.remove("hidden");
  renderCommandPalette();
  elements.commandSearch.focus();
}

function closeCommandPalette() {
  const wasOpen = !elements.commandPalette.classList.contains("hidden");
  elements.commandPalette.classList.add("hidden");
  if (wasOpen) modalReturnFocus?.focus();
}

function filteredCommands() {
  const query = elements.commandSearch.value.trim().toLowerCase();
  return sessionHubCommands.filter((item) =>
    !query || [item.command, item.title, item.description].some((value) => value.toLowerCase().includes(query))
  );
}

function renderCommandPalette() {
  const commands = filteredCommands();
  state.commandIndex = Math.max(0, Math.min(state.commandIndex, Math.max(0, commands.length - 1)));
  elements.commandList.replaceChildren();
  commands.forEach((item, index) => {
    const row = element("button", `command-item${index === state.commandIndex ? " selected" : ""}`);
    const command = element("code", "", item.command);
    const copy = element("span", "command-copy");
    copy.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 7V3h13v13h-4v5H3V7h5Zm2 0h7v7h2V5h-9v2Zm5 2H5v10h10V9Z"/></svg>Copy';
    const details = element("div");
    details.append(element("strong", "", item.title), element("span", "", item.description));
    row.append(command, details, copy);
    row.addEventListener("mouseenter", () => {
      state.commandIndex = index;
      renderCommandSelection();
    });
    row.addEventListener("click", () => copyCommand(item.command));
    elements.commandList.append(row);
  });
  if (!commands.length) elements.commandList.append(element("p", "board-empty", "No matching commands"));
}

function moveCommandSelection(direction) {
  const commands = filteredCommands();
  if (!commands.length) return;
  state.commandIndex = (state.commandIndex + direction + commands.length) % commands.length;
  renderCommandSelection();
}

function renderCommandSelection() {
  [...elements.commandList.querySelectorAll(".command-item")].forEach((item, index) => {
    item.classList.toggle("selected", index === state.commandIndex);
  });
  elements.commandList.querySelector(".command-item.selected")?.scrollIntoView({ block: "nearest" });
}

function copySelectedCommand() {
  const command = filteredCommands()[state.commandIndex];
  if (command) copyCommand(command.command);
}

async function copyCommand(command) {
  try {
    await navigator.clipboard.writeText(command);
    closeCommandPalette();
    toast(`${command} copied — paste it into Copilot CLI`);
  } catch {
    toast(`Copy failed. Type ${command} in Copilot CLI.`, true);
  }
}

function connectEvents() {
  const stream = new EventSource("/api/events");
  stream.addEventListener("sessions-changed", () => state.view === "board" ? refreshBoard() : refresh());
}

function renderSessionList() {
  elements.sessionList.replaceChildren();
  for (const session of state.sessions) {
    const button = document.createElement("button");
    button.className = `session-item${session.id === state.selectedId ? " selected" : ""}`;
    button.dataset.id = session.id;
    button.setAttribute("aria-current", session.id === state.selectedId ? "true" : "false");
    const copy = element("span", "session-copy");
    const title = element("strong", "", session.title);
    const workspace = session.repository ? basename(session.repository) : basename(session.cwd) || "No workspace";
    const context = element("span", "session-context-line", session.isProject ? `Project · ${workspace}` : workspace);
    const visibleMatch = session.searchMatch && session.searchMatch.type !== "title";
    const previewText = visibleMatch
      ? `Matched ${session.searchMatch.type}: ${session.searchMatch.text}`
      : session.summary || session.lastAction || session.nextAction || "No checkpoint summary yet";
    const preview = element("span", `session-preview${visibleMatch ? " matched" : ""}`, previewText);
    copy.append(title, context, preview);
    const time = element("span", `session-time${session.pinned ? " pin" : ""}`, session.pinned ? "Pinned" : relativeTime(session.updatedAt));
    button.append(copy, time);
    button.addEventListener("click", async () => {
      await selectSession(session.id);
      closeSidebar();
    });
    elements.sessionList.append(button);
  }
  if (!state.sessions.length) {
    elements.sessionList.append(element("p", "empty-copy", "No sessions match this view."));
  }
}

async function selectSession(id) {
  state.selectedId = id;
  localStorage.setItem("sessionHub.selectedId", id);
  state.selected = await api(`/api/sessions/${encodeURIComponent(id)}`);
  document.querySelectorAll(".session-item").forEach((item) => {
    const selected = item.dataset.id === id;
    item.classList.toggle("selected", selected);
    item.setAttribute("aria-current", selected ? "true" : "false");
  });
  renderDetail();
}

function renderDetail() {
  const session = state.selected;
  elements.emptyState.classList.add("hidden");
  elements.detailContent.classList.remove("hidden");
  elements.sessionTitle.textContent = session.title;
  elements.sessionSummary.textContent = session.summary || "No AI checkpoint yet. Use /wrap before leaving this session.";
  elements.statusBadge.textContent = session.status;
  elements.statusBadge.className = `badge ${session.status}`;
  elements.updatedLabel.textContent = `Updated ${relativeTime(session.updatedAt)}`;
  elements.projectBadge.classList.toggle("hidden", !session.isProject);
  elements.importedBadge.classList.toggle("hidden", !session.imported);
  elements.reviewBadge.classList.toggle("hidden", !session.needsReview);
  elements.nextAction.textContent = session.nextAction || "Run /wrap to create a recommended next step.";
  elements.lastAction.textContent = session.lastAction || "No checkpoint has been saved yet.";
  elements.repoChip.querySelector("span").textContent = basename(session.repository) || basename(session.cwd) || "Workspace";
  elements.repoChip.title = session.cwd || "No working directory";
  elements.branchChip.querySelector("span").textContent = session.branch || "No branch";
  elements.sessionIdChip.querySelector("span").textContent = `Session ID: ${shortSessionId(session.id)}`;
  elements.sessionIdChip.title = `Copy copilot --resume=${session.id}`;
  elements.sessionDuration.textContent = formatDuration(session.startedAt, session.endedAt || Date.now());
  renderSessionMetrics(session.metrics);
  elements.trackProjectButton.classList.toggle("tracked", session.isProject);
  elements.trackProjectButton.querySelector("span").textContent = session.isProject ? "Stop tracking project" : "Track as project";
  renderFiles();
  renderTasks();
  renderWorkItems();
  renderTimeline();
  const pinButton = elements.moreMenu.querySelector('[data-action="pin"]');
  pinButton.textContent = session.pinned ? "Unpin session" : "Pin session";
  const trackButton = elements.moreMenu.querySelector('[data-action="track-project"]');
  trackButton.textContent = session.isProject ? "Stop tracking project" : "Track as project";
  const archiveButton = elements.moreMenu.querySelector('[data-action="archive"]');
  archiveButton.textContent = session.archived ? "Restore session" : "Archive session";
}

function renderFiles() {
  const files = state.selected.files || [];
  const status = state.selected.fileHistoryStatus || "unavailable";
  const messages = {
    current: `${state.selected.fileCount || files.length} recorded`,
    empty: "No files recorded",
    stale: state.selected.fileHistorySyncedAt
      ? `Last updated ${relativeTime(state.selected.fileHistorySyncedAt)}`
      : "Showing last-known files",
    unavailable: "File history unavailable"
  };
  elements.fileHistoryMessage.textContent = messages[status] || messages.unavailable;
  elements.fileHistoryMessage.className = `file-history-status ${status}`;
  elements.fileList.replaceChildren();
  for (const file of files) {
    const item = element("li", "file-item");
    item.append(
      element("span", "file-path", file.displayPath),
      element("small", "", file.outsideWorkspace ? "Outside workspace" : formatToolName(file.toolName))
    );
    elements.fileList.append(item);
  }
  if (!files.length) {
    const text = status === "empty"
      ? "Copilot did not record any worked-on files for this session."
      : "File evidence is not available yet. The checkpoint summary is still usable.";
    elements.fileList.append(element("li", "empty-copy", text));
  } else if (state.selected.filesTruncated) {
    elements.fileList.append(element("li", "empty-copy", `Showing the first ${files.length} files.`));
  }
}

function renderTasks() {
  const tasks = (state.selected.tasks || []).filter((task) => !task.completed);
  elements.taskProgress.textContent = `${tasks.length} open`;
  elements.taskList.replaceChildren();
  for (const task of tasks) {
    const row = element("div", `task-item${task.completed ? " completed" : ""}`);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-check";
    checkbox.checked = task.completed;
    checkbox.addEventListener("change", async () => {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", body: { completed: checkbox.checked } });
      await selectSession(state.selectedId);
    });
    const text = element("p", "", task.text);
    const remove = element("button", "delete-task");
    remove.setAttribute("aria-label", "Delete task");
    remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 7h10l-1 14H8L7 7Zm2-4h6l1 2h4v2H4V5h4l1-2Z"/></svg>';
    remove.addEventListener("click", async () => {
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });
      await selectSession(state.selectedId);
    });
    row.append(checkbox, text, remove);
    elements.taskList.append(row);
  }
  if (!tasks.length) elements.taskList.append(element("p", "empty-copy", "No unfinished checklist items detected."));
}

function renderWorkItems() {
  const workItems = state.selected.workItems || [];
  elements.workItemList.replaceChildren();
  elements.headerWorkItems.replaceChildren();
  for (const item of workItems) {
    const headerLink = element("a", "header-work-item", `${item.type} #${item.workItemId}`);
    headerLink.href = item.url;
    headerLink.target = "_blank";
    headerLink.rel = "noreferrer";
    headerLink.title = item.title || `Work item ${item.workItemId}`;
    elements.headerWorkItems.append(headerLink);
    const row = element("div", "work-item");
    row.append(element("span", "work-item-type", item.type));
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.title ? `${item.title} · #${item.workItemId}` : `Work item #${item.workItemId}`;
    const remove = element("button");
    remove.setAttribute("aria-label", `Unlink work item ${item.workItemId}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 7h10l-1 14H8L7 7Zm2-4h6l1 2h4v2H4V5h4l1-2Z"/></svg>';
    remove.addEventListener("click", async () => {
      await api(`/api/work-items/${item.id}`, { method: "DELETE" });
      await selectSession(state.selectedId);
    });
    row.append(link, remove);
    elements.workItemList.append(row);
  }
  if (!workItems.length) {
    elements.workItemList.append(element("p", "empty-copy", "No work items linked yet."));
  }
}

function openWorkItemDialog() {
  if (!state.selected) return;
  modalReturnFocus = document.activeElement;
  elements.workItemDialog.classList.remove("hidden");
  elements.workItemUrl.focus();
}

function closeWorkItemDialog() {
  const wasOpen = !elements.workItemDialog.classList.contains("hidden");
  elements.workItemDialog.classList.add("hidden");
  if (wasOpen) modalReturnFocus?.focus();
}

function renderTimeline() {
  elements.timeline.replaceChildren();
  const questions = state.selected.questions?.length
    ? state.selected.questions
    : state.selected.initialQuestion ? [state.selected.initialQuestion] : [];
  elements.questionCount.textContent = `${questions.length} ${questions.length === 1 ? "item" : "items"}`;
  elements.sessionQuestions.replaceChildren();
  for (const question of questions) {
    const className = question.endsWith(" skill was called.") ? "skill-call" : "";
    elements.sessionQuestions.append(element("li", className, question));
  }
  if (!questions.length) {
    elements.sessionQuestions.append(element("li", "", "The questions were not recorded for this session."));
  }
  elements.sessionQuestions.closest(".session-question").classList.toggle("empty", !questions.length);
  const events = state.selected.events || [];
  events.slice(0, 8).forEach((event) => {
    const item = element("div", "timeline-item");
    const timestamp = new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    item.append(
      element("time", "", timestamp),
      element("span", `log-level ${logLevel(event.type)}`, event.type.replaceAll("-", " ")),
      element("p", "", event.detail),
      element("small", "", relativeTime(event.created_at))
    );
    elements.timeline.append(item);
  });
  if (!events.length) elements.timeline.append(element("p", "empty-copy", "No activity recorded."));
}

function renderEmpty() {
  state.selected = null;
  elements.detailContent.classList.add("hidden");
  elements.emptyState.classList.remove("hidden");
  if (state.query.trim()) {
    elements.emptyTitle.textContent = "No sessions match that search";
    elements.emptyCopy.textContent = "Try another task, project, folder, action, or file name.";
    elements.emptyAction.textContent = "Clear search";
    elements.emptyAction.dataset.action = "clear-search";
  } else if (state.filter === "wrapped") {
    elements.emptyTitle.textContent = "No wrapped sessions yet";
    elements.emptyCopy.textContent = "Run /wrap in a Copilot session to save its summary, stopping point, and next action.";
    elements.emptyAction.textContent = "Show active sessions";
    elements.emptyAction.dataset.action = "show-active";
  } else {
    elements.emptyTitle.textContent = `No ${state.filter} sessions`;
    elements.emptyCopy.textContent = "Choose another status or return to your wrapped sessions.";
    elements.emptyAction.textContent = "Show wrapped sessions";
    elements.emptyAction.dataset.action = "show-wrapped";
  }
}

function applyView() {
  const boardActive = state.view === "board";
  const searching = Boolean(state.query.trim());
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  elements.boardView.classList.toggle("hidden", !boardActive);
  elements.topActions.classList.toggle("hidden", boardActive);
  elements.topbarLabel.textContent = boardActive ? "Projects" : "Session details";
  elements.topbarDetail.textContent = boardActive ? "A secondary delivery workspace" : "What happened and where to continue";
  document.querySelector(".sidebar").classList.toggle("board-mode", boardActive);
  elements.sidebarHeadingLabel.textContent = boardActive ? "Tracked projects" : "Recent work";
  elements.searchInput.placeholder = boardActive ? "Search tracked projects" : "Task, project, folder, or file";
  elements.statusFilters.classList.toggle("hidden", boardActive || searching);
  if (searching && !boardActive) elements.sidebarHeadingLabel.textContent = "Search results across all history";
  if (boardActive) {
    renderProjectList();
    elements.detailContent.classList.add("hidden");
    elements.emptyState.classList.add("hidden");
  } else if (state.selected) {
    elements.detailContent.classList.remove("hidden");
    elements.emptyState.classList.add("hidden");
  } else {
    elements.detailContent.classList.add("hidden");
    elements.emptyState.classList.remove("hidden");
  }
}

async function refreshBoard() {
  state.projects = await api("/api/projects");
  const preferred = state.projects.some((project) => project.id === state.selectedProjectId)
    ? state.selectedProjectId
    : (state.selected?.isProject && state.projects.some((project) => project.id === state.selected.id)
      ? state.selected.id
      : state.projects[0]?.id);
  state.selectedProjectId = preferred || "";
  if (state.selectedProjectId) localStorage.setItem("sessionHub.projectId", state.selectedProjectId);
  elements.projectSelect.replaceChildren();
  state.projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = `${project.title} · ${project.openTaskCount} open`;
    option.selected = project.id === state.selectedProjectId;
    elements.projectSelect.append(option);
  });
  renderProjectList();
  const hasProject = Boolean(state.selectedProjectId);
  elements.noProjects.classList.toggle("hidden", hasProject);
  elements.coachStrip.classList.toggle("hidden", !hasProject);
  elements.projectSelect.disabled = !hasProject;
  elements.openProjectButton.disabled = !hasProject;
  elements.boardSummary.classList.toggle("hidden", !hasProject);
  elements.kanbanBoard.classList.toggle("hidden", !hasProject);
  elements.boardWorkItems.replaceChildren();
  if (!hasProject) return;

  const board = await api(`/api/board?sessionId=${encodeURIComponent(state.selectedProjectId)}`);
  elements.coachStrip.classList.remove("hidden");
  elements.coachNextAction.textContent = board.project.nextAction || "Run /kanban to generate an ordered execution plan.";
  elements.boardOpenCount.textContent = board.total - (board.counts.done || 0);
  elements.boardProgressCount.textContent = board.counts.in_progress || 0;
  elements.boardBlockedCount.textContent = board.counts.blocked || 0;
  elements.boardDoneCount.textContent = board.counts.done || 0;
  for (const item of board.workItems || []) {
    const link = element("a", "board-work-item", `${item.type} #${item.workItemId}`);
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = item.title || `Work item ${item.workItemId}`;
    elements.boardWorkItems.append(link);
  }

  if (!board.workItems?.length) {
    elements.boardWorkItems.append(element("span", "muted", "No work items linked"));
  }
  for (const status of ["backlog", "next", "in_progress", "blocked", "done"]) {
    const count = board.counts[status] || 0;
    document.querySelector(`[data-count="${status}"]`).textContent = count;
    const container = document.querySelector(`[data-dropzone="${status}"]`);
    container.replaceChildren();
    const tasks = board.tasks.filter((task) => task.status === status);
    tasks.forEach((task) => container.append(renderBoardCard(task)));
    if (!tasks.length) container.append(element("p", "board-empty", "Drop an item here"));
  }
}

function logLevel(type) {
  if (type.includes("error") || type.includes("failure")) return "error";
  if (type.includes("checkpoint") || type.includes("resume")) return "success";
  if (type.includes("end")) return "warning";
  return "info";
}

function renderProjectList() {
  if (state.view !== "board") return;
  const query = state.query.trim().toLowerCase();
  const projects = state.projects.filter((project) => {
    if (!query) return true;
    return [
      project.title,
      project.summary,
      project.repository,
      project.cwd,
      ...(project.files || []).map((file) => file.displayPath)
    ]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  elements.sessionList.replaceChildren();
  for (const project of projects) {
    const button = document.createElement("button");
    button.className = `session-item${project.id === state.selectedProjectId ? " selected" : ""}`;
    button.dataset.id = project.id;
    const copy = element("span", "session-copy");
    copy.append(
      element("strong", "", project.title),
      element("span", "", `${project.openTaskCount} open · ${project.workItemCount} work items`)
    );
    const time = element("span", "session-time", relativeTime(project.updatedAt));
    button.append(copy, time);
    button.addEventListener("click", async () => {
      state.selectedProjectId = project.id;
      localStorage.setItem("sessionHub.projectId", project.id);
      await refreshBoard();
      document.querySelector(".sidebar").classList.remove("open");
    });
    elements.sessionList.append(button);
  }
  if (!projects.length) {
    elements.sessionList.append(element("p", "empty-copy", state.projects.length ? "No projects match your search." : "No sessions are tracked as projects yet."));
  }
}

function renderBoardCard(task) {
  const card = element("article", `kanban-card${task.status === "done" ? " done-card" : ""}`);
  card.draggable = true;
  card.dataset.taskId = task.id;
  card.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", String(task.id));
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));

  const session = element("div", "card-session");
  session.append(element("span", "", task.sessionTitle));
  const open = element("button");
  open.title = "Open session";
  open.setAttribute("aria-label", `Open ${task.sessionTitle}`);
  open.innerHTML = '<svg viewBox="0 0 24 24"><path d="m13 5 7 7-7 7-1.4-1.4 4.6-4.6H4v-2h12.2l-4.6-4.6L13 5Z"/></svg>';
  open.addEventListener("click", async () => {
    state.view = "sessions";
    localStorage.setItem("sessionHub.view", "sessions");
    await selectSession(task.sessionId);
    applyView();
  });
  session.append(open);

  const text = element("p", "card-text", task.text);
  const meta = element("div", "card-meta");
  meta.append(element("span", "", basename(task.repository) || basename(task.cwd) || "Workspace"));
  const select = document.createElement("select");
  select.className = "card-status";
  const labels = { backlog: "Backlog", next: "Next", in_progress: "In progress", blocked: "Blocked", done: "Done" };
  Object.entries(labels).forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = task.status === value;
    select.append(option);
  });
  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", async () => {
    await moveTask(task.id, select.value);
  });
  meta.append(select);
  card.append(session, text, meta);
  return card;
}

function bindBoardDropzones() {
  document.querySelectorAll("[data-dropzone]").forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      zone.classList.remove("drag-over");
      const taskId = Number(event.dataTransfer.getData("text/plain"));
      if (taskId) await moveTask(taskId, zone.dataset.dropzone);
    });
  });
}

async function moveTask(taskId, status) {
  await api(`/api/tasks/${taskId}`, { method: "PATCH", body: { status } });
  await refreshBoard();
}

async function action(name) {
  if (name === "clear-search") {
    state.query = "";
    elements.searchInput.value = "";
    await refresh({ preserveSelection: false });
    elements.searchInput.focus();
    return;
  }
  if (name === "show-wrapped" || name === "show-active") {
    const nextFilter = name === "show-active" ? "active" : "wrapped";
    state.filter = nextFilter;
    document.querySelectorAll(".filter").forEach((button) => {
      const active = button.dataset.filter === nextFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    await refresh({ preserveSelection: false });
    return;
  }
  if (name === "import-history") {
    const result = await api("/api/import-history", { method: "POST" });
    if (result.error === "SOURCE_DB_UNAVAILABLE") toast("Copilot session history is unavailable on this machine", true);
    else if (result.error === "SOURCE_SCHEMA_UNSUPPORTED" || result.filesAvailable === false) toast("This Copilot history format does not include worked-on files", true);
    else if (result.imported) toast(`Imported ${result.imported} old sessions`);
    else if (result.fileSessions) toast(`Updated file history for ${result.fileSessions} sessions`);
    else toast("Session history is already up to date");
    await refresh({ preserveSelection: true });
    return;
  }
  if (!state.selected) return;
  if (name === "track-project") {
    await toggleProjectTracking();
  } else if (name === "pin") {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}`, { method: "PATCH", body: { pinned: !state.selected.pinned } });
    toast(state.selected.pinned ? "Session unpinned" : "Session pinned");
    await refresh();
  } else if (name === "archive") {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}`, { method: "PATCH", body: { archived: !state.selected.archived } });
    toast(state.selected.archived ? "Session restored" : "Session archived");
    await refresh({ preserveSelection: false });
  } else if (name === "folder") {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}/folder`, { method: "POST" });
    toast("Opened working directory");
  }
}

async function toggleProjectTracking() {
  if (!state.selected) return;
  const nextValue = !state.selected.isProject;
  await api(`/api/sessions/${encodeURIComponent(state.selected.id)}`, {
    method: "PATCH",
    body: { isProject: nextValue }
  });
  if (nextValue) {
    state.selectedProjectId = state.selected.id;
    localStorage.setItem("sessionHub.projectId", state.selected.id);
  }
  toast(nextValue ? "Session is now a tracked project" : "Project tracking removed");
  await refresh();
}

async function resumeSelected() {
  if (!state.selected) return;
  await api(`/api/sessions/${encodeURIComponent(state.selected.id)}/resume`, { method: "POST" });
  toast("Copilot resume launched in a new terminal");
}

async function copyResumeCommand() {
  if (!state.selected) return;
  const command = `copilot --resume=${state.selected.id}`;
  try {
    await navigator.clipboard.writeText(command);
    toast("Resume command copied");
  } catch {
    toast(`Copy failed. Use: ${command}`, true);
  }
}

function openSidebar() {
  document.querySelector(".sidebar").classList.add("open");
  document.querySelector(".sidebar").removeAttribute("inert");
  elements.sidebarBackdrop.classList.remove("hidden");
  elements.mobileMenu.setAttribute("aria-expanded", "true");
  elements.closeSidebar.focus();
}

function closeSidebar() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar.classList.contains("open")) return;
  sidebar.classList.remove("open");
  elements.sidebarBackdrop.classList.add("hidden");
  elements.mobileMenu.setAttribute("aria-expanded", "false");
  elements.mobileMenu.focus();
  syncSidebarAccessibility();
}

function syncSidebarAccessibility() {
  const sidebar = document.querySelector(".sidebar");
  const mobile = window.matchMedia("(max-width: 900px)").matches;
  if (mobile && !sidebar.classList.contains("open")) sidebar.setAttribute("inert", "");
  else sidebar.removeAttribute("inert");
}

function openDialog(field) {
  if (!state.selected) return;
  modalReturnFocus = document.activeElement;
  const labels = { title: "Session title", summary: "Session summary", lastAction: "Last completed action", nextAction: "Recommended next action" };
  state.editField = field;
  elements.editTitle.textContent = labels[field];
  elements.editInput.value = state.selected[field] || "";
  elements.editDialog.classList.remove("hidden");
  elements.editInput.focus();
}

function closeDialog() {
  const wasOpen = !elements.editDialog.classList.contains("hidden");
  elements.editDialog.classList.add("hidden");
  state.editField = null;
  if (wasOpen) modalReturnFocus?.focus();
}

async function saveEdit(event) {
  event.preventDefault();
  if (!state.editField || !state.selected) return;
  await api(`/api/sessions/${encodeURIComponent(state.selected.id)}`, {
    method: "PATCH",
    body: { [state.editField]: elements.editInput.value }
  });
  closeDialog();
  await selectSession(state.selectedId);
  toast("Checkpoint updated");
}

async function addTask(event) {
  event.preventDefault();
  const text = elements.taskInput.value.trim();
  if (!text || !state.selected) return;
  await api(`/api/sessions/${encodeURIComponent(state.selected.id)}/tasks`, { method: "POST", body: { text } });
  elements.taskInput.value = "";
  await selectSession(state.selectedId);
}

async function addWorkItem(event) {
  event.preventDefault();
  if (!state.selected) return;
  await api(`/api/sessions/${encodeURIComponent(state.selected.id)}/work-items`, {
    method: "POST",
    body: {
      type: elements.workItemType.value,
      url: elements.workItemUrl.value,
      title: elements.workItemTitle.value
    }
  });
  elements.workItemUrl.value = "";
  elements.workItemTitle.value = "";
  state.selectedProjectId = state.selected.id;
  localStorage.setItem("sessionHub.projectId", state.selected.id);
  await selectSession(state.selected.id);
  closeWorkItemDialog();
  toast("Work item linked");
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("sessionHub.theme", next);
}

const savedTheme = localStorage.getItem("sessionHub.theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    toast(result.error || "Request failed", true);
    throw new Error(result.error || `Request failed: ${response.status}`);
  }
  return result;
}

function toast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.style.background = isError ? "var(--cp-danger)" : "var(--cp-accent)";
  elements.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.add("hidden"), 2800);
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function relativeTime(timestamp) {
  if (!timestamp) return "never";
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ranges = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60]
  ];
  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function formatDuration(start, end) {
  if (!start) return "Unknown";
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function renderSessionMetrics(metrics = {}) {
  const tokens = metrics.currentTokens;
  const limit = metrics.contextLimit;
  if (Number.isFinite(tokens)) {
    const percentage = Number.isFinite(limit) && limit > 0 ? Math.round(tokens / limit * 100) : null;
    elements.contextMetric.textContent = percentage === null
      ? formatNumber(tokens)
      : `${percentage}%`;
    elements.contextDetail.textContent = Number.isFinite(limit)
      ? `${formatNumber(tokens)} / ${formatNumber(limit)} tokens`
      : `${formatNumber(tokens)} tokens`;
  } else {
    elements.contextMetric.textContent = "Unavailable";
    elements.contextDetail.textContent = "Wrap to capture";
  }
  if (Number.isFinite(metrics.aiCredits)) {
    elements.creditMetric.textContent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(metrics.aiCredits);
    elements.creditDetail.textContent = "AI credits used";
  } else {
    elements.creditMetric.textContent = "Unavailable";
    elements.creditDetail.textContent = "Wrap to capture";
  }
  elements.modelMetric.textContent = metrics.model || "Unavailable";
  elements.tierMetric.textContent = metrics.contextTier
    ? metrics.contextTier.replaceAll("_", " ")
    : "At last wrap";
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function basename(path = "") {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || "";
}

function shortSessionId(value = "") {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value || "Session ID";
}

function formatToolName(value = "") {
  return value ? value.replaceAll("_", " ").replaceAll("-", " ") : "Worked on";
}

function debounce(fn, milliseconds) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), milliseconds);
  };
}
