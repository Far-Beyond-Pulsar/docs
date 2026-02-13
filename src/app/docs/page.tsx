import { getNavigationTree } from '@/utils/docs';
import DocsGrid from '@/components/DocsGrid';
import { Search } from 'lucide-react';

export const metadata = {
  title: 'Documentation | Game Engine',
  description: 'Complete documentation for the game engine - guides, tutorials, API reference, and more.',
  openGraph: {
    title: 'Documentation | Game Engine',
    description: 'Complete documentation for the game engine',
    type: 'website',
  },
};

export default async function DocsHomePage() {
  const structure = await getNavigationTree() as any;
  const categories = structure.navigation || [];

  // Transform categories for DocsGrid
  const categoryCards = categories.map((cat: any) => {
    // Find first child path for the category
    const firstChildPath = cat.children?.[0]?.path || cat.children?.[0]?.slug
      ? `/docs/${cat.slug}/${cat.children[0].slug}`
      : `/docs/${cat.slug}`;
    
    return {
      title: cat.title,
      description: cat.description,
      path: firstChildPath,
      icon: cat.icon,
      slug: cat.slug,
      order: cat.order,
      tags: [] // Categories don't have tags
    };
  });

  return (
    <div className="docs-home max-w-7xl mx-auto px-4 py-12">
      {/* Hero section */}
      <div className="text-center mb-16">
        <h1 className="text-5xl font-bold mb-4">
          Game Engine Documentation
        </h1>
        <p className="text-xl text-gray-400 max-w-3xl mx-auto mb-8">
          Everything you need to build amazing games with our engine.
          From getting started guides to advanced API documentation.
        </p>

        {/* Search hint */}
        <div className="flex items-center justify-center gap-2 text-gray-400">
          <Search className="w-5 h-5" />
          <span>Press <kbd className="px-2 py-1 bg-gray-800 rounded text-sm font-mono">/</kbd> to search</span>
        </div>
      </div>

      {/* Quick start banner */}
      <div className="mb-12 p-6 bg-blue-900/20 border border-blue-800 rounded-lg">
        <h2 className="text-2xl font-bold mb-2">New to the engine?</h2>
        <p className="text-gray-300 mb-4">
          Start with our quick start guide to create your first game in 5 minutes.
        </p>
        <a
          href="/docs/getting-started/quick-start"
          className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          Get Started →
        </a>
      </div>

      {/* Documentation categories grid */}
      <DocsGrid
        docs={categoryCards}
        columns={3}
        title="Explore Documentation"
        description="Browse documentation by category"
      />

      {/* Statistics */}
      {structure.lastGenerated && (
        <div className="mt-16 pt-8 border-t border-gray-700 text-center text-sm text-gray-400">
          <p>
            {categories.length} categories • Last updated {new Date(structure.lastGenerated).toLocaleDateString()}
          </p>
        </div>
      )}

      {/* Additional resources */}
      <div className="mt-16">
        <h2 className="text-3xl font-bold mb-8 text-center">Additional Resources</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <a
            href="https://github.com/user/repo"
            target="_blank"
            rel="noopener noreferrer"
            className="p-6 border border-gray-700 rounded-lg hover:border-blue-500 transition-colors text-center"
          >
            <div className="text-4xl mb-4">💻</div>
            <h3 className="text-lg font-semibold mb-2">GitHub Repository</h3>
            <p className="text-sm text-gray-400">
              View source code, report issues, and contribute
            </p>
          </a>

          <a
            href="https://discord.gg/example"
            target="_blank"
            rel="noopener noreferrer"
            className="p-6 border border-gray-700 rounded-lg hover:border-blue-500 transition-colors text-center"
          >
            <div className="text-4xl mb-4">💬</div>
            <h3 className="text-lg font-semibold mb-2">Community Discord</h3>
            <p className="text-sm text-gray-400">
              Get help, share projects, and connect with developers
            </p>
          </a>

          <a
            href="/examples"
            className="p-6 border border-gray-700 rounded-lg hover:border-blue-500 transition-colors text-center"
          >
            <div className="text-4xl mb-4">🎮</div>
            <h3 className="text-lg font-semibold mb-2">Example Projects</h3>
            <p className="text-sm text-gray-400">
              Explore sample games and learn from working code
            </p>
          </a>
        </div>
      </div>
    </div>
  );
}
