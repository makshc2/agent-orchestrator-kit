import { createStore } from '../store.js';
import { worktreeStore } from '../binding.js';

export { worktreeStore };

export function changeStore(projectDir, ids, changeId, eventId = 'cli') {
  if (changeId == null || changeId === '') return null;
  return createStore({
    projectDir,
    scope: {
      level: 'change',
      ...ids,
      changeId,
      sessionId: null,
      agentId: null,
      eventId,
    },
    pruneIntervalMs: 10 ** 9,
  });
}
