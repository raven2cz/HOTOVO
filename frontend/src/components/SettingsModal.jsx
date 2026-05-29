import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { X, Key, Calendar, Download, RefreshCw, LogOut, Check, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function SettingsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('sync'); // 'sync', 'api', 'export'
  
  // Google Calendar states
  const [syncConfig, setSyncConfig] = useState({
    gcal_client_id: '',
    gcal_client_secret: '',
    gcal_redirect_uri: '',
    is_connected: false
  });
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  
  // Token states
  const [tokens, setTokens] = useState([]);
  const [newTokenName, setNewTokenName] = useState('');
  const [lastCreatedToken, setLastCreatedToken] = useState(null);
  
  // Error / Loading states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadTokens();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const data = await api.getSyncConfig();
      setSyncConfig(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadTokens = async () => {
    try {
      const data = await api.getTokens();
      setTokens(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.saveSyncConfig({
        gcal_client_id: syncConfig.gcal_client_id,
        gcal_client_secret: syncConfig.gcal_client_secret,
        gcal_redirect_uri: syncConfig.gcal_redirect_uri
      });
      await loadConfig();
      setSyncStatus('Konfigurace uložena. Nyní se můžete připojit.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectGoogle = async () => {
    setError(null);
    try {
      const { url } = await api.getAuthUrl();
      // Open in a popup
      const width = 600, height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      
      const popup = window.open(
        url,
        'Google Autentizace',
        `width=${width},height=${height},top=${top},left=${left}`
      );

      // Listen for callback success message
      const handleMessage = async (event) => {
        if (event.data === 'gcal_auth_success') {
          setSyncStatus('Úspěšně připojeno k Google Kalendáři.');
          await loadConfig();
          window.removeEventListener('message', handleMessage);
        }
      };
      window.addEventListener('message', handleMessage);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!confirm('Opravdu chcete odpojit Google Kalendář? Synchronizace bude vypnuta.')) return;
    setLoading(true);
    try {
      await api.disconnectSync();
      await loadConfig();
      setSyncStatus('Kalendář odpojen.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerSync = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const data = await api.triggerSync();
      setSyncStatus(`Synchronizace dokončena. Úspěšně: ${data.stats.successCount}, Chyby: ${data.stats.errorCount}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateToken = async (e) => {
    e.preventDefault();
    if (!newTokenName.trim()) return;
    try {
      const data = await api.createToken(newTokenName);
      setNewTokenName('');
      setLastCreatedToken(data.token);
      await loadTokens();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteToken = async (id) => {
    if (!confirm('Opravdu chcete tento token zneplatnit? Všichni připojení agenti ztratí přístup.')) return;
    try {
      await api.deleteToken(id);
      await loadTokens();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleExportData = async (format) => {
    try {
      const token = localStorage.getItem('agent_api_token') || 'agent-secret-42-pineapple-token';
      const res = await fetch(`/api/tokens/export-data?format=${format}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Nelze exportovat data');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const fileExtensions = { json: 'json', markdown: 'md', csv: 'csv' };
      a.download = `todo_export_${new Date().toISOString().split('T')[0]}.${fileExtensions[format]}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 15 }}
            transition={{ type: "spring", duration: 0.35 }}
            className="w-full max-w-2xl overflow-hidden glass rounded-2xl shadow-2xl border border-border-light dark:border-border-dark flex flex-col max-h-[85vh] text-slate-800 dark:text-slate-100"
          >
            
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border-light dark:border-border-dark">
              <h2 className="text-xl font-bold font-sans tracking-wide">Nastavení Systému</h2>
              <button 
                onClick={onClose} 
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content Container */}
            <div className="flex flex-1 overflow-hidden">
              
              {/* Tabs Sidebar */}
              <div className="w-48 border-r border-border-light dark:border-border-dark p-4 flex flex-col gap-2">
                <button
                  onClick={() => setActiveTab('sync')}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    activeTab === 'sync'
                      ? 'bg-indigo-600 text-white shadow-glow-primary'
                      : 'hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Calendar size={18} />
                  <span>Google Kalendář</span>
                </button>
                
                <button
                  onClick={() => setActiveTab('api')}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    activeTab === 'api'
                      ? 'bg-indigo-600 text-white shadow-glow-primary'
                      : 'hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Key size={18} />
                  <span>AI Agenti (API)</span>
                </button>

                <button
                  onClick={() => setActiveTab('export')}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    activeTab === 'export'
                      ? 'bg-indigo-600 text-white shadow-glow-primary'
                      : 'hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Download size={18} />
                  <span>Export Dat</span>
                </button>
              </div>

              {/* Main Form Area */}
              <div className="flex-1 p-6 overflow-y-auto">
                {error && (
                  <div className="mb-4 p-3.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm flex items-center gap-2">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                  </div>
                )}
                
                {syncStatus && (
                  <div className="mb-4 p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm flex items-center gap-2">
                    <Check size={18} />
                    <span>{syncStatus}</span>
                  </div>
                )}

                {/* Tab: Google Calendar Sync */}
                {activeTab === 'sync' && (
                  <div className="flex flex-col gap-6">
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Propojení s Google Kalendářem</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Propisujte své termínované úkoly přímo do svého Google Kalendáře. Změna data úkolu v aplikaci jej automaticky posune i v kalendáři.
                      </p>
                    </div>

                    {!syncConfig.is_connected ? (
                      <form onSubmit={handleSaveConfig} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-semibold text-slate-400">Google Client ID</label>
                          <input
                            type="text"
                            value={syncConfig.gcal_client_id}
                            onChange={(e) => setSyncConfig({ ...syncConfig, gcal_client_id: e.target.value })}
                            className="bg-slate-900 border border-border-dark rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder="Zadejte klientské ID z Google Cloud"
                            required
                          />
                        </div>
                        
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-semibold text-slate-400">Google Client Secret</label>
                          <input
                            type="password"
                            value={syncConfig.gcal_client_secret}
                            onChange={(e) => setSyncConfig({ ...syncConfig, gcal_client_secret: e.target.value })}
                            className="bg-slate-900 border border-border-dark rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                            placeholder={syncConfig.has_client_secret ? "••••••••••••••••••••" : "Zadejte klientský tajný klíč"}
                            required={!syncConfig.has_client_secret}
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-semibold text-slate-400">Povolená Redirect URI (callback)</label>
                          <input
                            type="text"
                            value={syncConfig.gcal_redirect_uri}
                            disabled
                            className="bg-slate-950 border border-border-dark text-slate-500 rounded-xl px-3.5 py-2 text-sm select-all cursor-not-allowed"
                          />
                          <span className="text-[11px] text-slate-500">Tuto URL adresu musíte nastavit jako platnou přesměrovací URI ve své vývojářské konzoli Google Cloud.</span>
                        </div>

                        <div className="flex gap-3 mt-2">
                          <button
                            type="submit"
                            disabled={loading}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-medium rounded-xl px-4 py-2 text-sm transition-colors"
                          >
                            {loading ? 'Ukládání...' : 'Uložit nastavení'}
                          </button>
                          
                          {syncConfig.gcal_client_id && (
                            <button
                              type="button"
                              onClick={handleConnectGoogle}
                              className="border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 font-medium rounded-xl px-4 py-2 text-sm transition-all"
                            >
                              Připojit účet Google
                            </button>
                          )}
                        </div>
                      </form>
                    ) : (
                      <div className="bg-slate-900/50 border border-border-dark rounded-2xl p-5 flex flex-col gap-5">
                        <div className="flex items-center gap-3.5">
                          <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                            <Check size={20} />
                          </div>
                          <div>
                            <h4 className="font-semibold">Váš Google účet je připojen</h4>
                            <p className="text-xs text-slate-400">Všechny úkoly s časovým určením se synchronizují.</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-3 pt-2">
                          <button
                            onClick={handleTriggerSync}
                            disabled={syncing}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-medium rounded-xl px-4.5 py-2.5 text-sm flex items-center gap-2 transition-colors"
                          >
                            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
                            <span>{syncing ? 'Synchronizuji...' : 'Spustit plnou synchronizaci'}</span>
                          </button>

                          <button
                            onClick={handleDisconnectGoogle}
                            disabled={loading}
                            className="border border-red-500/30 hover:bg-red-500/10 text-red-400 font-medium rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 transition-colors"
                          >
                            <LogOut size={16} />
                            <span>Odpojit kalendář</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: API & AI Agents */}
                {activeTab === 'api' && (
                  <div className="flex flex-col gap-6">
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Připojení pro AI Agenty</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Vytvořte API tokeny, které umožní vašim AI agentům (např. custom GPTs, Gemini agenti) číst, vytvářet, měnit nebo mazat vaše úkoly a plány.
                      </p>
                    </div>

                    <form onSubmit={handleCreateToken} className="flex gap-2">
                      <input
                        type="text"
                        value={newTokenName}
                        onChange={(e) => setNewTokenName(e.target.value)}
                        placeholder="Název klíče (např. Agent Alpha)"
                        className="flex-1 bg-slate-900 border border-border-dark rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                      <button
                        type="submit"
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl px-4 py-2 text-sm transition-colors"
                      >
                        Generovat token
                      </button>
                    </form>

                    {lastCreatedToken && (
                      <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl p-4 flex flex-col gap-2">
                        <h4 className="text-sm font-semibold">Váš nový API klíč (zobrazí se pouze jednou!):</h4>
                        <code className="bg-slate-950 px-3 py-2 rounded border border-border-dark select-all font-mono text-xs break-all">
                          {lastCreatedToken}
                        </code>
                        <p className="text-[10px] text-amber-500">Zkopírujte si tento token a uložte do konfigurace svého agenta.</p>
                      </div>
                    )}

                    <div className="flex flex-col gap-3">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Aktivní API Klíče</h4>
                      <div className="flex flex-col gap-2">
                        {tokens.map((t) => (
                          <div key={t.id} className="flex items-center justify-between bg-slate-900 border border-border-dark rounded-xl p-3.5">
                            <div>
                              <div className="font-semibold text-sm">{t.name}</div>
                              <div className="font-mono text-xs text-slate-500 break-all select-all">{t.token.substring(0, 10)}••••••••••••••••</div>
                              <div className="text-[10px] text-slate-500 mt-1">Vytvořen: {new Date(t.created_at).toLocaleDateString('cs-CZ')}</div>
                            </div>
                            <button
                              onClick={() => handleDeleteToken(t.id)}
                              className="text-red-400 hover:text-red-300 font-medium text-xs rounded-lg px-2.5 py-1.5 hover:bg-red-500/10 transition-colors"
                            >
                              Zneplatnit
                            </button>
                          </div>
                        ))}
                        {tokens.length === 0 && (
                          <div className="text-center text-sm text-slate-500 py-4">Žádné API tokeny nebyly vytvořeny.</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab: Data Export */}
                {activeTab === 'export' && (
                  <div className="flex flex-col gap-6">
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Exportovat Vaše Úkoly</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Zálohujte si svá data nebo je přeneste do jiných aplikací. Podporujeme formáty přizpůsobené lidem i strojům.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <button
                        onClick={() => handleExportData('json')}
                        className="flex flex-col items-center gap-3 p-5 rounded-2xl border border-border-dark hover:border-indigo-500 bg-slate-900/30 hover:bg-slate-900/60 transition-all text-center group"
                      >
                        <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Download size={22} />
                        </div>
                        <div>
                          <h4 className="font-bold text-sm">Formát JSON</h4>
                          <p className="text-[11px] text-slate-500 mt-1">Kompletní datový export vhodný pro zálohu nebo import do jiných databází.</p>
                        </div>
                      </button>

                      <button
                        onClick={() => handleExportData('markdown')}
                        className="flex flex-col items-center gap-3 p-5 rounded-2xl border border-border-dark hover:border-emerald-500 bg-slate-900/30 hover:bg-slate-900/60 transition-all text-center group"
                      >
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Download size={22} />
                        </div>
                        <div>
                          <h4 className="font-bold text-sm">Formát Markdown</h4>
                          <p className="text-[11px] text-slate-500 mt-1">Čitelný textový dokument se strukturovanými checklisty a poznámkami.</p>
                        </div>
                      </button>

                      <button
                        onClick={() => handleExportData('csv')}
                        className="flex flex-col items-center gap-3 p-5 rounded-2xl border border-border-dark hover:border-amber-500 bg-slate-900/30 hover:bg-slate-900/60 transition-all text-center group"
                      >
                        <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Download size={22} />
                        </div>
                        <div>
                          <h4 className="font-bold text-sm">Formát CSV</h4>
                          <p className="text-[11px] text-slate-500 mt-1">Tabulkový formát oddělený středníkem, ideální pro Excel nebo LibreOffice.</p>
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
