import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import NoteCard from './NoteCard';
import { OrganizedNote } from '../types';

const mockNote: OrganizedNote = {
  title: "Project Alpha Meeting",
  summary: "Discussed the roadmap for Q1.",
  topics: ["Roadmap", "Q1"],
  actionItems: ["Update Jira", "Email client"],
  decisions: ["Go ahead with Design A"],
  sentiment: "positive",
  timestamp: new Date().toISOString()
};

describe('NoteCard Component', () => {
  it('renders title and summary correctly', () => {
    render(<NoteCard note={mockNote} />);
    
    expect(screen.getByText("Project Alpha Meeting")).toBeDefined();
    expect(screen.getByText("Discussed the roadmap for Q1.")).toBeDefined();
  });

  it('renders action items when present', () => {
    render(<NoteCard note={mockNote} />);
    
    expect(screen.getByText("Action Items")).toBeDefined();
    expect(screen.getByText("Update Jira")).toBeDefined();
  });

  it('renders tags correctly', () => {
    render(<NoteCard note={mockNote} />);
    expect(screen.getByText("Roadmap")).toBeDefined();
    expect(screen.getByText("Q1")).toBeDefined();
  });

  it('does not render Action Items section if empty', () => {
    const emptyActionNote = { ...mockNote, actionItems: [] };
    render(<NoteCard note={emptyActionNote} />);
    
    const actionHeader = screen.queryByText("Action Items");
    expect(actionHeader).toBeNull();
  });
});