// src/utils/docs.js
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';

const docsDirectory = path.join(process.cwd(), 'public/docs');

/**
 * Get all markdown files recursively from a directory
 * @param {string} dir - Directory to search
 * @param {string} basePath - Base path for URL generation
 * @returns {Promise<Array>} Array of file paths
 */
async function getAllMarkdownFiles(dir, basePath = '') {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = basePath ? path.join(basePath, entry.name) : entry.name;

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
 * Parse doc path from array to string parts
 * @param {string|Array<string>} pathInput - Path as array or string
 * @returns {Object} Parsed path information
 */
function parsePath(pathInput) {
  let pathArray;

  if (Array.isArray(pathInput)) {
    pathArray = pathInput;
  } else if (typeof pathInput === 'string') {
    pathArray = pathInput.split('/').filter(Boolean);
  } else {
    pathArray = [];
  }

  // Handle index files
  const fileName = pathArray[pathArray.length - 1];
  const isIndex = fileName === 'index' || !fileName;

  // Build file path
  const filePath = isIndex
    ? path.join(docsDirectory, ...pathArray.slice(0, -1), 'index.md')
    : path.join(docsDirectory, ...pathArray) + '.md';

  // Build category path
  const category = isIndex
    ? pathArray.slice(0, -1).join('/')
    : pathArray.slice(0, -1).join('/');

  return {
    pathArray,
    filePath,
    category,
    slug: pathArray.join('/'),
    isIndex
  };
}

/**
 * Get a documentation page by its path
 * @param {string|Array<string>} pathInput - Path array like ['getting-started', 'installation', 'windows']
 * @returns {Promise<Object|null>} Doc data or null if not found
 */
export async function getDocByPath(pathInput) {
  try {
    const { filePath, category, slug, pathArray } = parsePath(pathInput);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      // Try without .md extension if it's a directory with index
      const indexPath = path.join(docsDirectory, ...pathArray, 'index.md');
      try {
        await fs.access(indexPath);
        return getDocByPath([...pathArray, 'index']);
      } catch {
        return null;
      }
    }

    // Read and parse the file
    const fileContents = await fs.readFile(filePath, 'utf8');
    const { data, content, excerpt } = matter(fileContents, {
      excerpt: true,
      excerpt_separator: '<!-- excerpt -->'
    });

    // Generate excerpt if not explicitly provided
    let docExcerpt = data.excerpt || data.description;
    if (!docExcerpt) {
      if (excerpt) {
        docExcerpt = excerpt.trim();
      } else {
        // Take first paragraph or first 200 chars
        const firstPara = content.split('\n\n')[0];
        docExcerpt = (firstPara || content).slice(0, 200).trim() + '...';
      }
    }

    // Calculate reading time (average 200 words per minute)
    const wordCount = content.split(/\s+/).length;
    const readingTime = Math.ceil(wordCount / 200);

    // Get file stats for timestamps
    const stats = await fs.stat(filePath);

    return {
      slug,
      path: pathArray,
      category,
      content,
      title: data.title || 'Untitled',
      description: data.description || docExcerpt,
      date: data.date || stats.birthtime.toISOString(),
      lastUpdated: data.lastUpdated || stats.mtime.toISOString(),
      tags: data.tags || [],
      excerpt: docExcerpt,
      readingTime,
      order: data.order || 999,
      related: data.related || [],
      ...data, // Include all frontmatter data
    };
  } catch (error) {
    console.error(`Error getting doc for path ${pathInput}:`, error);
    return null;
  }
}

/**
 * Get all docs in a specific category
 * @param {string} category - Category path like 'getting-started' or 'getting-started/installation'
 * @returns {Promise<Array>} Array of docs in the category
 */
export async function getDocsInCategory(category) {
  try {
    const categoryPath = path.join(docsDirectory, ...category.split('/'));

    // Check if category exists
    try {
      await fs.access(categoryPath);
    } catch {
      return [];
    }

    // Get all markdown files in category (non-recursive for direct children)
    const entries = await fs.readdir(categoryPath, { withFileTypes: true });
    const docs = [];

    for (const entry of entries) {
      if (entry.name.endsWith('.md')) {
        const docPath = [...category.split('/'), entry.name.replace('.md', '')];
        const doc = await getDocByPath(docPath);
        if (doc) {
          docs.push(doc);
        }
      } else if (entry.isDirectory() && !entry.name.startsWith('_')) {
        // Get index file of subdirectory
        const indexDoc = await getDocByPath([...category.split('/'), entry.name, 'index']);
        if (indexDoc) {
          docs.push(indexDoc);
        }
      }
    }

    // Sort by order field
    return docs.sort((a, b) => a.order - b.order);
  } catch (error) {
    console.error(`Error getting docs in category ${category}:`, error);
    return [];
  }
}

/**
 * Get the navigation tree structure
 * @returns {Promise<Object>} Navigation tree from docs-structure.json
 */
export async function getNavigationTree() {
  try {
    const structurePath = path.join(process.cwd(), 'public/docs-structure.json');

    try {
      const structureData = await fs.readFile(structurePath, 'utf8');
      return JSON.parse(structureData);
    } catch {
      // If structure file doesn't exist, return empty structure
      console.warn('docs-structure.json not found. Run generate:docs script.');
      return { navigation: [], lastGenerated: null };
    }
  } catch (error) {
    console.error('Error reading navigation tree:', error);
    return { navigation: [], lastGenerated: null };
  }
}

/**
 * Get all documentation pages (flattened)
 * @returns {Promise<Array>} All docs
 */
