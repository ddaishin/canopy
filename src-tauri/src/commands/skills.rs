use super::CommandNoWindow;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub title: String,
    pub description: String,
    pub source: String, // "global", "project", or "skill"
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub success: bool,
    pub id: String,
    pub installed_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkillStatus {
    pub id: String,
    pub installed: bool,
}

fn skip_yaml_frontmatter(content: &str) -> &str {
    if let Some(rest) = content.strip_prefix("---") {
        // Find the closing ---
        if let Some(end) = rest.find("\n---") {
            let after = &rest[end + 4..];
            return after.trim_start_matches('\n');
        }
    }
    content
}

fn parse_skill_file(path: &PathBuf, source: &str) -> Option<Skill> {
    let content = fs::read_to_string(path).ok()?;
    let content = skip_yaml_frontmatter(&content);

    let name = if source == "skill" {
        // For skills in ~/.claude/skills/<id>/SKILL.md, use the directory name
        path.parent()?.file_name()?.to_string_lossy().to_string()
    } else {
        path.file_stem()?.to_string_lossy().to_string()
    };

    let mut lines = content.lines();
    let title = lines
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches('#')
        .trim()
        .to_string();

    // Skip blank line
    lines.next();

    let description = lines
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    if title.is_empty() {
        return None;
    }

    Some(Skill {
        name,
        title,
        description,
        source: source.to_string(),
    })
}

#[tauri::command]
pub fn get_skills(project_path: Option<String>) -> Result<Vec<Skill>, String> {
    let mut skills: Vec<Skill> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        // Global commands from ~/.claude/commands/
        let global_dir = home.join(".claude").join("commands");
        if global_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&global_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("md") {
                        if let Some(skill) = parse_skill_file(&path, "global") {
                            skills.push(skill);
                        }
                    }
                }
            }
        }

        // Skills from ~/.claude/skills/*/SKILL.md
        let skills_dir = home.join(".claude").join("skills");
        if skills_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&skills_dir) {
                for entry in entries.flatten() {
                    let dir_path = entry.path();
                    if dir_path.is_dir() {
                        let skill_file = dir_path.join("SKILL.md");
                        if skill_file.exists() {
                            if let Some(skill) = parse_skill_file(&skill_file, "skill") {
                                skills.push(skill);
                            }
                        }
                    }
                }
            }
        }
    }

    // Project-level commands from {project}/.claude/commands/
    if let Some(ref proj) = project_path {
        let proj_dir = PathBuf::from(proj).join(".claude").join("commands");
        if proj_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&proj_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("md") {
                        if let Some(skill) = parse_skill_file(&path, "project") {
                            skills.push(skill);
                        }
                    }
                }
            }
        }
    }

    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(skills)
}

/// Entry from the GitHub Contents API response
#[derive(Debug, Deserialize)]
struct GitHubContentEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: String, // "file" or "dir"
    download_url: Option<String>,
    path: String,
}

/// Download a single file from a URL to a local path
fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    let output = Command::new("curl")
        .no_window()
        .args(["-s", "--fail", "--connect-timeout", "10", "--max-time", "30", url])
        .output()
        .map_err(|e| format!("Failed to run curl: {}", e))?;

    if !output.status.success() {
        return Err(format!("Download failed for {}", url));
    }

    fs::write(dest, &output.stdout)
        .map_err(|e| format!("Failed to write {}: {}", dest.display(), e))
}

/// Recursively download a GitHub directory using the Contents API.
/// `depth` limits recursion to prevent stack overflow from malicious repos.
const MAX_DOWNLOAD_DEPTH: u32 = 5;

fn download_github_directory(api_url: &str, target_dir: &Path) -> Result<(), String> {
    download_github_directory_inner(api_url, target_dir, 0)
}

