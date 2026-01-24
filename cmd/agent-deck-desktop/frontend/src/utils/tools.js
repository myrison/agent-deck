/**
 * Available AI tools with their display properties.
 */
export const TOOLS = [
    { id: 'claude', name: 'Claude', icon: 'C', color: '#4cc9f0', description: 'Anthropic Claude Code' },
    { id: 'gemini', name: 'Gemini', icon: 'G', color: '#ffe66d', description: 'Google Gemini CLI' },
    { id: 'opencode', name: 'OpenCode', icon: 'O', color: '#6c757d', description: 'OpenCode CLI' },
];

/**
 * Get the single-letter icon for a tool.
 *
 * @param {string} tool - Tool ID ('claude', 'gemini', 'opencode')
 * @returns {string} Single character icon
 */
export function getToolIcon(tool) {
    const found = TOOLS.find(t => t.id === tool);
    return found ? found.icon : '$';
}

/**
 * Get the color associated with a tool.
 *
 * @param {string} tool - Tool ID ('claude', 'gemini', 'opencode')
 * @returns {string} CSS color value
 */
export function getToolColor(tool) {
    const found = TOOLS.find(t => t.id === tool);
    return found ? found.color : '#6c757d';
}
