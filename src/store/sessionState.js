function getFirstSessionId(projects) {
  for (const project of projects || []) {
    for (const session of project.sessions || []) {
      return session.id;
    }
  }
  return null;
}

function hasSessionId(projects, sessionId) {
  for (const project of projects || []) {
    for (const session of project.sessions || []) {
      if (session.id === sessionId) return true;
    }
  }
  return false;
}

function resolveProjects(projects, fallbackProjects) {
  return projects?.length ? projects : fallbackProjects;
}

function resolveTheme(theme) {
  if (theme === 'light') return 'light';
  return 'dark';
}

function resolveActiveSessionId(projects, preferredSessionId) {
  if (preferredSessionId && hasSessionId(projects, preferredSessionId)) {
    return preferredSessionId;
  }
  return getFirstSessionId(projects);
}

function removeSessionFromProjects(projects, projectId, sessionId) {
  return (projects || []).map((project) => {
    if (project.id !== projectId) return project;
    return {
      ...project,
      sessions: (project.sessions || []).filter((session) => session.id !== sessionId),
    };
  });
}

function removeProjectFromProjects(projects, projectId) {
  return (projects || []).filter((project) => project.id !== projectId);
}

function getFallbackActiveSessionId(projects, removedSessionIds, currentActiveSessionId) {
  const removedSet = new Set(removedSessionIds || []);
  if (currentActiveSessionId && !removedSet.has(currentActiveSessionId)) {
    return currentActiveSessionId;
  }
  return getFirstSessionId(projects);
}

// ── Group helpers ──────────────────────────────────────────────────────────

function resolveGroups(groups) {
  if (Array.isArray(groups) && groups.length > 0) return groups;
  return [{ id: 'ungrouped', name: '未分组', system: true }];
}

function ensureUngrouped(groups) {
  const hasUngrouped = groups.some((g) => g.id === 'ungrouped');
  if (hasUngrouped) return groups;
  return [{ id: 'ungrouped', name: '未分组', system: true }, ...groups];
}

function getProjectsByGroup(projects, groupId) {
  return (projects || []).filter((p) => {
    if (groupId === 'ungrouped') return !p.groupId;
    return p.groupId === groupId;
  });
}

function getGroupOrder(groups) {
  // Return ordered list of groups with ungrouped always last
  const userGroups = groups.filter((g) => g.id !== 'ungrouped');
  return [...userGroups, { id: 'ungrouped', name: '未分组', system: true }];
}

export {
  getFirstSessionId,
  hasSessionId,
  resolveProjects,
  resolveTheme,
  resolveActiveSessionId,
  removeSessionFromProjects,
  removeProjectFromProjects,
  getFallbackActiveSessionId,
  resolveGroups,
  ensureUngrouped,
  getProjectsByGroup,
  getGroupOrder,
};
