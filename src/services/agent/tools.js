const TOOL_REGISTRY = {};

function registerTool(name, config) {
  TOOL_REGISTRY[name] = {
    name,
    description: config.description,
    roles: config.roles,
    keywords: config.keywords,
    execute: config.execute,
  };
}

function getToolsForRole(role) {
  return Object.values(TOOL_REGISTRY).filter((t) => t.roles.includes(role));
}

function getTool(name) {
  return TOOL_REGISTRY[name];
}

function getAllTools() {
  return Object.values(TOOL_REGISTRY);
}

export { registerTool, getToolsForRole, getTool, getAllTools };
