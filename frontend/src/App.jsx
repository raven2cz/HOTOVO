import React, { useState, useEffect, useRef } from 'react';
import { api, TOKEN_KEY } from './api';
import TaskItem from './components/TaskItem';
import CalendarView from './components/CalendarView';
import CommandPalette from './components/CommandPalette';
import SettingsModal from './components/SettingsModal';
import Logo from './components/Logo';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderPlus, Settings, CheckCircle2, ListTodo, Plus, Calendar as CalendarIcon,
  Trash2, SlidersHorizontal, Sun, Moon, Info, HelpCircle, Key, FileCode, Check,
  Repeat, Search, Tag, X
} from 'lucide-react';
import { isOverdue, isToday, isThisWeek } from './dateUtils';

export default function App() {
  const [lists, setLists] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedListId, setSelectedListId] = useState(null);
  
  // View states
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'calendar'
  const [darkMode, setDarkMode] = useState(true);
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'pending', 'completed'
  const [searchTerm, setSearchTerm] = useState('');
  const [dueFilter, setDueFilter] = useState('all'); // 'all', 'today', 'week', 'overdue'
  const [tagFilter, setTagFilter] = useState('all');
  
  // UI Modal/Drawer states
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null); // Task object to edit in drawer
  
  // Inputs
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [newTaskRecurrence, setNewTaskRecurrence] = useState('none');
  
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState('#6366f1');
  const [isAddingList, setIsAddingList] = useState(false);

  // Data loading status (surfaced to the user instead of failing silently)
  const [loadError, setLoadError] = useState(null);
  const [tokenInput, setTokenInput] = useState('');
  // Monotonic counter so out-of-order loadData() responses can be discarded
  const loadSeq = useRef(0);
  // Tasks with an in-flight status toggle (prevents double-click double-submit,
  // which for a recurring task would advance the due date twice).
  const togglingTasks = useRef(new Set());
  // In-list search box (focused with the "/" shortcut).
  const searchInputRef = useRef(null);

  // App initialization
  useEffect(() => {
    // Load initial data
    loadData();

    // Two-tier search keyboard model:
    //  - Ctrl/Cmd+K → global Command Palette (jump to any project/task/action)
    //  - "/"        → focus the in-list filter (search within the current project)
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.target;
        const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
        if (!typing && searchInputRef.current) {
          e.preventDefault();
          searchInputRef.current.focus();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Tag filter is project-specific; reset it when switching projects so a stale
  // tag (whose dropdown is then hidden) can't leave the list mysteriously empty.
  useEffect(() => {
    setTagFilter('all');
  }, [selectedListId]);

  // Theme Sync
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const loadData = async () => {
    const seq = ++loadSeq.current;
    try {
      const [allLists, allTasks] = await Promise.all([api.getLists(), api.getTasks()]);
      // Ignore this response if a newer load has started in the meantime.
      if (seq !== loadSeq.current) return;
      setLoadError(null);
      setLists(allLists);
      setTasks(allTasks);

      // Select first list by default if none selected
      if (allLists.length > 0 && !selectedListId) {
        setSelectedListId(allLists[0].id);
      }
    } catch (err) {
      if (seq !== loadSeq.current) return;
      console.error('Error loading data:', err.message);
      setLoadError(err.message);
    }
  };

  // Store an API token in this browser (needed for remote access where the
  // server requires a token - LOCAL_UI_BYPASS=false behind a proxy).
  const saveBrowserToken = () => {
    const t = tokenInput.trim();
    if (!t) return;
    localStorage.setItem(TOKEN_KEY, t);
    setTokenInput('');
    loadData();
  };

  // Lists actions
  const handleCreateList = async (e) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    try {
      const newList = await api.createList({ name: newListName, color: newListColor });
      setLists([...lists, newList]);
      setSelectedListId(newList.id);
      setNewListName('');
      setIsAddingList(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteList = async (listId) => {
    if (!confirm('Opravdu chcete smazat tento projekt a všechny jeho úkoly?')) return;
    try {
      await api.deleteList(listId);
      const remaining = lists.filter(l => l.id !== listId);
      setLists(remaining);
      if (selectedListId === listId) {
        setSelectedListId(remaining[0]?.id || null);
      }
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Task actions
  const handleCreateTask = async (e) => {
    if (e) e.preventDefault();
    if (!newTaskTitle.trim() || !selectedListId) return;

    try {
      const taskData = {
        title: newTaskTitle,
        list_id: selectedListId,
        priority: newTaskPriority,
        due_date: newTaskDueDate || null,
        recurrence: newTaskRecurrence
      };

      await api.createTask(taskData);
      setNewTaskTitle('');
      setNewTaskDueDate('');
      setNewTaskRecurrence('none');
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCreateTaskFromPalette = async (title) => {
    if (!selectedListId) return;
    try {
      await api.createTask({
        title,
        list_id: selectedListId,
        priority: 'medium'
      });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCreateTaskOnCalendarDate = async (title, dateStr) => {
    if (!selectedListId) return;
    try {
      await api.createTask({
        title,
        list_id: selectedListId,
        priority: 'medium',
        due_date: dateStr // date-only (YYYY-MM-DD); avoids timezone drift
      });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleAddSubtask = async (parentId, title) => {
    try {
      await api.createTask({
        title,
        list_id: selectedListId,
        parent_id: parentId,
        priority: 'medium'
      });
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleStatus = async (task) => {
    if (togglingTasks.current.has(task.id)) return; // ignore rapid double-clicks
    togglingTasks.current.add(task.id);
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    try {
      await api.updateTask(task.id, { status: newStatus });
      loadData();
    } catch (err) {
      alert(err.message);
    } finally {
      togglingTasks.current.delete(task.id);
    }
  };

  const handleUpdateTaskDetails = async (e) => {
    e.preventDefault();
    if (!editingTask) return;
    try {
      await api.updateTask(editingTask.id, {
        title: editingTask.title,
        description: editingTask.description,
        priority: editingTask.priority,
        due_date: editingTask.due_date || null,
        list_id: editingTask.list_id,
        recurrence: editingTask.recurrence || 'none',
        tags: Array.isArray(editingTask.tags) ? editingTask.tags : []
      });
      setEditingTask(null);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!confirm('Opravdu chcete smazat tento úkol a všechny jeho podúkoly?')) return;
    try {
      await api.deleteTask(taskId);
      if (editingTask?.id === taskId) setEditingTask(null);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // All distinct tags in the current project (for the tag filter dropdown).
  const availableTags = Array.from(
    new Set(
      tasks
        .filter(t => t.list_id === selectedListId)
        .flatMap(t => (Array.isArray(t.tags) ? t.tags : []))
    )
  ).sort((a, b) => a.localeCompare(b, 'cs'));

  // Get tasks that match filtering, keeping the tree intact: a matching subtask
  // also pulls in its ancestors so it isn't hidden under a non-matching parent.
  const getFilteredTasks = () => {
    const listTasks = tasks.filter(t => t.list_id === selectedListId);
    const noFilters =
      filterPriority === 'all' && filterStatus === 'all' && dueFilter === 'all' &&
      tagFilter === 'all' && !searchTerm.trim();
    if (noFilters) return listTasks;

    const q = searchTerm.trim().toLowerCase();
    // Ignore a tag filter that no longer exists in this project (its dropdown is
    // hidden), so it can't silently hide everything with no way to clear it.
    const effectiveTag = availableTags.includes(tagFilter) ? tagFilter : 'all';
    const matches = listTasks.filter(t => {
      if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (effectiveTag !== 'all' && !(Array.isArray(t.tags) && t.tags.includes(effectiveTag))) return false;
      if (dueFilter === 'today' && !isToday(t.due_date)) return false;
      if (dueFilter === 'week' && !isThisWeek(t.due_date)) return false;
      if (dueFilter === 'overdue' && !isOverdue(t.due_date, t.status)) return false;
      if (q) {
        const hay = `${t.title} ${t.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const byId = new Map(listTasks.map(t => [t.id, t]));
    const keep = new Set(matches.map(t => t.id));
    for (const m of matches) {
      let pid = m.parent_id;
      while (pid && byId.has(pid) && !keep.has(pid)) {
        keep.add(pid);
        pid = byId.get(pid).parent_id;
      }
    }
    return listTasks.filter(t => keep.has(t.id));
  };

  const filteredTasks = getFilteredTasks();
  
  // Root tasks are tasks that don't have a parent (nesting structure starts here)
  const rootTasks = filteredTasks.filter(t => !t.parent_id);

  // Statistics compiling
  const totalTasksCount = tasks.filter(t => t.list_id === selectedListId).length;
  const completedTasksCount = tasks.filter(t => t.list_id === selectedListId && t.status === 'completed').length;
  const progressPercent = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;

  const getProductivityInfo = () => {
    if (progressPercent === 0) return { label: 'Ještě nezačato 💤', color: 'text-slate-400 dark:text-slate-500' };
    if (progressPercent < 30) return { label: 'Na začátku 🏁', color: 'text-amber-500' };
    if (progressPercent < 70) return { label: 'Skvělé tempo 🏃‍♂️', color: 'text-indigo-400' };
    if (progressPercent < 100) return { label: 'Skoro hotovo! 🔥', color: 'text-emerald-400' };
    return { label: 'Vše splněno! 🎉', color: 'text-emerald-500' };
  };

  const productivity = getProductivityInfo();

  const currentList = lists.find(l => l.id === selectedListId);

  return (
    <div className="flex min-h-screen relative overflow-hidden bg-background-light dark:bg-background-dark text-slate-800 dark:text-slate-100 font-sans transition-colors duration-300">
      
      {/* Decorative Blur Background Circles */}
      <div className="absolute top-[-10%] left-[-10%] w-[45vw] h-[45vw] rounded-full bg-indigo-500/10 glow-blob" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[35vw] h-[35vw] rounded-full bg-purple-500/10 glow-blob" />

      {/* Main Container */}
      <div className="flex flex-1 z-10 w-full max-w-[1600px] mx-auto p-4 md:p-6 gap-6 overflow-hidden max-h-screen">
        
        {/* Sidebar Space */}
        <aside className="w-80 hidden md:flex flex-col gap-6 p-5 glass rounded-3xl border border-border-light/50 dark:border-border-dark/30 overflow-y-auto">
          {/* App Brand Title */}
          <div className="flex items-center justify-between pb-3 border-b border-border-light dark:border-border-dark">
            <div className="flex items-center gap-2.5">
              <Logo size={34} className="shadow-glow-primary rounded-[10px]" />
              <div className="flex flex-col leading-none">
                <span className="font-black text-lg font-sans tracking-[0.18em]">HOTOVO</span>
                <span className="text-[10px] text-slate-500 dark:text-slate-500 tracking-wide mt-0.5">úkoly s lehkostí</span>
              </div>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              aria-label={darkMode ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim'}
              className="p-2 rounded-xl border border-border-light dark:border-border-dark hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            >
              {darkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>

          {/* List Workspaces category */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Moje Projekty</span>
              <button
                onClick={() => setIsAddingList(!isAddingList)}
                aria-label="Přidat nový projekt"
                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* List Addition Form */}
            {isAddingList && (
              <form onSubmit={handleCreateList} className="flex flex-col gap-2 p-3 bg-slate-900/40 rounded-2xl border border-border-dark">
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="Název projektu..."
                  className="bg-transparent border-none text-xs text-white focus:outline-none placeholder-slate-500"
                  autoFocus
                />
                
                <div className="flex items-center justify-between gap-2 mt-1">
                  {/* Basic Color dots selectors */}
                  <div className="flex gap-1.5">
                    {['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#f43f5e', '#a855f7'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewListColor(c)}
                        className={`w-4.5 h-4.5 rounded-full border transition-all ${newListColor === c ? 'scale-110 border-white ring-2 ring-indigo-500' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>

                  <div className="flex gap-1">
                    <button
                      type="submit"
                      className="bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold px-2 py-1 rounded text-white"
                    >
                      Přidat
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddingList(false)}
                      className="text-[10px] text-slate-400 hover:text-white px-2 py-1"
                    >
                      Zpět
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* List Category Links */}
            <div className="flex flex-col gap-1">
              {lists.map((list) => {
                const count = tasks.filter(t => t.list_id === list.id && t.status !== 'completed').length;
                return (
                  <div
                    key={list.id}
                    className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                      selectedListId === list.id 
                        ? 'bg-indigo-600/15 border border-indigo-500/20 text-indigo-400 font-bold'
                        : 'border border-transparent hover:bg-slate-200/50 dark:hover:bg-slate-800/30 text-slate-600 dark:text-slate-400'
                    }`}
                    onClick={() => setSelectedListId(list.id)}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: list.color }} />
                      <span className="truncate text-sm tracking-wide">{list.name}</span>
                    </div>
                    
                    <div className="flex items-center gap-1.5">
                      {count > 0 && (
                        <span className="text-[10px] font-extrabold bg-slate-200 dark:bg-slate-900 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">
                          {count}
                        </span>
                      )}
                      
                      {/* Delete button (only show on hover if not default ones, or we can allow deleting any list) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteList(list.id);
                        }}
                        aria-label={`Smazat projekt ${list.name}`}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-400 transition-opacity"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Controls / Settings Buttons */}
          <div className="mt-auto pt-4 border-t border-border-light dark:border-border-dark flex flex-col gap-2.5">
            {/* Quick instructions / Help Info */}
            <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-2xl p-4 flex gap-3 text-xs text-indigo-300 mb-1">
              <Info size={20} className="flex-shrink-0" />
              <div>
                <p className="font-bold mb-1">Klávesové zkratky</p>
                <p className="opacity-85 text-[11px] leading-relaxed">
                  <kbd className="bg-slate-900 border border-border-dark px-1 py-0.5 rounded font-mono text-[10px] text-white">Ctrl + K</kbd> přeskočí kamkoli (projekty, úkoly, akce).{' '}
                  <kbd className="bg-slate-900 border border-border-dark px-1 py-0.5 rounded font-mono text-[10px] text-white">/</kbd> filtruje úkoly v tomto projektu.
                </p>
              </div>
            </div>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-slate-200/50 dark:hover:bg-slate-800/30 text-slate-600 dark:text-slate-400 transition-colors text-sm font-semibold"
            >
              <Settings size={18} />
              <span>Nastavení & Integrace</span>
            </button>
            <a
              href="/api/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-slate-200/50 dark:hover:bg-slate-800/30 text-slate-600 dark:text-slate-400 transition-colors text-sm font-semibold"
            >
              <FileCode size={18} />
              <span>API Dokumentace</span>
            </a>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col gap-6 overflow-y-auto pr-1">

          {/* Data load error banner */}
          {loadError && (
            <div
              role="alert"
              className="flex flex-col gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span>Nepodařilo se načíst data: {loadError}</span>
                <button
                  onClick={loadData}
                  className="font-bold px-3 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 transition-colors flex-shrink-0"
                >
                  Zkusit znovu
                </button>
              </div>
              <form
                onSubmit={(e) => { e.preventDefault(); saveBrowserToken(); }}
                className="flex items-center gap-2"
              >
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Vlož API token (pro vzdálený přístup)"
                  aria-label="API token pro tento prohlížeč"
                  className="flex-1 bg-slate-900 border border-red-500/20 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex-shrink-0"
                >
                  Uložit token
                </button>
              </form>
            </div>
          )}

          {/* Top Panel Actions */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-black font-sans tracking-tight flex items-center gap-2">
                <span>{currentList ? currentList.name : 'Všechny úkoly'}</span>
                {currentList && (
                  <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: currentList.color }} />
                )}
              </h1>
              <p className="text-xs text-slate-400 mt-1">Spravujte své úkoly s lehkostí.</p>
            </div>

            {/* View Mode & Filter Controls */}
            <div className="flex items-center gap-3">
              {/* Tab Selector: List vs Calendar */}
              <div className="flex rounded-xl bg-slate-200 dark:bg-slate-900 p-1 border border-border-light dark:border-border-dark">
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                    viewMode === 'list' 
                      ? 'bg-indigo-600 text-white shadow-glow-primary' 
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <ListTodo size={14} />
                  <span>Seznam</span>
                </button>
                
                <button
                  onClick={() => setViewMode('calendar')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                    viewMode === 'calendar' 
                      ? 'bg-indigo-600 text-white shadow-glow-primary' 
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <CalendarIcon size={14} />
                  <span>Kalendář</span>
                </button>
              </div>

              {/* Mobile Sidebar Trigger Settings button */}
              <button
                onClick={() => setIsSettingsOpen(true)}
                aria-label="Otevřít nastavení"
                className="md:hidden p-2.5 rounded-xl bg-slate-900 border border-border-dark hover:bg-slate-800 text-slate-400"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>

          {/* Statistics Progress Dashboard */}
          {totalTasksCount > 0 && viewMode === 'list' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-5 glass rounded-3xl border border-border-light/50 dark:border-border-dark/30">
              <div className="flex items-center gap-4">
                {/* Circular ring chart indicator */}
                <div className="relative w-14 h-14 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="28" cy="28" r="24" className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="4.5" fill="transparent" />
                    <circle cx="28" cy="28" r="24" className="stroke-indigo-500" strokeWidth="4.5" fill="transparent" 
                      strokeDasharray={150.8}
                      strokeDashoffset={150.8 - (150.8 * progressPercent) / 100}
                    />
                  </svg>
                  <span className="absolute font-extrabold text-xs">{progressPercent}%</span>
                </div>
                <div>
                  <h4 className="font-bold text-sm">Dokončenost projektu</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{completedTasksCount} z {totalTasksCount} úkolů splněno</p>
                </div>
              </div>

              <div className="border-t sm:border-t-0 sm:border-l border-border-light dark:border-border-dark p-2 sm:pl-6 flex flex-col justify-center">
                <span className="text-xs text-slate-500">Zbývající úkoly</span>
                <span className="text-xl font-extrabold font-sans text-indigo-400 mt-0.5">
                  {totalTasksCount - completedTasksCount}
                </span>
              </div>

              <div className="border-t sm:border-t-0 sm:border-l border-border-light dark:border-border-dark p-2 sm:pl-6 flex flex-col justify-center">
                <span className="text-xs text-slate-500">Celková produktivita</span>
                <span className={`text-xl font-extrabold font-sans mt-0.5 ${productivity.color}`}>
                  {productivity.label}
                </span>
              </div>
            </div>
          )}

          {/* Conditional Rendering: List View vs Calendar View */}
          {viewMode === 'calendar' ? (
            <CalendarView 
              tasks={tasks} 
              lists={lists} 
              onCreateTaskOnDate={handleCreateTaskOnCalendarDate} 
              onSelectTask={(task) => {
                setSelectedListId(task.list_id);
                setViewMode('list');
                setEditingTask(task);
                // Scroll to node and highlight after list mount
                setTimeout(() => {
                  const el = document.getElementById(`task-node-${task.id}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('ring-2', 'ring-indigo-500/80');
                    setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-500/80'), 1500);
                  }
                }, 200);
              }}
            />
          ) : (
            <div className="flex flex-col gap-5 flex-1">
              
              {/* Task Creation Input bar */}
              {currentList && (
                <form onSubmit={handleCreateTask} className="flex flex-col sm:flex-row gap-3 p-4 bg-panel-light/75 dark:bg-panel-dark/35 border border-border-light dark:border-border-dark rounded-2xl glass">
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Naplánujte nový úkol..."
                    className="flex-1 bg-transparent border-none text-sm text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none"
                    required
                  />
                  
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                    {/* Priority select */}
                    <select
                      value={newTaskPriority}
                      onChange={(e) => setNewTaskPriority(e.target.value)}
                      className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark text-xs font-semibold px-2.5 py-1.5 rounded-xl focus:outline-none"
                    >
                      <option value="low">🟢 Nízká</option>
                      <option value="medium">🟡 Střední</option>
                      <option value="high">🟠 Vysoká</option>
                      <option value="urgent">🔴 Urgentní</option>
                    </select>

                    {/* Due Date select */}
                    <input
                      type="date"
                      value={newTaskDueDate}
                      onChange={(e) => setNewTaskDueDate(e.target.value)}
                      className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark text-xs font-semibold px-2.5 py-1.5 rounded-xl focus:outline-none text-slate-600 dark:text-slate-300"
                    />

                    {/* Recurrence select */}
                    <select
                      value={newTaskRecurrence}
                      onChange={(e) => setNewTaskRecurrence(e.target.value)}
                      title="Opakování"
                      aria-label="Opakování úkolu"
                      className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark text-xs font-semibold px-2.5 py-1.5 rounded-xl focus:outline-none"
                    >
                      <option value="none">🔁 Bez opakování</option>
                      <option value="daily">🔁 Denně</option>
                      <option value="weekly">🔁 Týdně</option>
                      <option value="monthly">🔁 Měsíčně</option>
                    </select>

                    <button
                      type="submit"
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl px-4 py-2.5 text-xs flex items-center gap-1.5 transition-all shadow-glow-primary"
                    >
                      <Plus size={14} />
                      <span>Přidat</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Search bar + relative due-date quick filters */}
              <div className="flex flex-col sm:flex-row gap-3 px-1">
                <div className="flex items-center gap-2 flex-1 bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark rounded-xl px-3 py-1.5">
                  <Search size={14} className="text-slate-400 flex-shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Filtrovat úkoly v projektu..."
                    aria-label="Filtrovat úkoly v tomto projektu"
                    className="flex-1 bg-transparent border-none text-xs focus:outline-none text-slate-800 dark:text-slate-200 placeholder-slate-500"
                  />
                  {searchTerm ? (
                    <button onClick={() => setSearchTerm('')} aria-label="Vymazat hledání" className="text-slate-400 hover:text-slate-200">
                      <X size={13} />
                    </button>
                  ) : (
                    <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded border border-border-light dark:border-border-dark bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-400 font-mono">/</kbd>
                  )}
                </div>
                <div className="flex rounded-xl bg-slate-200 dark:bg-slate-900 p-1 border border-border-light dark:border-border-dark">
                  {[
                    { k: 'all', l: 'Vše' },
                    { k: 'today', l: 'Dnes' },
                    { k: 'week', l: 'Týden' },
                    { k: 'overdue', l: 'Po termínu' }
                  ].map(({ k, l }) => (
                    <button
                      key={k}
                      onClick={() => setDueFilter(k)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        dueFilter === k
                          ? (k === 'overdue' ? 'bg-rose-600 text-white' : 'bg-indigo-600 text-white shadow-glow-primary')
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Task Filtering Options */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <SlidersHorizontal size={14} />
                  <span>Filtrovat výsledky</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {/* Status selection buttons */}
                  <div className="flex rounded-xl bg-slate-200 dark:bg-slate-900 p-1 border border-border-light dark:border-border-dark">
                    {['all', 'pending', 'completed'].map((st) => {
                      const labels = { all: 'Vše', pending: 'Aktivní', completed: 'Hotové' };
                      return (
                        <button
                          key={st}
                          onClick={() => setFilterStatus(st)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                            filterStatus === st
                              ? 'bg-indigo-600 text-white shadow-glow-primary'
                              : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {labels[st]}
                        </button>
                      );
                    })}
                  </div>

                  {/* Tag filter (only when the project has tags) */}
                  {availableTags.length > 0 && (
                    <select
                      value={tagFilter}
                      onChange={(e) => setTagFilter(e.target.value)}
                      aria-label="Filtrovat podle štítku"
                      className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark text-xs font-semibold px-2.5 py-1 rounded-xl focus:outline-none"
                    >
                      <option value="all">Všechny štítky</option>
                      {availableTags.map((t) => (
                        <option key={t} value={t}>#{t}</option>
                      ))}
                    </select>
                  )}

                  {/* Priority Select filter */}
                  <select
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value)}
                    className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark text-xs font-semibold px-2.5 py-1 rounded-xl focus:outline-none"
                  >
                    <option value="all">Všechny priority</option>
                    <option value="low">🟢 Nízká</option>
                    <option value="medium">🟡 Střední</option>
                    <option value="high">🟠 Vysoká</option>
                    <option value="urgent">🔴 Urgentní</option>
                  </select>
                </div>
              </div>

              {/* Task Nodes Grid / Trees */}
              <div className="flex flex-col gap-2 flex-1 pb-10">
                {rootTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    allTasks={filteredTasks}
                    lists={lists}
                    onToggleStatus={handleToggleStatus}
                    onDelete={handleDeleteTask}
                    onEdit={setEditingTask}
                    onAddSubtask={handleAddSubtask}
                  />
                ))}

                {rootTasks.length === 0 && (
                  <div className="flex flex-col items-center justify-center p-14 rounded-3xl border border-dashed border-border-light dark:border-border-dark text-slate-500 text-center">
                    <CheckCircle2 size={36} className="mb-3 text-slate-600 opacity-60" />
                    <span className="font-semibold text-sm">Žádné úkoly k zobrazení</span>
                    <span className="text-xs text-slate-400 mt-1">Změňte filtry nebo přidejte nový úkol výše.</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Slide-out Drawer Panel for Editing Task details */}
      <AnimatePresence>
        {editingTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-xs flex justify-end"
          >
            {/* Click backdrop to close */}
            <div className="flex-1" onClick={() => setEditingTask(null)} />
            
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: "tween", ease: "easeInOut", duration: 0.3 }}
              className="w-full max-w-md bg-panel-light dark:bg-panel-dark h-full p-6 shadow-2xl border-l border-border-light dark:border-border-dark flex flex-col gap-6 text-slate-800 dark:text-slate-100 overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-3 border-b border-border-light dark:border-border-dark">
                <h3 className="font-bold text-lg font-sans">Upravit detaily úkolu</h3>
                <button 
                  onClick={() => setEditingTask(null)}
                  className="text-xs font-semibold px-3 py-1 rounded bg-slate-200 dark:bg-slate-800"
                >
                  Zavřít
                </button>
              </div>

              <form onSubmit={handleUpdateTaskDetails} className="flex flex-col gap-4 flex-1">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Název úkolu</label>
                  <input
                    type="text"
                    value={editingTask.title}
                    onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                    className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark rounded-xl px-3.5 py-2 text-sm focus:outline-none"
                    required
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Popis / Poznámky</label>
                  <textarea
                    value={editingTask.description || ''}
                    onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })}
                    rows={4}
                    placeholder="Přidejte podrobnější popis..."
                    className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark rounded-xl px-3.5 py-2 text-sm focus:outline-none resize-none"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Projekt / List</label>
                  <select
                    value={editingTask.list_id}
                    disabled={!!editingTask.parent_id}
                    onChange={(e) => setEditingTask({ ...editingTask, list_id: e.target.value })}
                    className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark rounded-xl px-3.5 py-2 text-sm focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                  {editingTask.parent_id && (
                    <span className="text-[11px] text-slate-500">
                      Podúkol je vždy ve stejném projektu jako jeho nadřazený úkol.
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Priorita</label>
                    <select
                      value={editingTask.priority}
                      onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value })}
                      className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark rounded-xl px-3.5 py-2 text-sm focus:outline-none"
                    >
                      <option value="low">🟢 Nízká</option>
                      <option value="medium">🟡 Střední</option>
                      <option value="high">🟠 Vysoká</option>
                      <option value="urgent">🔴 Urgentní</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Termín splnění</label>
                    <input
                      type="date"
                      // Formats date string cleanly for input box
                      value={editingTask.due_date ? editingTask.due_date.split('T')[0] : ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        // Preserve a timed task's time-of-day (and timezone) when
                        // only the date is changed; otherwise store date-only.
                        const original = editingTask.due_date || '';
                        const timePart = original.includes('T') ? original.slice(10) : '';
                        setEditingTask({ ...editingTask, due_date: val ? `${val}${timePart}` : null });
                      }}
                      className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark rounded-xl px-3.5 py-2 text-sm focus:outline-none text-slate-600 dark:text-slate-300"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Opakování</label>
                  <select
                    value={editingTask.recurrence || 'none'}
                    disabled={!!editingTask.parent_id}
                    onChange={(e) => setEditingTask({ ...editingTask, recurrence: e.target.value })}
                    className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark rounded-xl px-3.5 py-2 text-sm focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="none">Bez opakování</option>
                    <option value="daily">🔁 Denně</option>
                    <option value="weekly">🔁 Týdně</option>
                    <option value="monthly">🔁 Měsíčně</option>
                  </select>
                  {editingTask.parent_id ? (
                    <span className="text-[11px] text-slate-500">Opakování lze nastavit jen u hlavních úkolů (ne podúkolů).</span>
                  ) : (
                    editingTask.recurrence && editingTask.recurrence !== 'none' && !editingTask.due_date && (
                      <span className="text-[11px] text-amber-500">Opakování se projeví až po nastavení termínu.</span>
                    )
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">Štítky (oddělené čárkou)</label>
                  <input
                    type="text"
                    value={Array.isArray(editingTask.tags) ? editingTask.tags.join(', ') : ''}
                    onChange={(e) =>
                      setEditingTask({
                        ...editingTask,
                        tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                      })
                    }
                    placeholder="např. práce, urgent, dům"
                    className="bg-slate-200 dark:bg-slate-900 border border-border-light dark:border-border-dark rounded-xl px-3.5 py-2 text-sm focus:outline-none"
                  />
                </div>

                {/* Status Indicator */}
                <div className="bg-slate-900/50 rounded-xl p-3.5 border border-border-dark mt-2 text-xs flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-bold">Vytvořeno:</span>
                    <span>{new Date(editingTask.created_at).toLocaleString('cs-CZ')}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-bold">Poslední úprava:</span>
                    <span>{new Date(editingTask.updated_at).toLocaleString('cs-CZ')}</span>
                  </div>
                  {editingTask.gcal_event_id && (
                    <div className="flex items-center gap-1.5 text-indigo-400 font-bold mt-1">
                      <Check size={12} />
                      <span>Synchronizováno s Google Kalendářem</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 mt-auto">
                  <button
                    type="submit"
                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl px-4 py-2.5 text-sm transition-colors text-center"
                  >
                    Uložit změny
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTask(editingTask.id)}
                    className="bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold rounded-xl px-4 py-2.5 text-sm border border-red-500/20 transition-colors"
                  >
                    Smazat
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Spotlight Command Palette overlay */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        lists={lists}
        tasks={tasks}
        onSelectProject={(id) => setSelectedListId(id)}
        onCreateTask={handleCreateTaskFromPalette}
        onOpenSettings={() => setIsSettingsOpen(true)}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
      />

      {/* Global Settings Configuration and Sync Dashboard Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
