const BASE_URL = ''; // Proxied via Vite dev server

// Helper for standard headers
const getHeaders = () => {
  const token = localStorage.getItem('agent_api_token') || 'agent-secret-42-pineapple-token';
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
};

export const api = {
  // Tasks CRUD
  getTasks: async (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, val]) => {
      if (val) params.append(key, val);
    });
    const res = await fetch(`/api/tasks?${params.toString()}`, {
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Nelze načíst úkoly');
    return res.json();
  },

  createTask: async (taskData) => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(taskData)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Chyba při vytváření úkolu');
    }
    return res.json();
  },

  updateTask: async (id, taskData) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(taskData)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Chyba při aktualizaci úkolu');
    }
    return res.json();
  },

  deleteTask: async (id) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Chyba při mazání úkolu');
    return res.json();
  },

  // Lists CRUD
  getLists: async () => {
    const res = await fetch('/api/lists', {
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Nelze načíst projekty');
    return res.json();
  },

  createList: async (listData) => {
    const res = await fetch('/api/lists', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(listData)
    });
    if (!res.ok) throw new Error('Nelze vytvořit projekt');
    return res.json();
  },

  deleteList: async (id) => {
    const res = await fetch(`/api/lists/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Nelze smazat projekt');
    return res.json();
  },

  // API Tokens CRUD (for AI Agents settings)
  getTokens: async () => {
    const res = await fetch('/api/tokens', {
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Nelze načíst tokeny');
    return res.json();
  },

  createToken: async (name) => {
    const res = await fetch('/api/tokens', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Nelze vytvořit token');
    }
    return res.json();
  },

  deleteToken: async (id) => {
    const res = await fetch(`/api/tokens/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Nelze smazat token');
    }
    return res.json();
  },

  // Sync settings
  getSyncConfig: async () => {
    const res = await fetch('/api/sync/config', {
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Nelze načíst konfiguraci kalendáře');
    return res.json();
  },

  saveSyncConfig: async (config) => {
    const res = await fetch('/api/sync/config', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config)
    });
    if (!res.ok) throw new Error('Nelze uložit konfiguraci kalendáře');
    return res.json();
  },

  getAuthUrl: async () => {
    const res = await fetch('/api/sync/auth-url', {
      headers: getHeaders()
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Nelze vygenerovat autorizační URL');
    }
    return res.json();
  },

  triggerSync: async () => {
    const res = await fetch('/api/sync/run', {
      method: 'POST',
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Synchronizace kalendáře selhala');
    return res.json();
  },

  disconnectSync: async () => {
    const res = await fetch('/api/sync/disconnect', {
      method: 'POST',
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Odpojení kalendáře selhalo');
    return res.json();
  }
};
