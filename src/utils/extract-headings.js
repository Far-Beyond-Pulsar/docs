// src/utils/extract-headings.js
import slugify from 'slugify';

/**
 * Extracts headings from markdown content
 * @param {string} content - Markdown content
 * @param {Object} options - Options for extraction
 * @returns {Array} Array of heading objects
 */
export function extractHeadings(content, options = {}) {
  const {
    minLevel = 2,  // H2 by default
    maxLevel = 4,  // Up to H4 by default
    includeH1 = false  // Usually skip H1 as it's the page title
  } = options;

  const headings = [];

  // Regex to match markdown headings
  // Matches: ## Heading, ### Heading, etc.
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;

  // Store heading positions for later content extraction
  const headingPositions = [];
  let match;

  // First pass: collect all headings with their positions
  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();

    // Filter by level
    if (!includeH1 && level === 1) continue;
    if (level < minLevel || level > maxLevel) continue;

    // Remove markdown formatting from text
    const cleanText = text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Remove links
      .replace(/`([^`]+)`/g, '$1')  // Remove inline code
      .replace(/\*\*([^*]+)\*\*/g, '$1')  // Remove bold
      .replace(/\*([^*]+)\*/g, '$1')  // Remove italic
      .replace(/__([^_]+)__/g, '$1')  // Remove bold (underscore)
      .replace(/_([^_]+)_/g, '$1')  // Remove italic (underscore)
      .trim();

    // Generate slug from text
    const slug = generateSlug(cleanText);

    headingPositions.push({
      level,
      text: cleanText,
      slug,
      position: match.index,
      children: []
    });
  }

  // Second pass: extract callouts for each heading section
  // Match callouts in blockquotes: > [!NOTE], > [!TIP], etc.
  const calloutRegex = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im;

  for (let i = 0; i < headingPositions.length; i++) {
    const heading = headingPositions[i];
    const nextHeading = headingPositions[i + 1];

    // Extract content between this heading and the next
    const startPos = heading.position;
    const endPos = nextHeading ? nextHeading.position : content.length;
    const sectionContent = content.substring(startPos, endPos);

    // Find all callouts in this section
    const callouts = new Set();
    const lines = sectionContent.split('\n');

    for (const line of lines) {
      const calloutMatch = line.match(calloutRegex);
      if (calloutMatch) {
        callouts.add(calloutMatch[1].toLowerCase());
      }
    }

    heading.callouts = Array.from(callouts);
    headings.push(heading);
  }

  return headings;
}

/**
 * Extract headings and build a nested tree structure
 * @param {string} content - Markdown content
 * @param {Object} options - Options for extraction
 * @returns {Array} Nested array of headings
 */
export function extractHeadingsTree(content, options = {}) {
  const flatHeadings = extractHeadings(content, options);

  // Build tree structure
  const tree = [];
  const stack = [{ level: 0, children: tree }];

  for (const heading of flatHeadings) {
    // Pop stack until we find the parent level
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    // Get parent from stack
    const parent = stack[stack.length - 1];

    // Add heading to parent's children
    parent.children.push(heading);

    // Push heading onto stack for potential children
    stack.push(heading);
  }

  return tree;
}

/**
 * Generate slug from heading text
 * @param {string} text - Heading text
 * @returns {string} URL-safe slug
 */
export function generateSlug(text) {
  return slugify(text, {
    lower: true,
    strict: true,
    remove: /[*+~.()'"!:@]/g
  });
}

/**
 * Extract just the heading text without creating full objects
 * Useful for quick operations
 * @param {string} content - Markdown content
 * @returns {Array<string>} Array of heading texts
 */
export function extractHeadingTexts(content) {
  const headingRegex = /^#{1,6}\s+(.+)$/gm;
  const texts = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    texts.push(match[1].trim());
  }

  return texts;
}

/**
 * Count headings by level
 * @param {string} content - Markdown content
 * @returns {Object} Object with counts by level
 */
export function countHeadings(content) {
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const counts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    counts[`h${level}`]++;
  }

  return counts;
}

/**
 * Get heading by slug
 * @param {Array} headings - Array of heading objects
 * @param {string} slug - Slug to search for
 * @returns {Object|null} Heading object or null
 */
export function getHeadingBySlug(headings, slug) {
  for (const heading of headings) {
    if (heading.slug === slug) {
      return heading;
    }

    if (heading.children && heading.children.length > 0) {
      const found = getHeadingBySlug(heading.children, slug);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Generate a table of contents string from headings
 * @param {Array} headings - Array of heading objects
 * @param {Object} options - Formatting options
 * @returns {string} Markdown table of contents
 */
export function generateTOCMarkdown(headings, options = {}) {
  const { indent = '  ', bulletChar = '-' } = options;

  function formatHeading(heading, depth = 0) {
    const indentation = indent.repeat(depth);
    const line = `${indentation}${bulletChar} [${heading.text}](#${heading.slug})`;

    let result = line;

    if (heading.children && heading.children.length > 0) {
      for (const child of heading.children) {
        result += '\n' + formatHeading(child, depth + 1);
      }
    }

    return result;
  }

  return headings.map(h => formatHeading(h)).join('\n');
}

/**
 * Get estimated reading sections from headings
 * Estimates reading time for each major section
 * @param {string} content - Full markdown content
 * @param {Array} headings - Extracted headings
 * @returns {Array} Headings with estimated reading time
 */
export function getReadingSections(content, headings) {
  const wordsPerMinute = 200;

  return headings.map((heading, index) => {
    // Find content between this heading and the next
    const currentHeadingRegex = new RegExp(`^#{${heading.level}}\\s+${heading.text}`, 'm');
    const match = content.match(currentHeadingRegex);

    if (!match) {
      return { ...heading, readingTime: 0, wordCount: 0 };
    }

    const startIndex = match.index + match[0].length;

    // Find next heading of same or higher level
    const nextHeading = headings
      .slice(index + 1)
      .find(h => h.level <= heading.level);

    let endIndex = content.length;
    if (nextHeading) {
      const nextHeadingRegex = new RegExp(`^#{${nextHeading.level}}\\s+${nextHeading.text}`, 'm');
      const nextMatch = content.match(nextHeadingRegex);
      if (nextMatch) {
        endIndex = nextMatch.index;
      }
    }

    // Extract section content
    const sectionContent = content.substring(startIndex, endIndex);

    // Count words
    const wordCount = sectionContent.split(/\s+/).length;
    const readingTime = Math.ceil(wordCount / wordsPerMinute);

    return {
      ...heading,
      wordCount,
      readingTime
    };
  });
}

/**
 * Validate heading structure (check for skipped levels)
 * @param {Array} headings - Flat array of headings
 * @returns {Array} Array of warnings
 */
export function validateHeadingStructure(headings) {
  const warnings = [];
  let previousLevel = 1;

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];

    // Check if level is skipped (e.g., H2 -> H4)
    if (heading.level - previousLevel > 1) {
      warnings.push({
        heading: heading.text,
        level: heading.level,
        issue: `Skipped heading level (jumped from H${previousLevel} to H${heading.level})`,
        line: i + 1
      });
    }

    previousLevel = heading.level;
  }

  return warnings;
}