export async function getAllDocs() {
  try {
    const files = await getAllMarkdownFiles(docsDirectory);
    const docs = [];

    for (const file of files) {
      // Convert file path to doc path array
      const relativePath = file.relativePath.replace('.md', '');
      const pathArray = relativePath.split('/').filter(Boolean);

      const doc = await getDocByPath(pathArray);
      if (doc) {
        docs.push(doc);
      }
    }

    // Sort by category, then order
    return docs.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.order - b.order;
    });
  } catch (error) {
    console.error('Error getting all docs:', error);
    return [];
  }
}

/**
 * Get previous and next docs based on navigation order
 * @param {string|Array<string>} currentPath - Current doc path
 * @returns {Promise<Object>} Object with prev and next docs
 */
export async function getAdjacentDocs(currentPath) {
  try {
    const current = await getDocByPath(currentPath);
    if (!current) {
      return { prev: null, next: null };
    }

    // Get all docs in the same category
    const categoryDocs = await getDocsInCategory(current.category);

    // Find current doc index
    const currentIndex = categoryDocs.findIndex(doc => doc.slug === current.slug);

    if (currentIndex === -1) {
      return { prev: null, next: null };
    }

    return {
      prev: currentIndex > 0 ? categoryDocs[currentIndex - 1] : null,
      next: currentIndex < categoryDocs.length - 1 ? categoryDocs[currentIndex + 1] : null
    };
  } catch (error) {
    console.error('Error getting adjacent docs:', error);
    return { prev: null, next: null };
  }
}

/**
 * Get related docs based on tags and explicit related field
 * @param {Object} doc - Current doc object
 * @param {number} limit - Maximum number of related docs
 * @returns {Promise<Array>} Array of related docs
 */
export async function getRelatedDocs(doc, limit = 5) {
  try {
    // Get explicitly related docs from frontmatter
    const explicitRelated = [];
    if (doc.related && doc.related.length > 0) {
      for (const relatedPath of doc.related) {
        const relatedDoc = await getDocByPath(relatedPath.split('/'));
        if (relatedDoc) {
          explicitRelated.push({ ...relatedDoc, relevance: 100 });
        }
      }
    }

    // Get all docs and score by tag similarity
    const allDocs = await getAllDocs();
    const scoredDocs = [];

    for (const otherDoc of allDocs) {
      // Skip self and explicit related
      if (otherDoc.slug === doc.slug) continue;
      if (explicitRelated.some(d => d.slug === otherDoc.slug)) continue;

      // Calculate tag overlap
      const commonTags = doc.tags.filter(tag => otherDoc.tags.includes(tag));
      const tagScore = commonTags.length * 10;

      // Boost docs in same category
      const categoryScore = otherDoc.category === doc.category ? 20 : 0;

      // Check if this doc links to the other
      const linkScore = doc.related?.includes(otherDoc.slug) ? 30 : 0;

      const totalScore = tagScore + categoryScore + linkScore;

      if (totalScore > 0) {
        scoredDocs.push({ ...otherDoc, relevance: totalScore });
      }
    }

    // Sort by relevance and combine with explicit related
    scoredDocs.sort((a, b) => b.relevance - a.relevance);
    const related = [...explicitRelated, ...scoredDocs].slice(0, limit);

    return related;
  } catch (error) {
    console.error('Error getting related docs:', error);
    return [];
  }
}

/**
 * Get all unique tags across all docs
 * @returns {Promise<Array>} Array of unique tags
 */
export async function getAllTags() {
  try {
    const docs = await getAllDocs();
    const tags = new Set();

    docs.forEach(doc => {
      if (doc.tags) {
        doc.tags.forEach(tag => tags.add(tag));
      }
    });

    return Array.from(tags).sort();
  } catch (error) {
    console.error('Error getting all tags:', error);
    return [];
  }
}

/**
 * Get all unique categories
 * @returns {Promise<Array>} Array of category objects with metadata
 */
export async function getAllCategories() {
  try {
    const structure = await getNavigationTree();
    return structure.navigation || [];
  } catch (error) {
    console.error('Error getting categories:', error);
    return [];
  }
}

/**
 * Search docs by query (simple text search)
 * Note: For production, use the search-index.json with proper search library
 * @param {string} query - Search query
 * @returns {Promise<Array>} Search results
 */
export async function searchDocs(query) {
  try {
    const allDocs = await getAllDocs();
    const lowerQuery = query.toLowerCase();

    return allDocs
      .map(doc => {
        let score = 0;

        // Title match
        if (doc.title.toLowerCase().includes(lowerQuery)) {
          score += 100;
        }

        // Description/excerpt match
        if (doc.description?.toLowerCase().includes(lowerQuery)) {
          score += 50;
        }

        // Content match
        if (doc.content?.toLowerCase().includes(lowerQuery)) {
          score += 10;
        }

        // Tag match
        if (doc.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))) {
          score += 75;
        }

        return { ...doc, searchScore: score };
      })
      .filter(doc => doc.searchScore > 0)
      .sort((a, b) => b.searchScore - a.searchScore);
  } catch (error) {
    console.error('Error searching docs:', error);
    return [];
  }
}

/**
 * Get doc slugs for static generation
 * @returns {Promise<Array>} Array of path arrays for Next.js generateStaticParams
 */
export async function getDocSlugs() {
  try {
    const files = await getAllMarkdownFiles(docsDirectory);

    return files.map(file => {
      // Convert file path to slug array
      const relativePath = file.relativePath.replace('.md', '');
      const slug = relativePath.split('/').filter(Boolean);

      // Keep 'index' in the slug for Next.js static generation
      // The parsePath function in getDocByPath will handle it correctly
      return slug;
    });
  } catch (error) {
    console.error('Error getting doc slugs:', error);
    return [];
  }
}
