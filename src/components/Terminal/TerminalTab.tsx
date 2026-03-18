import type { TabStatus } from "../../types/tab-status";
import { isDoneStatus } from "../../types/tab-status";

interface TerminalTabProps {
  tabId?: string;
  label: string;
  projectName?: string;
  isActive: boolean;
  isClaudeSession: boolean;
  isWorkspaceAgent?: boolean;
  isHomePage?: boolean;
  isProjectOverview?: boolean;
  status?: TabStatus;
  isDragOver?: boolean;
  onClick: () => void;
  onClose: () => void;
  onDragStart?: (tabId: string) => void;
  onDragEnter?: (tabId: string) => void;
}

function StatusIndicator({ status }: { status?: TabStatus }) {
  if (!status || status === "idle") return null;

  switch (status) {
    case "starting":
      return <span className="tab-status-indicator status-starting" />;
    case "running":
      return <span className="tab-status-indicator status-running" />;
    case "waiting":
      return <span className="tab-status-indicator status-waiting" />;
    case "done-success":
      return <span className="tab-status-indicator status-done-success">{"\u2713"}</span>;
    case "done-error":
      return <span className="tab-status-indicator status-done-error">{"\u2717"}</span>;
    default:
      return null;
  }
}

export function TerminalTab({
  tabId,
  label,
  projectName: _,
  isActive,
  isClaudeSession,
  isWorkspaceAgent,
  isHomePage,
  isProjectOverview,
  status,
  isDragOver,
  onClick,
  onClose,
  onDragStart,
  onDragEnter,
}: TerminalTabProps) {
  const typeClass = isHomePage ? "home" : isProjectOverview ? "overview" : isClaudeSession ? "claude" : "shell";
  const icon = isHomePage ? "\u2302" : isProjectOverview ? "\u2261" : isWorkspaceAgent ? "*" : isClaudeSession ? ">" : "$";
  const isDead = status ? isDoneStatus(status) : false;

  const canDrag = !isHomePage && !!tabId && !!onDragStart;

  return (
    <div
      className={`terminal-tab ${isActive ? "active" : ""} ${typeClass} ${isWorkspaceAgent ? "agent" : ""} ${isDead ? "dead" : ""} ${isDragOver ? "drag-over" : ""} ${status ? `status-${status}` : ""}`}
      onClick={onClick}
      onMouseDown={(e) => {
        // Only start drag on left click, not on close button
        if (!canDrag || e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest(".terminal-tab-close")) return;
        e.preventDefault(); // Prevent text selection during drag
        onDragStart!(tabId!);
      }}
      onMouseEnter={() => {
        if (canDrag && onDragEnter) {
          onDragEnter(tabId!);
        }
      }}
    >
      <span className="terminal-tab-icon">
        {icon}
        <StatusIndicator status={status} />
      </span>
      <span className="terminal-tab-label">{label}</span>
      {!isHomePage && (
        <button
          className="terminal-tab-close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          x
        </button>
      )}
    </div>
  );
}
