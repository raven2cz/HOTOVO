// API client. Requests are same-origin (Vite proxies /api to the backend in
// dev; the backend serves the SPA in production), so the local UI is trusted
// via the server's loopback/same-origin rule and needs no token. A token is
// only attached when the user has explicitly stored one (for remote access).
const TOKEN_KEY = 'agent_api_token';

function buildHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Perform a request and surface the server's error message on failure.
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: buildHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    let message = `Požadavek selhal (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

function toQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, val]) => {
    if (val) params.append(key, val);
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  // Tasks
  getTasks: (filters = {}) => request(`/api/tasks${toQuery(filters)}`),
  createTask: (taskData) => request('/api/tasks', { method: 'POST', body: taskData }),
  updateTask: (id, taskData) => request(`/api/tasks/${id}`, { method: 'PUT', body: taskData }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),

  // Lists
  getLists: () => request('/api/lists'),
  createList: (listData) => request('/api/lists', { method: 'POST', body: listData }),
  deleteList: (id) => request(`/api/lists/${id}?confirm=true`, { method: 'DELETE' }),

  // API tokens
  getTokens: () => request('/api/tokens'),
  createToken: (name) => request('/api/tokens', { method: 'POST', body: { name } }),
  deleteToken: (id) => request(`/api/tokens/${id}`, { method: 'DELETE' }),

  // Google Calendar sync
  getSyncConfig: () => request('/api/sync/config'),
  saveSyncConfig: (config) => request('/api/sync/config', { method: 'POST', body: config }),
  getAuthUrl: () => request('/api/sync/auth-url'),
  triggerSync: () => request('/api/sync/run', { method: 'POST' }),
  disconnectSync: () => request('/api/sync/disconnect', { method: 'POST' })
};

export { TOKEN_KEY };