fn download_github_directory_inner(api_url: &str, target_dir: &Path, depth: u32) -> Result<(), String> {
    if depth > MAX_DOWNLOAD_DEPTH {
        return Err("Directory nesting too deep (max 5 levels)".to_string());
    }
    fs::create_dir_all(target_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    // Fetch directory listing from GitHub Contents API
    let output = Command::new("curl")
        .no_window()
        .args([
            "-s", "--fail",
            "--connect-timeout", "10",
            "--max-time", "30",
            "-H", "Accept: application/vnd.github.v3+json",
            "-H", "User-Agent: Canopy",
            api_url,
        ])
        .output()
        .map_err(|e| format!("Failed to fetch directory listing: {}", e))?;

    if !output.status.success() {
        return Err(format!("GitHub API request failed for {}", api_url));
    }

    let entries: Vec<GitHubContentEntry> = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse GitHub API response: {}", e))?;

    for entry in entries {
        // Validate entry name — prevent path traversal from malicious API responses
        if entry.name.is_empty()
            || entry.name.contains('/')
            || entry.name.contains('\\')
            || entry.name.contains("..")
        {
            continue;
        }

        // Validate entry path — prevent URL injection in recursive calls
        if entry.path.contains("..") || entry.path.contains('?') || entry.path.contains('#') {
            continue;
        }

        match entry.entry_type.as_str() {
            "file" => {
                if let Some(ref dl_url) = entry.download_url {
                    // Validate download URL against allowlist — prevent SSRF
                    if !dl_url.starts_with("https://raw.githubusercontent.com/") {
                        continue;
                    }
                    let dest = target_dir.join(&entry.name);
                    download_file(dl_url, &dest)?;
                }
            }
            "dir" => {
                let sub_api = format!(
                    "https://api.github.com/repos/{}/contents/{}",
                    extract_repo_from_api_url(api_url)
                        .ok_or_else(|| "Failed to parse repo from API URL".to_string())?,
                    entry.path,
                );
                let sub_dir = target_dir.join(&entry.name);
                download_github_directory_inner(&sub_api, &sub_dir, depth + 1)?;
            }
            _ => {} // skip symlinks etc.
        }
    }

    Ok(())
}

/// Extract "owner/repo" from a GitHub API URL like
/// "https://api.github.com/repos/anthropics/skills/contents/skills/pdf"
fn extract_repo_from_api_url(url: &str) -> Option<String> {
    let prefix = "https://api.github.com/repos/";
    let rest = url.strip_prefix(prefix)?;
    // rest = "anthropics/skills/contents/skills/pdf"
    let parts: Vec<&str> = rest.splitn(3, '/').collect();
    if parts.len() >= 2 {
        Some(format!("{}/{}", parts[0], parts[1]))
    } else {
        None
    }
}

#[tauri::command]
pub fn install_skill(id: String, source_url: String, format: String) -> InstallResult {
    // Validate skill id — prevent path traversal
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return InstallResult {
            success: false,
            id,
            installed_path: None,
            error: Some("Invalid skill id".to_string()),
        };
    }

    // Validate URL against allowed origins (raw content only, no redirects)
    const ALLOWED_PREFIXES: &[&str] = &[
        "https://raw.githubusercontent.com/",
    ];
    if !ALLOWED_PREFIXES.iter().any(|prefix| source_url.starts_with(prefix)) {
        return InstallResult {
            success: false,
            id,
            installed_path: None,
            error: Some("Source URL must be from raw.githubusercontent.com".to_string()),
        };
    }

    let home = match dirs::home_dir() {
        Some(h) => h,
        None => {
            return InstallResult {
                success: false,
                id,
                installed_path: None,
                error: Some("Could not determine home directory".to_string()),
            }
        }
    };

    if format == "command" {
        // Single file download for commands
        let target_dir = home.join(".claude").join("commands");
        let target_file = target_dir.join(format!("{}.md", id));

        if let Err(e) = fs::create_dir_all(&target_dir) {
            return InstallResult {
                success: false,
                id,
                installed_path: None,
                error: Some(format!("Failed to create directory: {}", e)),
            };
        }

        match download_file(&source_url, &target_file) {
            Ok(_) => InstallResult {
                success: true,
                id,
                installed_path: Some(target_file.to_string_lossy().to_string()),
                error: None,
            },
            Err(e) => InstallResult {
                success: false,
                id,
                installed_path: None,
                error: Some(e),
            },
        }
    } else {
        // Full directory download for skills
        // Parse the raw.githubusercontent.com URL structurally:
        // source_url: https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md
        // → owner=anthropics, repo=skills, branch=main, path=skills/pdf/SKILL.md
        // → api_url: https://api.github.com/repos/anthropics/skills/contents/skills/pdf
        let api_url = match source_url.strip_prefix("https://raw.githubusercontent.com/") {
            Some(rest) => {
                let parts: Vec<&str> = rest.splitn(4, '/').collect();
                if parts.len() < 4 {
                    return InstallResult {
                        success: false,
                        id,
                        installed_path: None,
                        error: Some("Invalid source URL format".to_string()),
                    };
                }
                let (owner, repo, _branch, file_path) = (parts[0], parts[1], parts[2], parts[3]);
                let dir_path = file_path.trim_end_matches("/SKILL.md").trim_end_matches("SKILL.md");
                let dir_path = dir_path.trim_end_matches('/');
                format!("https://api.github.com/repos/{}/{}/contents/{}", owner, repo, dir_path)
            }
            None => {
                return InstallResult {
                    success: false,
                    id,
                    installed_path: None,
                    error: Some("Source URL must be from raw.githubusercontent.com".to_string()),
                };
            }
        };

        let target_dir = home.join(".claude").join("skills").join(&id);

        // Remove existing skill directory if present (clean reinstall)
        if target_dir.exists() {
            fs::remove_dir_all(&target_dir)
                .map_err(|e| format!("Failed to clean existing skill directory: {}", e))
                .unwrap_or_else(|e| eprintln!("{}", e));
        }

        match download_github_directory(&api_url, &target_dir) {
            Ok(_) => {
                // Verify SKILL.md was downloaded
                let skill_file = target_dir.join("SKILL.md");
                if skill_file.exists() {
                    InstallResult {
                        success: true,
                        id,
                        installed_path: Some(target_dir.to_string_lossy().to_string()),
                        error: None,
                    }
                } else {
                    InstallResult {
                        success: false,
                        id,
                        installed_path: None,
                        error: Some("SKILL.md not found in downloaded directory".to_string()),
                    }
                }
            }
            Err(e) => InstallResult {
                success: false,
                id,
                installed_path: None,
                error: Some(e),
            },
        }
    }
}

