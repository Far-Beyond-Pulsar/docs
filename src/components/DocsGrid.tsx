import DocCard from './DocCard';

interface Doc {
  title: string;
  description: string;
  slug?: string;
  path?: string;
  url?: string;
  tags?: string[];
  readingTime?: number;
  lastUpdated?: string;
  icon?: string;
  order?: number;
}

interface DocsGridProps {
  docs: Doc[];
  columns?: 1 | 2 | 3 | 4;
  title?: string;
  description?: string;
}

export default function DocsGrid({ docs, columns = 3, title, description }: DocsGridProps) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
  };

  return (
    <div className="docs-grid">
      {(title || description) && (
        <div className="mb-8">
          {title && (
            <h2 className="text-3xl font-bold mb-2">{title}</h2>
          )}
          {description && (
            <p className="text-gray-600 dark:text-gray-400">{description}</p>
          )}
        </div>
      )}

      <div className={`grid ${gridCols[columns]} gap-6`}>
        {docs.map((doc, index) => (
          <DocCard key={doc.slug || doc.path || index} doc={doc} />
        ))}
      </div>

      {docs.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p>No documentation found.</p>
        </div>
      )}
    </div>
  );
}
