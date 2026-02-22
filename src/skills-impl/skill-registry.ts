/**
 * Skill Registry
 * Manages skill discovery and execution
 */

import fs from 'fs/promises';
import path from 'path';

export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  content: string;
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();
  private skillsPath: string;

  constructor(skillsPath: string = './skills') {
    this.skillsPath = skillsPath;
  }

  async discoverSkills(): Promise<void> {
    this.skills.clear();
    
    try {
      const entries = await fs.readdir(this.skillsPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(this.skillsPath, entry.name, 'SKILL.md');
          try {
            const content = await fs.readFile(skillPath, 'utf-8');
            const skill = this.parseSkill(content, entry.name);
            if (skill) {
              this.skills.set(skill.name, skill);
            }
          } catch {
            // No SKILL.md, skip
          }
        }
      }
      
      console.log(`[Skills] Discovered ${this.skills.size} skills`);
    } catch (error) {
      console.error('[Skills] Failed to discover:', error);
    }
  }

  private parseSkill(content: string, dirName: string): Skill | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) return null;

    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    const name = this.parseFrontmatterValue(frontmatter, 'name') || dirName;
    const description = this.parseFrontmatterValue(frontmatter, 'description') || '';
    const triggersStr = this.parseFrontmatterValue(frontmatter, 'triggers') || '';
    const triggers = triggersStr.split('\n').map(t => t.trim().replace(/^-\s*/, '')).filter(Boolean);

    return {
      name,
      description,
      triggers,
      content: body,
    };
  }

  private parseFrontmatterValue(frontmatter: string, key: string): string | null {
    const regex = new RegExp(`^${key}:\\s*(.+)$`, 'm');
    const match = frontmatter.match(regex);
    return match ? match[1].trim() : null;
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  findSkillForTrigger(input: string): Skill | undefined {
    const lowerInput = input.toLowerCase();
    for (const skill of this.skills.values()) {
      for (const trigger of skill.triggers) {
        const lowerTrigger = trigger.toLowerCase();
        const triggerText = lowerTrigger.replace(/^when\s+/, '').replace(/^user\s+/, '');
        if (lowerInput.includes(triggerText) || triggerText.includes(lowerInput)) {
          return skill;
        }
      }
    }
    return undefined;
  }
}
