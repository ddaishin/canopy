import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SKILL_CATALOG } from "../data/skill-catalog";
import type { CatalogSkill, InstalledSkillStatus, InstallResult } from "../types/skill-catalog";

interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  sourceUrl: string;
  repoUrl: string;
}

export function useSkillStore() {
  const [statuses, setStatuses] = useState<Map<string, boolean>>(new Map());
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [marketplaceSkills, setMarketplaceSkills] = useState<CatalogSkill[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);

  // Merged catalog: hardcoded + any live marketplace entries not already in hardcoded
  const mergedCatalog = [...SKILL_CATALOG];
  for (const ms of marketplaceSkills) {
    if (!mergedCatalog.some((s) => s.id === ms.id)) {
      mergedCatalog.push(ms);
    }
  }

  const checkStatuses = useCallback(async () => {
    try {
      const skillIds: [string, string][] = mergedCatalog.map((s) => [s.id, s.format]);
      const results = await invoke<InstalledSkillStatus[]>("check_skills_installed", { skillIds });
      const map = new Map<string, boolean>();
      for (const r of results) {
        map.set(r.id, r.installed);
      }
      setStatuses(map);
    } catch {
      // Silently fail — statuses will show as not installed
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedCatalog.length]);

  useEffect(() => {
    checkStatuses();
  }, [checkStatuses]);

  const fetchMarketplace = useCallback(async (repo?: string) => {
    setMarketplaceLoading(true);
    setMarketplaceError(null);
    try {
      const skills = await invoke<MarketplaceSkill[]>("fetch_marketplace_skills", {
        repo: repo || null,
      });
      const asCatalog: CatalogSkill[] = skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: "Development" as const, // Default category for live skills
        author: repo ? repo.split("/")[0] : "Anthropic",
        sourceUrl: s.sourceUrl,
        repoUrl: s.repoUrl,
        format: "skill" as const,
        featured: false,
      }));
      setMarketplaceSkills(asCatalog);
      // Re-check installed statuses with new catalog
      const allIds: [string, string][] = [...SKILL_CATALOG, ...asCatalog]
        .filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i)
        .map((s) => [s.id, s.format]);
      const results = await invoke<InstalledSkillStatus[]>("check_skills_installed", { skillIds: allIds });
      const map = new Map<string, boolean>();
      for (const r of results) {
        map.set(r.id, r.installed);
      }
      setStatuses(map);
    } catch (e) {
      setMarketplaceError(e instanceof Error ? e.message : String(e));
    } finally {
      setMarketplaceLoading(false);
    }
  }, []);

  const install = useCallback(async (skill: CatalogSkill) => {
    setInstalling((prev) => new Set(prev).add(skill.id));
    try {
      const result = await invoke<InstallResult>("install_skill", {
        id: skill.id,
        sourceUrl: skill.sourceUrl,
        format: skill.format,
      });
      if (!result.success) {
        throw new Error(result.error || "Install failed");
      }
      await checkStatuses();
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(skill.id);
        return next;
      });
    }
  }, [checkStatuses]);

  const uninstall = useCallback(async (skill: CatalogSkill) => {
    try {
      const result = await invoke<InstallResult>("uninstall_skill", {
        id: skill.id,
        format: skill.format,
      });
      if (!result.success) {
        throw new Error(result.error || "Uninstall failed");
      }
      await checkStatuses();
    } catch {
      // Silently fail
    }
  }, [checkStatuses]);

  return {
    catalog: mergedCatalog,
    statuses,
    installing,
    install,
    uninstall,
    refresh: checkStatuses,
    fetchMarketplace,
    marketplaceLoading,
    marketplaceError,
  };
}
