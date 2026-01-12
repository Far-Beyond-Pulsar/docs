// scripts/generate-search-index.js
const fs = require('fs').promises;
const path = require('path');
const matter = require('gray-matter');

const docsDir = path.join(process.cwd(), 'public/docs');
const outputFile = path.join(process.cwd(), 'public/search-index.json');

/**
 * Extract headings from markdown content
 * @param {string} content - Markdown content
 * @returns {Array} Array of headings
 */
function extractHeadings(content) {
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim()
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Remove links
      .replace(/`([^`]+)`/g, '$1')  // Remove inline code
      .replace(/\*\*([^*]+)\*\*/g, '$1')  // Remove bold
      .replace(/\*([^*]+)\*/g, '$1');  // Remove italic

    const slug = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');

    headings.push({ level, text, slug });
  }

  return headings;
}

/**
 * Extract code blocks from markdown
 * @param {string} content - Markdown content
 * @returns {Array} Array of code blocks
 */
function extractCodeBlocks(content) {
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const codeBlocks = [];
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    codeBlocks.push({
      language: match[1] || 'text',
      code: match[2].trim()
    });
  }

  return codeBlocks;
}

/**
 * Strip markdown formatting for plain text content
 * @param {string} content - Markdown content
 * @returns {string} Plain text
 */
function stripMarkdown(content) {
  return content
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove headings markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove blockquotes
    .replace(/^\s*>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[\s-*_]{3,}$/gm, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Generate excerpt from content
 * @param {string} content - Full content
 * @param {number} length - Max length
 * @returns {string} Excerpt
 */
function generateExcerpt(content, length = 200) {
  const plainText = stripMarkdown(content);
  if (plainText.length <= length) {
    return plainText;
  }

  // Try to end at a sentence
  const truncated = plainText.slice(0, length);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastPeriod > length * 0.7) {
    return truncated.slice(0, lastPeriod + 1);
  } else if (lastSpace > length * 0.8) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Get all markdown files recursively
 * @param {string} dir - Directory to search
 * @param {string} basePath - Base path for URLs
 * @returns {Promise<Array>} Array of file info
 */
async function getAllMarkdownFiles(dir, basePath = '') {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = basePath ? path.join(basePath, entry.name) : entry.name;

      // Skip directories starting with _
      if (entry.isDirectory() && entry.name.startsWith('_')) {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await getAllMarkdownFiles(fullPath, relativePath);
        files.push(...subFiles);
      } else if (entry.name.endsWith('.md')) {
        files.push({
          fullPath,
          relativePath: relativePath.replace(/\\/g, '/'),
          fileName: entry.name
        });
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }

  return files;
}

/**
 * Process a single markdown file
 * @param {Object} file - File info object
 * @returns {Promise<Object>} Processed document
 */
async function processFile(file) {
  try {
    const fileContents = await fs.readFile(file.fullPath, 'utf8');
    const { data, content, excerpt } = matter(fileContents, {
      excerpt: true,
      excerpt_separator: '<!-- excerpt -->'
    });

    // Generate slug from path
    const pathWithoutExt = file.relativePath.replace('.md', '');
    const pathParts = pathWithoutExt.split('/').filter(Boolean);

    // Remove 'index' from path
    const slug = pathParts.filter(p => p !== 'index').join('/');

    // Build URL
    const url = `/docs/${slug}`;

    // Extract structured data
    const headings = extractHeadings(content);
    const codeBlocks = extractCodeBlocks(content);

    // Generate searchable content
    const plainText = stripMarkdown(content);
    const wordCount = plainText.split(/\s+/).length;
    const readingTime = Math.ceil(wordCount / 200);

    // Determine category from path
    const category = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : pathParts[0] || '';

    // Get file stats
    const stats = await fs.stat(file.fullPath);

    return {
      id: slug.replace(/\//g, '-'),
      title: data.title || 'Untitled',
      description: data.description || excerpt || generateExcerpt(content),
      url,
      slug,
      category,
      tags: data.tags || [],
      headings,
      content: plainText,
      excerpt: data.excerpt || data.description || generateExcerpt(content, 150),
      codeBlocks: codeBlocks.map(cb => ({
        language: cb.language,
        preview: cb.code.slice(0, 100)  // Only store preview for search
      })),
      wordCount,
      readingTime,
      lastUpdated: data.lastUpdated || stats.mtime.toISOString(),
      order: data.order !== undefined ? data.order : 999
    };
  } catch (error) {
    console.error(`Error processing file ${file.fullPath}:`, error);
    return null;
  }
}

/**
 * Build search index with weights
 * @param {Array} docs - Array of processed documents
 * @returns {Object} Search index
 */
function buildSearchIndex(docs) {
  const index = {
    docs: docs.map(doc => ({
      id: doc.id,
      title: doc.title,
      description: doc.description,
      url: doc.url,
      slug: doc.slug,
      category: doc.category,
      tags: doc.tags,
      headings: doc.headings.map(h => ({ level: h.level, text: h.text, slug: h.slug })),
      excerpt: doc.excerpt,
      readingTime: doc.readingTime,
      lastUpdated: doc.lastUpdated,
      // Searchable text for client-side search
      searchText: [
        doc.title,
        doc.description,
        ...doc.headings.map(h => h.text),
        ...doc.tags,
        doc.content.slice(0, 1000)  // Limit content size
      ].join(' ').toLowerCase()
    })),
    metadata: {
      totalDocs: docs.length,
      totalWords: docs.reduce((sum, doc) => sum + doc.wordCount, 0),
      categories: [...new Set(docs.map(d => d.category))].sort(),
      tags: [...new Set(docs.flatMap(d => d.tags))].sort(),
      lastGenerated: new Date().toISOString(),
      version: '1.0.0'
    }
  };

  return index;
}

/**
 * Generate statistics
 * @param {Object} index - Search index
 * @returns {Object} Statistics
 */
function generateStats(index) {
  const docsPerCategory = {};
  const docsPerTag = {};

  for (const doc of index.docs) {
    docsPerCategory[doc.category] = (docsPerCategory[doc.category] || 0) + 1;

    for (const tag of doc.tags) {
      docsPerTag[tag] = (docsPerTag[tag] || 0) + 1;
    }
  }

  return {
    totalDocuments: index.metadata.totalDocs,
    totalWords: index.metadata.totalWords,
    averageWordsPerDoc: Math.round(index.metadata.totalWords / index.metadata.totalDocs),
    totalCategories: index.metadata.categories.length,
    totalTags: index.metadata.tags.length,
    docsPerCategory,
    topTags: Object.entries(docsPerTag)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }))
  };
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('==========================================');
    console.log('  Documentation Search Index Generator');
    console.log('==========================================\n');

    // Check if docs directory exists
    try {
      await fs.access(docsDir);
    } catch {
      console.error(`Error: Documentation directory not found: ${docsDir}`);
      process.exit(1);
    }

    console.log('Scanning documentation files...');

    // Get all markdown files
    const files = await getAllMarkdownFiles(docsDir);
    console.log(`✓ Found ${files.length} documentation files`);

    console.log('\nProcessing files...');

    // Process all files
    const docs = [];
    for (const file of files) {
      const doc = await processFile(file);
      if (doc) {
        docs.push(doc);
        process.stdout.write('.');
      }
    }
    process.stdout.write('\n');

    console.log(`✓ Processed ${docs.length} documents`);

    // Build search index
    console.log('\nBuilding search index...');
    const index = buildSearchIndex(docs);

    // Generate statistics
    const stats = generateStats(index);

    console.log('\nSearch Index Statistics:');
    console.log(`  Total documents: ${stats.totalDocuments}`);
    console.log(`  Total words: ${stats.totalWords.toLocaleString()}`);
    console.log(`  Average words per doc: ${stats.averageWordsPerDoc}`);
    console.log(`  Categories: ${stats.totalCategories}`);
    console.log(`  Tags: ${stats.totalTags}`);

    if (stats.topTags.length > 0) {
      console.log('\n  Top tags:');
      for (const { tag, count } of stats.topTags) {
        console.log(`    - ${tag}: ${count} docs`);
      }
    }

    // Write index to file
    console.log('\nWriting search index...');
    await fs.writeFile(
      outputFile,
      JSON.stringify(index, null, 2),
      'utf8'
    );

    console.log(`✓ Search index written to: ${outputFile}`);

    const fileSizeKB = (JSON.stringify(index).length / 1024).toFixed(2);
    console.log(`  Index size: ${fileSizeKB} KB`);

    console.log('\n==========================================');
    console.log('  Search index generation complete!');
    console.log('==========================================\n');
  } catch (error) {
    console.error('\n❌ Error generating search index:');
    console.error(error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { processFile, buildSearchIndex };
