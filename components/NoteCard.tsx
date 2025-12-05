import React from 'react';
import { OrganizedNote } from '../types';
import { CheckSquare, Hash, Lightbulb, Clock } from 'lucide-react';

interface NoteCardProps {
  /** The data object containing the structured note content */
  note: OrganizedNote;
  /** Enables accessible high-contrast styling */
  highContrast?: boolean;
}

/**
 * Displays a single analyzed session note with structured sections for
 * Summary, Action Items, Decisions, and Topics.
 * 
 * Uses semantic HTML (article, header, section, ul) for screen reader accessibility.
 */
const NoteCard: React.FC<NoteCardProps> = ({ note, highContrast = false }) => {
  const baseClasses = highContrast 
    ? "bg-black border-2 border-yellow-400 text-white mb-4 shadow-none p-5"
    : "bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4 shadow-sm hover:shadow-md transition-shadow text-zinc-100";

  const subTextClass = highContrast ? "text-yellow-300" : "text-zinc-400";
  const iconClass = highContrast ? "text-cyan-400" : "text-zinc-500";
  const sectionBg = highContrast ? "bg-zinc-900 border border-white" : "bg-zinc-950/50";
  const highlightText = highContrast ? "text-cyan-300" : "text-emerald-400";
  const highlightText2 = highContrast ? "text-yellow-300" : "text-amber-400";

  return (
    <article className={baseClasses} aria-labelledby={`note-title-${note.timestamp}`}>
      <header className="flex justify-between items-start mb-3">
        <h3 id={`note-title-${note.timestamp}`} className="text-lg font-bold">
          {note.title || "Untitled Session"}
        </h3>
        <span className={`text-xs flex items-center ${subTextClass}`}>
          <Clock size={12} className="mr-1" aria-hidden="true" />
          <time dateTime={note.timestamp}>{new Date(note.timestamp).toLocaleTimeString()}</time>
        </span>
      </header>

      <p className={`text-sm mb-4 leading-relaxed ${subTextClass}`}>
        {note.summary}
      </p>

      <div className="grid grid-cols-1 gap-4" role="list">
        {note.actionItems.length > 0 && (
          <section className={`${sectionBg} p-3 rounded-lg`}>
            <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 flex items-center ${highlightText}`}>
              <CheckSquare size={14} className="mr-1.5" aria-hidden="true" /> Action Items
            </h4>
            <ul className="space-y-1 pl-2">
              {note.actionItems.map((item, idx) => (
                <li key={idx} className={`text-sm flex items-start ${highContrast ? 'text-white' : 'text-zinc-300'}`}>
                  <span className={`mr-2 ${highContrast ? 'text-cyan-400' : 'text-zinc-500'}`} aria-hidden="true">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {note.decisions.length > 0 && (
          <section className={`${sectionBg} p-3 rounded-lg`}>
            <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 flex items-center ${highlightText2}`}>
              <Lightbulb size={14} className="mr-1.5" aria-hidden="true" /> Decisions
            </h4>
            <ul className="space-y-1 pl-2">
              {note.decisions.map((item, idx) => (
                <li key={idx} className={`text-sm flex items-start ${highContrast ? 'text-white' : 'text-zinc-300'}`}>
                  <span className={`mr-2 ${highContrast ? 'text-yellow-400' : 'text-zinc-500'}`} aria-hidden="true">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {note.topics.length > 0 && (
        <footer className="mt-4 flex flex-wrap gap-2">
          {note.topics.map((topic, idx) => (
            <span key={idx} className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${highContrast ? 'bg-zinc-800 text-cyan-300 border-cyan-500' : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'}`}>
              <Hash size={10} className="mr-1" aria-hidden="true" /> {topic}
            </span>
          ))}
        </footer>
      )}
    </article>
  );
};

export default NoteCard;