const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Search only the two paths above. Without this, Metro also walks up from
// each importing file and can find a second copy of a singleton (react,
// react-native, reanimated) in a tree that is not hoisted.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
