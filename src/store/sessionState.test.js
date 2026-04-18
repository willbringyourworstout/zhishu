const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getFirstSessionId,
  hasSessionId,
  resolveProjects,
  resolveTheme,
  resolveActiveSessionId,
  removeSessionFromProjects,
  removeProjectFromProjects,
  getFallbackActiveSessionId,
  getProjectTodoStats,
} = require('./sessionState');

const projects = [
  {
    id: 'p1',
    sessions: [{ id: 's1' }, { id: 's2' }],
  },
  {
    id: 'p2',
    sessions: [{ id: 's3' }],
  },
];

test('falls back to the next remaining session when removing the active session', () => {
  const nextProjects = removeSessionFromProjects(projects, 'p1', 's2');
  assert.equal(getFallbackActiveSessionId(nextProjects, ['s2'], 's2'), 's1');
});

test('falls back to another project when deleting the active project', () => {
  const nextProjects = removeProjectFromProjects(projects, 'p1');
  assert.equal(getFallbackActiveSessionId(nextProjects, ['s1', 's2'], 's1'), 's3');
});

test('returns null only when no sessions remain', () => {
  assert.equal(getFirstSessionId([]), null);
  assert.equal(getFallbackActiveSessionId([], ['s1'], 's1'), null);
});

test('detects whether a session id still exists', () => {
  assert.equal(hasSessionId(projects, 's1'), true);
  assert.equal(hasSessionId(projects, 'missing'), false);
});

test('resolves the preferred active session when it still exists', () => {
  assert.equal(resolveActiveSessionId(projects, 's3'), 's3');
});

test('falls back to the first existing session when the preferred one is missing', () => {
  const sparseProjects = [
    { id: 'empty', sessions: [] },
    { id: 'real', sessions: [{ id: 's9' }] },
  ];
  assert.equal(resolveActiveSessionId(sparseProjects, 'missing'), 's9');
});

test('uses fallback projects only when the stored list is empty', () => {
  const fallback = [{ id: 'fallback', sessions: [{ id: 'sf' }] }];
  assert.equal(resolveProjects(projects, fallback), projects);
  assert.equal(resolveProjects([], fallback), fallback);
});

test('getProjectTodoStats returns total and doing counts', () => {
  const todos = [
    { id: 't1', projectId: 'p1', status: 'todo' },
    { id: 't2', projectId: 'p1', status: 'in_progress' },
    { id: 't3', projectId: 'p1', status: 'done' },
    { id: 't4', projectId: 'p2', status: 'in_progress' },
  ];
  const stats = getProjectTodoStats(todos, 'p1');
  assert.equal(stats.total, 3);
  assert.equal(stats.doing, 1);
  const empty = getProjectTodoStats(todos, 'p99');
  assert.equal(empty.total, 0);
  assert.equal(empty.doing, 0);
  const nullSafe = getProjectTodoStats(null, 'p1');
  assert.equal(nullSafe.total, 0);
});

test('resolves theme correctly', () => {
  assert.equal(resolveTheme('dark'), 'dark');
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme(undefined), 'dark');
  assert.equal(resolveTheme('system'), 'dark');
});
