// scripts/generate-docs-structure.js
const fs = require('fs').promises;
const path = require('path');

const docsDir = path.join(process.cwd(), 'public/docs');
const outputFile = path.join(process.cwd(), 'public/docs-structure.json');

/**
 * Read and parse _meta.json file
 * @param {string} dirPath - Directory containing _meta.json
 * @returns {Promise<Object|null>} Parsed metadata or null
 */
async function readMetaFile(dirPath) {
  const metaPath = path.join(dirPath, '_meta.json');

  try {
    const content = await fs.readFile(metaPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Check if a markdown file exists
 * @param {string} dirPath - Directory path
 * @param {string} fileName - File name (without .md)
 * @returns {Promise<boolean>} True if file exists
 */
async function markdownFileExists(dirPath, fileName) {
  const filePath = path.join(dirPath, `${fileName}.md`);
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build navigation tree recursively
 * @param {string} dirPath - Current directory path
 * @param {string} basePath - Base path for URLs
 * @returns {Promise<Object|null>} Navigation node
 */
async function buildNavigationNode(dirPath, basePath = '') {
  const meta = await readMetaFile(dirPath);

  if (!meta) {
    // No _meta.json, skip this directory
    return null;
  }

  const node = {
    title: meta.title || path.basename(dirPath),
    slug: basePath || path.basename(dirPath),
    icon: meta.icon || 'FileText',
    description: meta.description || '',
    order: meta.order !== undefined ? meta.order : 999,
    collapsed: meta.collapsed !== undefined ? meta.collapsed : false,
    children: []
  };

  // Process items from _meta.json
  if (meta.items && Array.isArray(meta.items)) {
    for (const item of meta.items) {
      const itemSlug = item.slug;
      const itemPath = basePath ? `${basePath}/${itemSlug}` : itemSlug;

      if (item.type === 'category') {
        // This is a subdirectory
        const subDirPath = path.join(dirPath, itemSlug);

        try {
          await fs.access(subDirPath);
          const childNode = await buildNavigationNode(subDirPath, itemPath);

          if (childNode) {
            // Override order from parent meta
            childNode.order = item.order !== undefined ? item.order : childNode.order;
            node.children.push(childNode);
          }
        } catch {
          console.warn(`Category directory not found: ${subDirPath}`);
        }
      } else if (item.type === 'page') {
        // Skip index pages - they represent the category itself, not a child
        if (itemSlug === 'index') {
          // Store index page info on the category node itself
          node.indexPage = {
            title: item.title || node.title,
            slug: 'index',
            path: `/docs/${basePath}`,
            icon: item.icon
          };
          continue;
        }

        // This is a markdown file
        const hasFile = await markdownFileExists(dirPath, itemSlug);

        if (hasFile) {
          const pageNode = {
            title: item.title || itemSlug,
            slug: itemSlug,
            path: `/docs/${itemPath}`,
            type: 'page',
            order: item.order !== undefined ? item.order : 999
          };

          // Add icon if present
          if (item.icon) {
            pageNode.icon = item.icon;
          }

          node.children.push(pageNode);
        } else {
          console.warn(`Markdown file not found: ${itemSlug}.md in ${dirPath}`);
        }
      }
    }
  }

  // Sort children by order
  node.children.sort((a, b) => a.order - b.order);

  return node;
}

/**
 * Build the complete navigation structure
 * @returns {Promise<Object>} Navigation structure
 */
async function buildNavigation() {
  console.log('Building documentation navigation structure...');

  const navigation = [];

  try {
    // Read top-level directories
    const entries = await fs.readdir(docsDir, { withFileTypes: true });

    // Process each top-level directory
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Skip directories starting with _ (like _meta, _templates, etc.)
      if (entry.name.startsWith('_')) continue;

      const dirPath = path.join(docsDir, entry.name);
      const node = await buildNavigationNode(dirPath, entry.name);

      if (node) {
        navigation.push(node);
      }
    }

    // Sort top-level navigation by order
    navigation.sort((a, b) => a.order - b.order);

    console.log(`✓ Found ${navigation.length} top-level categories`);

    return {
      navigation,
      lastGenerated: new Date().toISOString(),
      version: '1.0.0'
    };
  } catch (error) {
    console.error('Error building navigation:', error);
    throw error;
  }
}

/**
 * Flatten navigation tree for search/sitemap purposes
 * @param {Array} navigation - Navigation tree
 * @param {Array} result - Accumulated result
 * @param {Array} parentPath - Current path
 * @returns {Array} Flattened array of all pages
 */
function flattenNavigation(navigation, result = [], parentPath = []) {
  for (const node of navigation) {
    const currentPath = [...parentPath, node.slug];

    if (node.type === 'page') {
      result.push({
        title: node.title,
        path: node.path,
        slug: currentPath.join('/'),
        category: parentPath.join('/')
      });
    }

    if (node.children && node.children.length > 0) {
      flattenNavigation(node.children, result, currentPath);
    }
  }

  return result;
}

/**
 * Generate statistics about the documentation
 * @param {Object} structure - Navigation structure
 * @returns {Object} Statistics
 */
function generateStats(structure) {
  const flat = flattenNavigation(structure.navigation);

  const stats = {
    totalCategories: structure.navigation.length,
    totalPages: flat.length,
    pagesPerCategory: {},
    deepestLevel: 0
  };

  // Count pages per category
  for (const page of flat) {
    const category = page.category || 'root';
    stats.pagesPerCategory[category] = (stats.pagesPerCategory[category] || 0) + 1;

    // Track deepest level
    const level = page.slug.split('/').length;
    if (level > stats.deepestLevel) {
      stats.deepestLevel = level;
    }
  }

  return stats;
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('==========================================');
    console.log('  Documentation Structure Generator');
    console.log('==========================================\n');

    // Check if docs directory exists
    try {
      await fs.access(docsDir);
    } catch {
      console.error(`Error: Documentation directory not found: ${docsDir}`);
      console.error('Please create the directory and add your documentation.');
      process.exit(1);
    }

    // Build navigation structure
    const structure = await buildNavigation();

    // Generate statistics
    const stats = generateStats(structure);

    console.log('\nDocumentation Statistics:');
    console.log(`  Total categories: ${stats.totalCategories}`);
    console.log(`  Total pages: ${stats.totalPages}`);
    console.log(`  Deepest nesting: ${stats.deepestLevel} levels`);

    // Write structure to file
    await fs.writeFile(
      outputFile,
      JSON.stringify(structure, null, 2),
      'utf8'
    );

    console.log(`\n✓ Navigation structure written to: ${outputFile}`);

    // Write flat list for quick access
    const flatList = flattenNavigation(structure.navigation);
    const flatOutputFile = path.join(process.cwd(), 'public/docs-flat.json');
    await fs.writeFile(
      flatOutputFile,
      JSON.stringify(flatList, null, 2),
      'utf8'
    );

    console.log(`✓ Flat page list written to: ${flatOutputFile}`);

    console.log('\n==========================================');
    console.log('  Structure generation complete!');
    console.log('==========================================\n');
  } catch (error) {
    console.error('\n❌ Error generating documentation structure:');
    console.error(error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { buildNavigation, flattenNavigation };
