import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminal, HOME_TAB_ID } from "../useTerminal";
import { closeTerminal } from "../../services/terminal-service";

// Mock terminal-service
vi.mock("../../services/terminal-service", () => ({
  closeTerminal: vi.fn(() => Promise.resolve()),
}));

// Spy on crypto.randomUUID instead of replacing the entire object
let uuidCounter = 0;

beforeEach(() => {
  uuidCounter = 0;
  localStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `uuid-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`);
  vi.mocked(closeTerminal).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTerminal", () => {
  it("starts with empty tabs and HOME active", () => {
    const { result } = renderHook(() => useTerminal());
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBe(HOME_TAB_ID);
  });

  it("addTab creates tab with correct fields", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/myproject", true);
    });

    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.label).toBe("myproject");
    expect(tab.projectPath).toBe("/home/user/myproject");
    expect(tab.isClaudeSession).toBe(true);
    expect(tab.terminalId).toBeNull();
    expect(tab.projectName).toBe("myproject");
  });

  it("addTab adds numeric suffix for duplicates", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/myproject", true);
    });
    act(() => {
      result.current.addTab("/home/user/myproject", true);
    });

    expect(result.current.tabs[0].label).toBe("myproject");
    expect(result.current.tabs[1].label).toBe("myproject 2");
  });

  it("addTab sets new tab as active", () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", false);
    });

    expect(result.current.activeTabId).toBe(tabId);
  });

  it("addTab with initialPrompt uses project name as label", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/myproject", true, undefined, "help me fix this");
    });

    expect(result.current.tabs[0].label).toBe("myproject");
    expect(result.current.tabs[0].initialPrompt).toBe("help me fix this");
  });

  it("addTab with slash-command initialPrompt uses command as label", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/myproject", true, undefined, "/review-pr");
    });

    expect(result.current.tabs[0].label).toBe("/review-pr");
  });

  it("removeTab switches active to HOME", async () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", false);
    });
    expect(result.current.activeTabId).toBe(tabId);

    await act(async () => {
      await result.current.removeTab(tabId);
    });

    expect(result.current.activeTabId).toBe(HOME_TAB_ID);
    expect(result.current.tabs).toHaveLength(0);
  });

  it("removeTab calls closeTerminal when tab has a terminal", async () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", true);
    });
    act(() => {
      result.current.setTerminalId(tabId, "term-99");
    });

    await act(async () => {
      await result.current.removeTab(tabId);
    });

    expect(closeTerminal).toHaveBeenCalledWith("term-99");
  });

  it("removeTab on HOME does nothing", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", false);
    });
    const tabsBefore = result.current.tabs.length;

    await act(async () => {
      await result.current.removeTab(HOME_TAB_ID);
    });

    expect(result.current.tabs).toHaveLength(tabsBefore);
  });

  it("markTabDead sets dead flag on correct tab", () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", true);
    });

    act(() => {
      result.current.markTabDead(tabId, false);
    });

    expect(result.current.tabs[0].dead).toBe(true);
    expect(result.current.tabs[0].completedWhileHidden).toBe(true);
  });

  it("clearTabNotice resets completedWhileHidden flag", () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", true);
    });

    act(() => {
      result.current.markTabDead(tabId, false);
    });

    expect(result.current.tabs[0].completedWhileHidden).toBe(true);

    act(() => {
      result.current.clearTabNotice(tabId);
    });

    expect(result.current.tabs[0].completedWhileHidden).toBe(false);
  });

  it("setTerminalId links terminal to tab", () => {
    const { result } = renderHook(() => useTerminal());

    let tabId: string = "";
    act(() => {
      tabId = result.current.addTab("/home/user/proj", true);
    });

    act(() => {
      result.current.setTerminalId(tabId, "term-42");
    });

    expect(result.current.tabs[0].terminalId).toBe("term-42");
  });

  it("openProjectTab creates new overview tab", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.openProjectTab("/home/user/proj");
    });

    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.isProjectOverview).toBe(true);
    expect(tab.projectPath).toBe("/home/user/proj");
    expect(tab.label).toBe("proj");
  });

  it("openProjectTab reuses existing overview", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.openProjectTab("/home/user/proj");
    });
    expect(result.current.tabs).toHaveLength(1);

    act(() => {
      result.current.openProjectTab("/home/user/proj");
    });
    // Should still be 1 tab, not 2
    expect(result.current.tabs).toHaveLength(1);
  });

  it("goHome sets activeTabId to HOME", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", false);
    });
    expect(result.current.activeTabId).not.toBe(HOME_TAB_ID);

    act(() => {
      result.current.goHome();
    });
    expect(result.current.activeTabId).toBe(HOME_TAB_ID);
  });

  it("toggleSplit toggles split mode", () => {
    const { result } = renderHook(() => useTerminal());

    expect(result.current.splitMode).toBe(false);

    act(() => {
      result.current.toggleSplit();
    });
    expect(result.current.splitMode).toBe(true);

    act(() => {
      result.current.toggleSplit();
    });
    expect(result.current.splitMode).toBe(false);
  });

  it("addWorkspaceAgentTab creates agent tab with label", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addWorkspaceAgentTab("/workspace", "context here");
    });

    expect(result.current.tabs).toHaveLength(1);
    const tab = result.current.tabs[0];
    expect(tab.label).toBe("Workspace Agent");
    expect(tab.isWorkspaceAgent).toBe(true);
    expect(tab.isClaudeSession).toBe(true);
    expect(tab.workspaceContext).toBe("context here");
  });

  // --- Session persistence ---

  it("persists tabs to localStorage on change", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", true);
    });

    const stored = localStorage.getItem("canopy-tab-sessions");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.tabs).toHaveLength(1);
    expect(parsed.tabs[0].projectPath).toBe("/home/user/proj");
    expect(parsed.activeTabId).toBe("uuid-1");
  });

  it("restores tabs from localStorage on mount", () => {
    // Pre-populate localStorage with a saved session
    localStorage.setItem(
      "canopy-tab-sessions",
      JSON.stringify({
        tabs: [
          {
            id: "saved-1",
            label: "myproject",
            isClaudeSession: true,
            projectPath: "/home/user/myproject",
            projectName: "myproject",
            sessionId: "session-abc",
          },
        ],
        activeTabId: "saved-1",
      })
    );

    const { result } = renderHook(() => useTerminal());

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe("saved-1");
    expect(result.current.tabs[0].dead).toBe(true); // PTY is gone after restart
    expect(result.current.tabs[0].terminalId).toBeNull();
    expect(result.current.activeTabId).toBe("saved-1");
  });

  it("does not persist credentials or sensitive data in localStorage", () => {
    const { result } = renderHook(() => useTerminal());

    // Add a tab with a workspace context (could contain sensitive info)
    act(() => {
      result.current.addWorkspaceAgentTab("/workspace", "some workspace context");
    });

    const stored = localStorage.getItem("canopy-tab-sessions");
    expect(stored).not.toBeNull();

    // workspaceContext should NOT be persisted
    expect(stored).not.toContain("some workspace context");
    expect(stored).not.toContain("workspaceContext");

    // Ensure no secret-like fields leak
    const lowerStored = stored!.toLowerCase();
    expect(lowerStored).not.toContain("secret");
    expect(lowerStored).not.toContain("password");
    expect(lowerStored).not.toContain("access_key");
    expect(lowerStored).not.toContain("token");
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorage.setItem("canopy-tab-sessions", "{{invalid json");

    const { result } = renderHook(() => useTerminal());

    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBe(HOME_TAB_ID);
  });

  // --- Tab reorder ---

  it("reorderTabs swaps tab positions", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/a", true);
    });
    act(() => {
      result.current.addTab("/home/user/b", false);
    });

    expect(result.current.tabs[0].projectName).toBe("a");
    expect(result.current.tabs[1].projectName).toBe("b");

    act(() => {
      result.current.reorderTabs("uuid-2", "uuid-1");
    });

    expect(result.current.tabs[0].projectName).toBe("b");
    expect(result.current.tabs[1].projectName).toBe("a");
  });

  // --- Close all dead tabs ---

  it("closeAllDeadTabs removes only dead tabs", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/alive", true);
    });
    act(() => {
      result.current.addTab("/home/user/dead", true);
    });

    // Mark second tab as dead
    act(() => {
      result.current.markTabDead("uuid-2", false);
    });

    expect(result.current.tabs).toHaveLength(2);

    await act(async () => {
      await result.current.closeAllDeadTabs();
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].projectName).toBe("alive");
  });

  // --- markTabAttention ---

  it("markTabAttention sets needsAttention flag", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", true);
    });

    act(() => {
      result.current.markTabAttention("uuid-1");
    });

    expect(result.current.tabs[0].needsAttention).toBe(true);
  });

  it("clearTabNotice clears needsAttention flag", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", true);
    });
    act(() => {
      result.current.markTabAttention("uuid-1");
    });
    expect(result.current.tabs[0].needsAttention).toBe(true);

    act(() => {
      result.current.clearTabNotice("uuid-1");
    });
    expect(result.current.tabs[0].needsAttention).toBe(false);
  });

  // --- relaunchTab ---

  it("relaunchTab creates a new tab and removes the dead one", () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/proj", true, "session-123");
    });
    act(() => {
      result.current.markTabDead("uuid-1", true);
    });

    act(() => {
      result.current.relaunchTab("uuid-1");
    });

    // Old tab should be gone, new tab should exist
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).not.toBe("uuid-1");
    expect(result.current.tabs[0].dead).toBeUndefined();
    expect(result.current.tabs[0].projectPath).toBe("/home/user/proj");
    // Should resume the same session
    expect(result.current.tabs[0].sessionId).toBe("session-123");
  });

  // --- removeTab picks adjacent tab ---

  it("removeTab switches to adjacent tab instead of always going home", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.addTab("/home/user/a", true); // uuid-1
    });
    act(() => {
      result.current.addTab("/home/user/b", true); // uuid-2
    });
    act(() => {
      result.current.addTab("/home/user/c", true); // uuid-3
    });

    // Active tab is uuid-3 (last added). Switch to uuid-2.
    act(() => {
      result.current.setActiveTabId("uuid-2");
    });

    // Remove uuid-2 — should switch to uuid-3 (next neighbor), not HOME
    await act(async () => {
      await result.current.removeTab("uuid-2");
    });

    expect(result.current.activeTabId).not.toBe(HOME_TAB_ID);
    expect(result.current.tabs).toHaveLength(2);
  });
});
