import React, { useState } from 'react';
import { Calendar, Trash2, Edit3, ChevronDown, ChevronRight, Plus, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function TaskItem({
  task,
  allTasks,
  lists,
  onToggleStatus,
  onDelete,
  onEdit,
  onAddSubtask,
  depth = 0
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState('');

  const list = lists.find((l) => l.id === task.list_id);
  const subtasks = allTasks.filter((t) => t.parent_id === task.id);
  const completedSubtasksCount = subtasks.filter((t) => t.status === 'completed').length;
  const subtasksProgressPercent = subtasks.length > 0 ? Math.round((completedSubtasksCount / subtasks.length) * 100) : 0;

  const priorityColors = {
    low: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    medium: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400',
    high: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    urgent: 'bg-rose-500/10 border-rose-500/30 text-rose-400'
  };

  const handleSubtaskSubmit = (e) => {
    e.preventDefault();
    if (!subtaskTitle.trim()) return;
    onAddSubtask(task.id, subtaskTitle);
    setSubtaskTitle('');
    setIsAddingSubtask(false);
  };

  // Convert priority code to human readable text
  const priorityLabels = { low: 'Nízká', medium: 'Střední', high: 'Vysoká', urgent: 'Kritická' };

  return (
    <div className="flex flex-col select-none" id={`task-node-${task.id}`}>
      
      {/* Task Row Container */}
      <div 
        className="group flex items-center justify-between gap-3 p-3.5 rounded-xl border border-border-light/40 dark:border-border-dark/30 bg-panel-light/70 dark:bg-panel-dark/20 hover:bg-slate-200/40 dark:hover:bg-slate-800/20 transition-all mb-1 border-glow-indigo"
        style={{ marginLeft: `${depth * 24}px` }}
      >
        {/* Left column: Checkbox, Title, Date, Priority */}
        <div className="flex items-center gap-3.5 flex-1 min-w-0">
          {/* Custom Checkbox */}
          <input
            type="checkbox"
            checked={task.status === 'completed'}
            onChange={() => onToggleStatus(task)}
            className="w-5 h-5 rounded-lg border-2 border-slate-400 dark:border-slate-600 bg-slate-900 checked:bg-indigo-600 checked:border-indigo-600 text-white flex items-center justify-center cursor-pointer transition-all hover:scale-105"
          />

          <div className="flex flex-col min-w-0 flex-1">
            {/* Title & Metadata Line */}
            <div className="flex items-center flex-wrap gap-2.5 min-w-0">
              <span 
                onClick={() => onEdit(task)}
                className={`text-sm font-semibold tracking-wide cursor-pointer select-text truncate ${
                  task.status === 'completed' 
                    ? 'line-through text-slate-500 dark:text-slate-500 font-normal' 
                    : 'text-slate-800 dark:text-slate-200 hover:text-indigo-400'
                }`}
              >
                {task.title}
              </span>

              {/* Priority badge inline */}
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${priorityColors[task.priority]}`}>
                {priorityLabels[task.priority] || task.priority}
              </span>

              {/* Subtask progress badge inline */}
              {subtasks.length > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                  <span>{completedSubtasksCount}/{subtasks.length} podúkolů ({subtasksProgressPercent}%)</span>
                </span>
              )}

              {/* Due Date badge inline */}
              {task.due_date && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-900 border border-border-light dark:border-border-dark text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Calendar size={10} />
                  <span>{new Date(task.due_date).toLocaleDateString('cs-CZ')}</span>
                </span>
              )}

              {/* Google Sync Badge inline */}
              {task.gcal_event_id && (
                <span 
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center gap-1"
                  title="Synchronizováno s Google Kalendářem"
                >
                  <span className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse" />
                  <span>GCal</span>
                </span>
              )}
            </div>

            {/* Description or Notes (rendered on second line if present) */}
            {task.description && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 max-w-[90%]">
                {task.description}
              </span>
            )}
          </div>
        </div>

        {/* Right column: Action buttons */}
        <div className="flex items-center gap-1">
          {/* Subtasks expand toggle */}
          {subtasks.length > 0 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={isExpanded ? 'Skrýt podúkoly' : 'Zobrazit podúkoly'}
            >
              {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
          )}

          {/* Add Subtask shortcut button */}
          {task.status !== 'completed' && (
            <button
              onClick={() => setIsAddingSubtask(!isAddingSubtask)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Přidat podúkol"
            >
              <Plus size={15} />
            </button>
          )}

          {/* Edit Button */}
          <button
            onClick={() => onEdit(task)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Upravit úkol"
          >
            <Edit3 size={15} />
          </button>

          {/* Delete Button */}
          <button
            onClick={() => onDelete(task.id)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Smazat úkol"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Inline Subtask addition form */}
      <AnimatePresence>
        {isAddingSubtask && (
          <motion.form
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.2 }}
            onSubmit={handleSubtaskSubmit}
            className="flex gap-2 mb-2 p-2 border border-border-light dark:border-border-dark rounded-xl bg-slate-900/40 overflow-hidden"
            style={{ marginLeft: `${(depth + 1) * 24}px` }}
          >
            <input
              type="text"
              value={subtaskTitle}
              onChange={(e) => setSubtaskTitle(e.target.value)}
              placeholder="Název podúkolu..."
              className="flex-1 bg-transparent border-none text-xs focus:outline-none text-slate-200"
              autoFocus
            />
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded px-2.5 py-1"
            >
              Přidat
            </button>
            <button
              type="button"
              onClick={() => setIsAddingSubtask(false)}
              className="text-slate-400 hover:text-white text-[10px] px-2 py-1"
            >
              Zrušit
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Recursive Subtasks Rendering */}
      <AnimatePresence>
        {isExpanded && subtasks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="flex flex-col overflow-hidden"
          >
            {subtasks.map((sub) => (
              <TaskItem
                key={sub.id}
                task={sub}
                allTasks={allTasks}
                lists={lists}
                onToggleStatus={onToggleStatus}
                onDelete={onDelete}
                onEdit={onEdit}
                onAddSubtask={onAddSubtask}
                depth={depth + 1}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
