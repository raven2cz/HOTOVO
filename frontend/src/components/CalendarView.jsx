import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Check } from 'lucide-react';

export default function CalendarView({ tasks, lists, onCreateTaskOnDate, onSelectTask }) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Helper arrays for Czech localization
  const monthNames = [
    'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
    'Července', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
  ];
  const dayNames = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

  // Calculate days in the current month
  const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y, m) => {
    // getDay() returns 0 for Sunday, 1 for Monday, etc.
    // Shift so Monday is index 0
    let day = new Date(y, m, 1).getDay();
    return day === 0 ? 6 : day - 1;
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);

  // Navigate months
  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };
  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  // Check if dates are equal (ignoring hours)
  const isSameDate = (dateStr, year, month, day) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
  };

  // Compile calendar grid days
  const calendarCells = [];
  
  // Fill leading empty cells (previous month overlap)
  const prevMonthDays = getDaysInMonth(year, month - 1);
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    calendarCells.push({
      day: prevMonthDays - i,
      isCurrentMonth: false,
      date: new Date(year, month - 1, prevMonthDays - i)
    });
  }

  // Fill current month days
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push({
      day: d,
      isCurrentMonth: true,
      date: new Date(year, month, d)
    });
  }

  // Fill trailing empty cells (next month overlap)
  const remainingCells = 42 - calendarCells.length; // 6 rows of 7 days
  for (let d = 1; d <= remainingCells; d++) {
    calendarCells.push({
      day: d,
      isCurrentMonth: false,
      date: new Date(year, month + 1, d)
    });
  }

  const handleAddQuickTask = (cellDate) => {
    const title = prompt(`Přidat nový úkol pro den ${cellDate.toLocaleDateString('cs-CZ')}:`);
    if (title && title.trim()) {
      // Set to local ISO with noon time to avoid timezone shifts
      const dateStr = new Date(cellDate.getTime() - cellDate.getTimezoneOffset() * 60000)
        .toISOString()
        .split('T')[0];
      onCreateTaskOnDate(title, dateStr);
    }
  };

  return (
    <div className="bg-panel-light dark:bg-panel-dark/45 border border-border-light dark:border-border-dark rounded-2xl p-5 flex flex-col gap-4 text-slate-800 dark:text-slate-100 glass">
      
      {/* Calendar Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border-light dark:border-border-dark">
        <h3 className="font-bold font-sans text-base tracking-wide flex items-center gap-2">
          <span>📅 Kalendář úkolů</span>
          <span className="text-sm font-normal text-slate-400">
            {monthNames[month]} {year}
          </span>
        </h3>
        <div className="flex gap-1">
          <button 
            onClick={handlePrevMonth}
            className="p-1 rounded-lg border border-border-light dark:border-border-dark hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button 
            onClick={handleNextMonth}
            className="p-1 rounded-lg border border-border-light dark:border-border-dark hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Weekdays Labels */}
      <div className="grid grid-cols-7 text-center text-xs font-bold text-slate-500 uppercase tracking-wider pb-1">
        {dayNames.map((name) => (
          <div key={name}>{name}</div>
        ))}
      </div>

      {/* Month Days Grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarCells.map((cell, idx) => {
          // Get tasks due on this cell date
          const cellTasks = tasks.filter(t => 
            isSameDate(t.due_date, cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate())
          );
          
          const isToday = isSameDate(new Date().toISOString(), cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate());

          return (
            <div
              key={idx}
              className={`min-h-[76px] p-2 border border-border-light/40 dark:border-border-dark/30 rounded-xl flex flex-col justify-between group transition-all relative ${
                cell.isCurrentMonth 
                  ? 'bg-panel-light/65 dark:bg-panel-dark/15 hover:border-indigo-500/50' 
                  : 'bg-slate-100/30 dark:bg-slate-900/10 text-slate-500 opacity-40'
              } ${isToday ? 'ring-2 ring-indigo-500/80' : ''}`}
            >
              {/* Day Number and Plus icon */}
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold ${isToday ? 'text-indigo-400 font-extrabold' : ''}`}>
                  {cell.day}
                </span>
                <button
                  onClick={() => handleAddQuickTask(cell.date)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 transition-all scale-75 cursor-pointer"
                  title="Přidat úkol pro tento den"
                >
                  <Plus size={12} />
                </button>
              </div>

              {/* Tasks bullet list inside cell */}
              <div className="flex flex-col gap-0.5 mt-1 overflow-hidden">
                {cellTasks.slice(0, 3).map((task) => {
                  const list = lists.find(l => l.id === task.list_id);
                  const color = list ? list.color : '#cbd5e1';
                  return (
                    <div
                      key={task.id}
                      onClick={(e) => {
                        e.stopPropagation(); // Avoid triggering cell quick task popover
                        onSelectTask && onSelectTask(task);
                      }}
                      className="flex items-center gap-1 text-[10px] truncate max-w-full px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-900 border-l-2 hover:bg-slate-200 dark:hover:bg-slate-850 cursor-pointer transition-colors"
                      style={{ borderLeftColor: color }}
                      title={`${task.title} (Klikněte pro zobrazení v seznamu)`}
                    >
                      {task.status === 'completed' && <Check size={8} className="text-emerald-400 flex-shrink-0" />}
                      <span className={`truncate ${task.status === 'completed' ? 'line-through text-slate-500' : ''}`}>
                        {task.title}
                      </span>
                    </div>
                  );
                })}
                {cellTasks.length > 3 && (
                  <div className="text-[9px] text-slate-400 font-bold pl-1">
                    + {cellTasks.length - 3} další
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