#[tauri::command]
pub fn uninstall_skill(id: String, format: String) -> InstallResult {
    // Validate skill id — prevent path traversal
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return InstallResult {
            success: false,
            id,
            installed_path: None,
            error: Some("Invalid skill id".to_string()),
        };
    }

    let home = match dirs::home_dir() {
        Some(h) => h,
        None => {
            return InstallResult {
                success: false,
                id,
                installed_path: None,
                error: Some("Could not determine home directory".to_string()),
            }
        }
    };

    let result = if format == "command" {
        let file = home.join(".claude").join("commands").join(format!("{}.md", id));
        if file.exists() {
            fs::remove_file(&file)
        } else {
            Ok(())
        }
    } else {
        let dir = home.join(".claude").join("skills").join(&id);
        if dir.exists() {
            fs::remove_dir_all(&dir)
        } else {
            Ok(())
        }
    };

    match result {
        Ok(_) => InstallResult {
            success: true,
            id,
            installed_path: None,
            error: None,
        },
        Err(e) => InstallResult {
            success: false,
            id,
            installed_path: None,
            error: Some(format!("Failed to uninstall: {}", e)),
        },
    }
}

#[tauri::command]
pub fn check_skills_installed(skill_ids: Vec<(String, String)>) -> Vec<InstalledSkillStatus> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return skill_ids.iter().map(|(id, _)| InstalledSkillStatus { id: id.clone(), installed: false }).collect(),
    };

    skill_ids
        .iter()
        .map(|(id, format)| {
            // Validate skill id — prevent path traversal
            if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
                return InstalledSkillStatus { id: id.clone(), installed: false };
            }
            let exists = if format == "command" {
                home.join(".claude").join("commands").join(format!("{}.md", id)).exists()
            } else {
                home.join(".claude").join("skills").join(id).join("SKILL.md").exists()
            };
            InstalledSkillStatus {
                id: id.clone(),
                installed: exists,
            }
        })
        .collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source_url: String,
    pub repo_url: String,
}

