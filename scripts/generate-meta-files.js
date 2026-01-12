// scripts/generate-meta-files.js
const fs = require('fs').promises;
const path = require('path');
const matter = require('gray-matter');

const DOCS_DIR = path.join(process.cwd(), 'public/docs');

// Default icons for categories (can be overridden in frontmatter)
const DEFAULT_ICONS = {
  'getting-started': 'Rocket',
  'core-concepts': 'BookOpen',
  'api-reference': 'Code',
  'guides': 'Map',
  'installation': 'Download',
  'core': 'Cpu',
};

/**
 * Get all markdown files in a directory
 */
async function getMarkdownFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name);
  } catch (error) {
    return [];
  }
}

/**
 * Get all subdirectories in a directory
 */
async function getSubdirectories(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name);
  } catch (error) {
    return [];
  }
}

/**
 * Read and parse frontmatter from a markdown file
 */
async function readMarkdownFrontmatter(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const { data } = matter(content);
    return data;
  } catch (error) {
    console.warn(`Warning: Could not read frontmatter from ${filePath}`);
    return {};
  }
}

/**
 * Convert filename to title (fallback if no frontmatter title)
 */
function filenameToTitle(filename) {
  return filename
    .replace(/\.md$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Convert directory name to title
 */
function dirToTitle(dirname) {
  return dirname
    .replace(/-/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Generate _meta.json for a directory
 */
async function generateMetaForDirectory(dirPath, categorySlug) {
  console.log(`\nProcessing directory: ${categorySlug}`);
  
  // Get all markdown files and subdirectories
  const mdFiles = await getMarkdownFiles(dirPath);
  const subdirs = await getSubdirectories(dirPath);
  
  if (mdFiles.length === 0 && subdirs.length === 0) {
    console.log(`  ⊘ Empty directory, skipping`);
    return;
  }
  
  // Read frontmatter from index.md if it exists (for category metadata)
  let categoryMeta = {};
  if (mdFiles.includes('index.md')) {
    const indexPath = path.join(dirPath, 'index.md');
    categoryMeta = await readMarkdownFrontmatter(indexPath);
  }
  
  // Build items array
  const items = [];
  
  // Process markdown files
  for (const mdFile of mdFiles) {
    const filePath = path.join(dirPath, mdFile);
    const frontmatter = await readMarkdownFrontmatter(filePath);
    const slug = mdFile.replace(/\.md$/, '');
    
    // Skip if no title and no fallback
    const title = frontmatter.title || filenameToTitle(mdFile);
    
    // Use position if available, otherwise fall back to order
    const order = frontmatter.position ?? frontmatter.order ?? 999;
    
    const item = {
      title,
      slug,
      order,
      type: 'page',
    };
    
    // Add icon if present
    if (frontmatter.icon) {
      item.icon = frontmatter.icon;
    }
    
    items.push(item);
    
    console.log(`  ✓ Added page: ${title} (order: ${order}${frontmatter.icon ? `, icon: ${frontmatter.icon}` : ''})`);
  }
  
  // Process subdirectories (categories)
  for (const subdir of subdirs) {
    const subdirPath = path.join(dirPath, subdir);
    const subdirIndexPath = path.join(subdirPath, 'index.md');
    
    // Try to read metadata from subdir's index.md
    let subdirMeta = {};
    try {
      await fs.access(subdirIndexPath);
      subdirMeta = await readMarkdownFrontmatter(subdirIndexPath);
    } catch {
      // No index.md in subdirectory
    }
    
    const title = subdirMeta.title || dirToTitle(subdir);
    const icon = subdirMeta.icon || DEFAULT_ICONS[subdir];
    // Give categories a default order of 1 (after index which is 0) if not specified
    const order = subdirMeta.position ?? subdirMeta.order ?? 1;
    
    const item = {
      title,
      slug: subdir,
      order,
      type: 'category',
    };
    
    // Add icon if present
    if (icon) {
      item.icon = icon;
    }
    
    items.push(item);
    
    console.log(`  ✓ Added category: ${title} (order: ${order}${icon ? `, icon: ${icon}` : ''})`);
  }
  
  // Sort items by order
  items.sort((a, b) => a.order - b.order);
  
  // Build meta object
  const meta = {
    title: categoryMeta.title || dirToTitle(categorySlug),
    order: categoryMeta.position ?? categoryMeta.order ?? 1,
    icon: categoryMeta.icon || DEFAULT_ICONS[categorySlug] || 'BookOpen',
    description: categoryMeta.description || `Documentation for ${categorySlug}`,
    collapsed: categoryMeta.collapsed ?? false,
    items,
  };
  
  // Write _meta.json
  const metaPath = path.join(dirPath, '_meta.json');
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Generated ${metaPath}`);
  
  // Recursively process subdirectories
  for (const subdir of subdirs) {
    const subdirPath = path.join(dirPath, subdir);
    await generateMetaForDirectory(subdirPath, subdir);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('==========================================');
  console.log('  _meta.json Generator');
  console.log('==========================================\n');
  console.log('Scanning documentation structure...\n');
  
  try {
    // Get all top-level categories
    const categories = await getSubdirectories(DOCS_DIR);
    
    console.log(`Found ${categories.length} top-level categories: ${categories.join(', ')}\n`);
    
    // Process each category
    for (const category of categories) {
      const categoryPath = path.join(DOCS_DIR, category);
      await generateMetaForDirectory(categoryPath, category);
    }
    
    console.log('\n==========================================');
    console.log('  Generation complete!');
    console.log('==========================================\n');
    
  } catch (error) {
    console.error('Error generating meta files:', error);
    process.exit(1);
  }
}

main();
