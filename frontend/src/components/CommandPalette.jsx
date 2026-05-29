import React, { useState, useEffect, useRef } from 'react';
import { Search, Calendar, Folder, HelpCircle, Settings, RefreshCw, Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CommandPalette({ 
  isOpen, 
  onClose, 
  lists, 
  tasks, 
  onSelectProject, 
  onCreateTask, 
  onOpenSettings,
  darkMode,
  setDarkMode
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle closing when clicking outside or pressing Escape globally
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleGlobalKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isOpen, onClose]);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    const totalResults = filteredItems.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % totalResults);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + totalResults) % totalResults);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        handleSelectItem(filteredItems[selectedIndex]);
      }
    }
  };

  // Compile actions
  const getStaticActions = () => [
    {
      type: 'action',
      id: 'open-settings',
      title: 'Otevřít Nastavení',
      subtitle: 'Správa Google Kalendáře, API tokenů a export dat',
      icon: <Settings size={16} />,
      handler: () => onOpenSettings()
    },
    {
      type: 'action',
      id: 'toggle-theme',
      title: darkMode ? 'Přepnout na Světlý režim' : 'Přepnout na Tmavý režim',
      subtitle: 'Změna barevného schématu aplikace',
      icon: darkMode ? <Sun size={16} /> : <Moon size={16} />,
      handler: () => setDarkMode(!darkMode)
    }
  ];

  // Dynamic items based on query
  const getFilteredItems = () => {
    const actions = getStaticActions();
    
    // 1. Projects/Lists matching
    const matchingLists = lists
      .filter(l => l.name.toLowerCase().includes(query.toLowerCase()))
      .map(l => ({
        type: 'list',
        id: l.id,
        title: `Přejít na projekt: ${l.name}`,
        subtitle: 'Zobrazit úkoly v tomto projektu',
        icon: <Folder size={16} style={{ color: l.color }} />,
        handler: () => onSelectProject(l.id)
      }));

    // 2. Tasks matching
    const matchingTasks = tasks
      .filter(t => t.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5) // Limit to 5 results to keep view clean
      .map(t => ({
        type: 'task',
        id: t.id,
        title: t.title,
        subtitle: `Úkol v projektu: ${lists.find(l => l.id === t.list_id)?.name || ''}`,
        icon: <Calendar size={16} className={t.status === 'completed' ? 'text-emerald-400' : 'text-slate-400'} />,
        handler: () => {
          onSelectProject(t.list_id);
          // Wait briefly, scroll to element if possible (handled in App/TaskList)
          setTimeout(() => {
            const el = document.getElementById(`task-node-${t.id}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      }));

    // 3. Match general actions
    const matchingActions = actions.filter(a => 
      a.title.toLowerCase().includes(query.toLowerCase()) || 
      a.subtitle.toLowerCase().includes(query.toLowerCase())
    );

    // 4. Quick task creator option
    const creatorOption = query.trim() ? [{
      type: 'creator',
      id: 'create-quick-task',
      title: `Vytvořit úkol: "${query}"`,
      subtitle: `Stiskněte Enter pro okamžité přidání do aktuálního projektu`,
      icon: <HelpCircle size={16} className="text-indigo-400" />,
      handler: () => onCreateTask(query)
    }] : [];

    return [...creatorOption, ...matchingLists, ...matchingTasks, ...matchingActions];
  };

  const filteredItems = getFilteredItems();

  const handleSelectItem = (item) => {
    item.handler();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh] bg-slate-950/70 backdrop-blur-sm"
        >
          <motion.div
            ref={containerRef}
            initial={{ scale: 0.97, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: -10 }}
            transition={{ type: "spring", duration: 0.3 }}
            className="w-full max-w-xl overflow-hidden glass rounded-2xl shadow-2xl border border-border-light dark:border-border-dark flex flex-col max-h-[60vh] text-slate-800 dark:text-slate-100"
          >
            {/* Search Input bar */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border-light dark:border-border-dark">
              <Search size={20} className="text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Hledejte úkoly, projekty, akce nebo napište nový úkol..."
                className="w-full bg-transparent border-none text-base focus:outline-none text-slate-900 dark:text-slate-100 placeholder-slate-500"
              />
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded border border-border-dark bg-slate-900 text-[10px] text-slate-400 font-mono">
                ESC
              </kbd>
            </div>

            {/* Results list */}
            <div className="flex-1 overflow-y-auto p-2 min-h-[150px]">
              {filteredItems.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {filteredItems.map((item, idx) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left transition-all ${
                        selectedIndex === idx 
                          ? 'bg-indigo-600 text-white shadow-glow-primary' 
                          : 'hover:bg-slate-200/50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className={`p-1.5 rounded-lg flex-shrink-0 ${
                        selectedIndex === idx ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                      }`}>
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{item.title}</div>
                        <div className={`text-[11px] truncate ${selectedIndex === idx ? 'text-indigo-200' : 'text-slate-400'}`}>
                          {item.subtitle}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-slate-500 text-sm">
                  <Search size={32} className="mb-2 text-slate-600 opacity-60" />
                  <span>Žádné výsledky pro &quot;{query}&quot;</span>
                </div>
              )}
            </div>

            {/* Footer shortcuts helper */}
            <div className="px-4 py-2 bg-slate-900/50 border-t border-border-light dark:border-border-dark flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <div className="flex items-center gap-2">
                <span>↑↓ pro pohyb</span>
                <span>•</span>
                <span>Enter pro výběr</span>
              </div>
              <div>
                <span>Zadání nového úkolu stiskem klávesy</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