/// Fetch available skills from a GitHub repository's skills/ directory.
/// Uses the GitHub Contents API to list skill directories and reads SKILL.md metadata.
#[tauri::command]
pub fn fetch_marketplace_skills(repo: Option<String>) -> Result<Vec<MarketplaceSkill>, String> {
    let repo = repo.unwrap_or_else(|| "anthropics/skills".to_string());

    // Validate repo format (owner/repo)
    let repo_parts: Vec<&str> = repo.splitn(2, '/').collect();
    if repo_parts.len() != 2
        || repo_parts[0].is_empty()
        || repo_parts[1].is_empty()
        || !repo_parts.iter().all(|p| p.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.'))
    {
        return Err("Invalid repo format. Expected 'owner/repo' with alphanumeric characters, hyphens, underscores, or periods.".to_string());
    }

    let api_url = format!(
        "https://api.github.com/repos/{}/contents/skills",
        repo
    );

    let output = Command::new("curl")
        .no_window()
        .args([
            "-s", "--fail",
            "--connect-timeout", "10",
            "--max-time", "30",
            "-H", "Accept: application/vnd.github.v3+json",
            "-H", "User-Agent: Canopy",
            &api_url,
        ])
        .output()
        .map_err(|e| format!("Failed to fetch marketplace: {}", e))?;

    if !output.status.success() {
        return Err("Failed to fetch skills directory from GitHub".to_string());
    }

    let entries: Vec<GitHubContentEntry> = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse GitHub response: {}", e))?;

    let mut skills: Vec<MarketplaceSkill> = Vec::new();

    for entry in entries {
        if entry.entry_type != "dir" {
            continue;
        }

        let skill_id = entry.name.clone();

        // Fetch SKILL.md to get metadata
        let skill_url = format!(
            "https://raw.githubusercontent.com/{}/main/skills/{}/SKILL.md",
            repo, skill_id
        );

        let md_output = Command::new("curl")
            .no_window()
            .args(["-s", "--fail", &skill_url])
            .output();

        let (name, description) = match md_output {
            Ok(ref result) if result.status.success() => {
                let content = String::from_utf8_lossy(&result.stdout);
                let content = skip_yaml_frontmatter(&content);
                let mut lines = content.lines();
                let title = lines
                    .next()
                    .unwrap_or("")
                    .trim()
                    .trim_start_matches('#')
                    .trim()
                    .to_string();
                lines.next(); // skip blank line
                let desc = lines.next().unwrap_or("").trim().to_string();
                (
                    if title.is_empty() { skill_id.clone() } else { title },
                    desc,
                )
            }
            _ => (skill_id.clone(), String::new()),
        };

        skills.push(MarketplaceSkill {
            id: skill_id.clone(),
            name,
            description,
            source_url: format!(
                "https://raw.githubusercontent.com/{}/main/skills/{}/SKILL.md",
                repo, skill_id
            ),
            repo_url: format!(
                "https://github.com/{}/tree/main/skills/{}",
                repo, skill_id
            ),
        });
    }

    skills.sort_by(|a, b| a.id.to_lowercase().cmp(&b.id.to_lowercase()));
    Ok(skills)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_yaml_frontmatter_with_frontmatter() {
        let input = "---\ntitle: My Skill\nauthor: test\n---\n# Hello\nThis is content.";
        let result = skip_yaml_frontmatter(input);
        assert_eq!(result, "# Hello\nThis is content.");
    }

    #[test]
    fn skip_yaml_frontmatter_without_frontmatter() {
        let input = "# Hello\nThis is content.";
        let result = skip_yaml_frontmatter(input);
        assert_eq!(result, input);
    }

    #[test]
    fn skip_yaml_frontmatter_unclosed_returns_as_is() {
        let input = "---\ntitle: Unclosed\nNo closing delimiter here";
        let result = skip_yaml_frontmatter(input);
        assert_eq!(result, input);
    }

    #[test]
    fn skip_yaml_frontmatter_empty_string() {
        let result = skip_yaml_frontmatter("");
        assert_eq!(result, "");
    }

    // --- parse_skill_file ---

    #[test]
    fn parse_skill_file_basic() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("my-skill.md");
        std::fs::write(&file_path, "# My Cool Skill\n\nThis does something useful.\n\nMore details here.\n").unwrap();

        let path = PathBuf::from(&file_path);
        let result = parse_skill_file(&path, "global");
        assert!(result.is_some());

        let skill = result.unwrap();
        assert_eq!(skill.name, "my-skill");
        assert_eq!(skill.title, "My Cool Skill");
        assert_eq!(skill.description, "This does something useful.");
        assert_eq!(skill.source, "global");
    }

    #[test]
    fn parse_skill_file_with_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("fancy.md");
        std::fs::write(&file_path, "---\nauthor: test\n---\n# Fancy Skill\n\nA fancy description.\n").unwrap();

        let path = PathBuf::from(&file_path);
        let result = parse_skill_file(&path, "project");
        assert!(result.is_some());

        let skill = result.unwrap();
        assert_eq!(skill.title, "Fancy Skill");
        assert_eq!(skill.description, "A fancy description.");
    }

    #[test]
    fn parse_skill_file_empty_title_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("empty.md");
        std::fs::write(&file_path, "\n\n").unwrap();

        let path = PathBuf::from(&file_path);
        assert!(parse_skill_file(&path, "global").is_none());
    }

    #[test]
    fn parse_skill_file_skill_source_uses_dir_name() {
        let dir = tempfile::tempdir().unwrap();
        let skill_dir = dir.path().join("my-awesome-skill");
        std::fs::create_dir(&skill_dir).unwrap();
        let file_path = skill_dir.join("SKILL.md");
        std::fs::write(&file_path, "# Awesome\n\nDoes awesome things.\n").unwrap();

        let path = PathBuf::from(&file_path);
        let result = parse_skill_file(&path, "skill");
        assert!(result.is_some());
        assert_eq!(result.unwrap().name, "my-awesome-skill");
    }
}
