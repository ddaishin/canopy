import { useState, useEffect, useCallback, useRef } from "react";
import type { TerminalTab as TerminalTabType } from "../../types/terminal";
import { TerminalTab } from "./TerminalTab";
import { HOME_TAB_ID } from "../../hooks/useTerminal";

const QUICK_ACTIONS = [
  { label: "Review PR", prompt: "Review the current branch's changes against main. Focus on bugs, edge cases, and code quality. Provide structured findings.", icon: ">" },
  { label: "Fix Tests", prompt: "Find and fix any failing tests. Run the test suite first, then diagnose and fix each failure.", icon: ">" },
  { label: "Commit", prompt: "/commit", icon: "/" },
  { label: "Plan Feature", prompt: "/plan", icon: "/" },
  { label: "Audit Code", prompt: "Perform a code review of recent changes. Check for bugs, security issues, and improvements.", icon: ">" },
  { label: "Simplify", prompt: "/simplify", icon: "/" },
];

interface TerminalTabBarProps {
  tabs: TerminalTabType[];
  activeTabId: string | null;
  splitMode: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onToggleSplit: () => void;
  onNewTerminal: () => void;
  onNewClaudeSession: () => void;
  onNewClaudeWithPrompt?: (prompt: string) => void;
  onReorderTabs?: (fromId: string, toId: string) => void;
  hasDeadTabs?: boolean;
  onCloseAllDead?: () => void;
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  splitMode,
  onSelectTab,
  onCloseTab,
  onToggleSplit,
  onNewTerminal,
  onNewClaudeSession,
  onNewClaudeWithPrompt,
  onReorderTabs,
  hasDeadTabs,
  onCloseAllDead,
}: TerminalTabBarProps) {
  const terminalCount = tabs.filter((t) => !t.isProjectOverview).length;
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showActions) return;
    const handleClick = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [showActions]);

  // Pointer-based tab reorder (avoids conflict with Tauri's native drag-drop)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  const handleDragStart = useCallback((tabId: string) => {
    setDraggingTabId(tabId);
  }, []);

  const handleDragEnter = useCallback((tabId: string) => {
    if (draggingTabId && tabId !== draggingTabId) {
      setDragOverTabId(tabId);
    }
  }, [draggingTabId]);

  // Listen for global mouseup to complete the reorder
  useEffect(() => {
    if (!draggingTabId) return;

    const handleMouseUp = () => {
      if (draggingTabId && dragOverTabId && onReorderTabs) {
        onReorderTabs(draggingTabId, dragOverTabId);
      }
      setDraggingTabId(null);
      setDragOverTabId(null);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [draggingTabId, dragOverTabId, onReorderTabs]);

  return (
    <div className="terminal-tab-bar">
      <div className="terminal-tabs">
        {/* Permanent Home tab */}
        <TerminalTab
          label="Home"
          isActive={activeTabId === HOME_TAB_ID}
          isClaudeSession={false}
          isHomePage={true}
          onClick={() => onSelectTab(HOME_TAB_ID)}
          onClose={() => {}}
        />
        {/* Dynamic tabs */}
        {tabs.map((tab) => (
          <TerminalTab
            key={tab.id}
            tabId={tab.id}
            label={tab.label}
            projectName={tab.projectName}
            isActive={tab.id === activeTabId}
            isClaudeSession={tab.isClaudeSession}
            isWorkspaceAgent={tab.isWorkspaceAgent}
            isProjectOverview={tab.isProjectOverview}
            isDead={tab.dead}
            completedWhileHidden={tab.completedWhileHidden}
            needsAttention={tab.needsAttention}
            isDragOver={dragOverTabId === tab.id}
            onClick={() => onSelectTab(tab.id)}
            onClose={() => onCloseTab(tab.id)}
            onDragStart={onReorderTabs ? handleDragStart : undefined}
            onDragEnter={onReorderTabs ? handleDragEnter : undefined}
          />
        ))}
      </div>
      <div className="terminal-tab-actions">
        {terminalCount >= 2 && (
          <button
            className={`split-view-btn ${splitMode ? "active" : ""}`}
            onClick={onToggleSplit}
            title={splitMode ? "Single view" : "Split view"}
          >
            {splitMode ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="1" width="14" height="14" rx="2" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="1" width="14" height="14" rx="2" />
                <line x1="8" y1="1" x2="8" y2="15" />
              </svg>
            )}
          </button>
        )}
        {hasDeadTabs && (
          <button className="new-tab-btn dead-cleanup" onClick={onCloseAllDead} title="Close all dead tabs">
            Clear dead
          </button>
        )}
        <div className="new-tab-group" ref={actionsRef}>
          <button className="new-tab-btn" onClick={onNewClaudeSession} title="New Claude Session">
            + Claude
          </button>
          {onNewClaudeWithPrompt && (
            <button
              className="new-tab-btn dropdown-toggle"
              onClick={() => setShowActions(!showActions)}
              title="Quick actions"
            >
              {"\u25BE"}
            </button>
          )}
          {showActions && onNewClaudeWithPrompt && (
            <div className="quick-actions-dropdown">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  className="quick-action-item"
                  onClick={() => {
                    onNewClaudeWithPrompt(action.prompt);
                    setShowActions(false);
                  }}
                >
                  <span className="quick-action-icon">{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="new-tab-btn shell" onClick={onNewTerminal} title="New Terminal">
          + Shell
        </button>
      </div>
    </div>
  );
}
