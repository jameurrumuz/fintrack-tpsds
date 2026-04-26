'use server';

import fs from 'fs';
import path from 'path';

const RULES_FILE_PATH = path.join(process.cwd(), 'RULES.md');

/**
 * Reads the content of RULES.md
 */
export async function getRulesContent() {
  try {
    if (!fs.existsSync(RULES_FILE_PATH)) {
      return { success: false, error: 'RULES.md file not found.' };
    }
    const content = fs.readFileSync(RULES_FILE_PATH, 'utf8');
    return { success: true, content };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Appends a new rule to RULES.md
 */
export async function appendRule(newRule: string) {
  try {
    if (!newRule.trim()) {
      return { success: false, error: 'Rule content cannot be empty.' };
    }

    const timestamp = new Date().toLocaleString('bn-BD');
    const formattedRule = `\n\n### নতুন নিয়ম (সংযোজন: ${timestamp})\n- ${newRule}\n`;

    fs.appendFileSync(RULES_FILE_PATH, formattedRule, 'utf8');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Overwrites the entire RULES.md content
 */
export async function saveFullRules(content: string) {
    try {
        fs.writeFileSync(RULES_FILE_PATH, content, 'utf8');
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
